'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
Object.assign(process.env,{AUTH_BASE_URL:'https://login.example.test',ARTICLE_URL:'https://author.github.io/article/',GITHUB_REPOSITORY:'author/article',GITHUB_REPOSITORY_ID:'1234',GITHUB_APP_CLIENT_ID:'client-test',GITHUB_APP_CLIENT_SECRET:'server-only-test',AUTH_STATE_KEY:crypto.randomBytes(32).toString('base64')});
const auth=require('../lib/auth.cjs');
const browserProof='v'.repeat(64),browserChallenge=crypto.createHash('sha256').update(browserProof).digest('base64url');
function res(){return{statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},end(body=''){this.body=body;}};}
function loginRequest(){const response=res();return auth.login({method:'GET',url:'/api/login?state='+browserChallenge,headers:{}},response).then(()=>response);}
function callbackRequest(response){const url=new URL(response.headers.Location);return{method:'GET',query:{state:url.searchParams.get('state'),code:'code-test-12345678'},headers:{cookie:response.headers['Set-Cookie'].split(';')[0]}};}
test('login binds encrypted state, secure cookie, callback and S256 verifier',async()=>{
 const response=await loginRequest();assert.equal(response.statusCode,302);const url=new URL(response.headers.Location);assert.equal(url.origin,'https://github.com');assert.equal(url.searchParams.get('scope'),null);assert.equal(url.searchParams.get('redirect_uri'),'https://login.example.test/api/callback');
 const state=auth.unseal(url.searchParams.get('state'),'login');assert.equal(url.searchParams.get('code_challenge'),crypto.createHash('sha256').update(state.verifier).digest('base64url'));assert.match(response.headers['Set-Cookie'],/Secure; HttpOnly; SameSite=Lax/);assert(!url.href.includes(process.env.GITHUB_APP_CLIENT_SECRET));
 assert.throws(()=>auth.unseal(url.searchParams.get('state').slice(0,-2)+'aa','login'));assert.throws(()=>auth.unseal(auth.seal({kind:'login',exp:Date.now()-1}),'login'));
});
test('callback only delivers an access token for a writable installed repository',async()=>{
 const begin=await loginRequest(),request=callbackRequest(begin),response=res(),calls=[];const original=global.fetch;
 global.fetch=async(url,options)=>{calls.push({url,options});let data;
 if(url==='https://github.com/login/oauth/access_token')data={access_token:'ghu_valid_test_token_123456789',expires_in:28800,refresh_token:'not-persisted-test'};
 else if(url.endsWith('/user'))data={login:'coauthor'};
 else if(url.endsWith('/repos/author/article'))data={permissions:{push:true}};
 else if(url.includes('/user/installations/77/repositories'))data={repositories:[{full_name:'author/article'}]};
 else if(url.includes('/user/installations?'))data={installations:[{id:77,client_id:'client-test',permissions:{contents:'write',actions:'write'}}]};else throw new Error('unexpected request');
 return{ok:true,status:200,json:async()=>data};};
 try{await auth.callback(request,response);assert.equal(response.statusCode,302);const redirect=new URL(response.headers.Location);assert.equal(redirect.origin,'https://author.github.io');assert(!redirect.href.includes('ghu_valid_test_token'));const ticket=redirect.hash.slice('#github-login='.length);const grant=auth.unseal(ticket,'result');assert.equal(grant.token,'ghu_valid_test_token_123456789');assert.equal(grant.state,browserChallenge);assert(!JSON.stringify(grant).includes('not-persisted-test'));assert(!redirect.href.includes('server-only-test'));const exchanged=JSON.parse(calls[0].options.body);assert.equal(exchanged.repository_id,'1234');assert.equal(exchanged.code_verifier,auth.unseal(request.query.state,'login').verifier);assert.equal(response.headers['Referrer-Policy'],'no-referrer');}finally{global.fetch=original;}
});
test('callback rejects forged cookie before making any provider request',async()=>{
 const begin=await loginRequest(),request=callbackRequest(begin),response=res();request.headers.cookie='__Host-article-oauth=forged';let called=false;const original=global.fetch;global.fetch=async()=>{called=true;throw new Error();};try{await auth.callback(request,response);assert.equal(called,false);assert(!response.body.includes('"token":'));}finally{global.fetch=original;}
});
test('non-collaborator never receives a token and grant is revoked',async()=>{
 const begin=await loginRequest(),request=callbackRequest(begin),response=res();const original=global.fetch;let revoked=false;
 global.fetch=async(url,options)=>{if(options?.method==='DELETE'){revoked=true;return{ok:true,status:204};}const data=url.includes('/access_token')?{access_token:'ghu_denied_test_token_123456789'}:url.endsWith('/user')?{login:'reader'}:url.includes('/repos/')?{permissions:{push:false}}:{installations:[]};return{ok:true,status:200,json:async()=>data};};
 try{await auth.callback(request,response);assert(revoked);const grant=auth.unseal(new URL(response.headers.Location).hash.slice('#github-login='.length),'result');assert(!grant.token);assert.match(grant.error,/colaboradora/);}finally{global.fetch=original;}
});
test('logout denies other origins and confirms revocation for the article origin',async()=>{
 const denied=res();await auth.logout({method:'POST',headers:{origin:'https://evil.example'},body:{}},denied);assert.equal(denied.statusCode,403);
 const original=global.fetch;let revoked=false;global.fetch=async()=>{revoked=true;return{ok:true,status:204};};try{const response=res();await auth.logout({method:'POST',headers:{origin:'https://author.github.io'},body:{token:'ghu_valid_test_token_123456789'}},response);assert(revoked);assert.equal(response.statusCode,204);assert.equal(response.headers['Access-Control-Allow-Origin'],'https://author.github.io');}finally{global.fetch=original;}
});
test('setup envelope is decryptable only with its one-time private key',()=>{
 const {publicKey,privateKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});process.env.AUTH_SETUP_PUBLIC_KEY=publicKey.export({type:'spki',format:'pem'});const {encryptSetup}=require('../api/setup.js');const envelope=JSON.parse(Buffer.from(encryptSetup({clientSecret:'private-test-value'}),'base64'));
 const key=crypto.privateDecrypt({key:privateKey,oaepHash:'sha256',padding:crypto.constants.RSA_PKCS1_OAEP_PADDING},Buffer.from(envelope.key,'base64'));const decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(envelope.iv,'base64'));decipher.setAuthTag(Buffer.from(envelope.tag,'base64'));const value=JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data,'base64')),decipher.final()]));assert.equal(value.clientSecret,'private-test-value');delete process.env.AUTH_SETUP_PUBLIC_KEY;
});

test('session return requires the original browser proof and exact article origin',async()=>{
 const ticket=auth.seal({kind:'result',exp:Date.now()+60000,state:browserChallenge,token:'ghu_valid_test_token_123456789',login:'author',tokenExpiresAt:Date.now()+28800000});
 const denied=res();await auth.session({method:'POST',headers:{origin:'https://evil.example'},body:{ticket,verifier:browserProof}},denied);assert.equal(denied.statusCode,403);
 const forged=res();await auth.session({method:'POST',headers:{origin:'https://author.github.io'},body:{ticket,verifier:'x'.repeat(64)}},forged);assert.equal(forged.statusCode,400);assert(!forged.body.includes('ghu_valid'));
 const response=res();await auth.session({method:'POST',headers:{origin:'https://author.github.io'},body:{ticket,verifier:browserProof}},response);assert.equal(response.statusCode,200);assert.equal(JSON.parse(response.body).login,'author');assert.match(response.headers['Cache-Control'],/no-store/);
});
