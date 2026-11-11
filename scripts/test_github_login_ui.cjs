'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const code=fs.readFileSync(require('node:path').join(__dirname,'../web/app.js'),'utf8').replace('init();','');
const fields=new Map(),field=()=>({value:'',textContent:'',hidden:false,disabled:false,open:false,showModal(){this.open=true;},close(){this.open=false;},addEventListener(){},removeAttribute(){}});
const document={querySelector(selector){if(!fields.has(selector))fields.set(selector,field());return fields.get(selector);},querySelectorAll:()=>[]};
const storage=new Map();let assigned='',putBody,putToken,denyLogin=false;const location={hash:'#article',assign(url){assigned=url;}};
const context=vm.createContext({document,TextEncoder,TextDecoder,Uint8Array,btoa,atob,URL,crypto:crypto.webcrypto,location,history:{replaceState(a,b,url){location.hash=url;}},sessionStorage:{setItem(k,v){storage.set(k,v);},getItem(k){return storage.get(k)||null;},removeItem(k){storage.delete(k);}},requestAnimationFrame(){},console,fetch:async(url,options={})=>{
 if(url.endsWith('/api/session'))return{ok:true,status:200,json:async()=>denyLogin?{error:'Entrada cancelada'}:{token:'ghu_user_token_test_123456789',login:'author',expiresIn:28800}};
 if(url.endsWith('/api/logout'))return{ok:true,status:204};
 if(options.method==='PUT'){putBody=JSON.parse(options.body);putToken=options.headers.Authorization;return{ok:true,status:200,json:async()=>({content:{sha:'b'.repeat(40)}})};}
 return{ok:true,status:200,json:async()=>({sha:'a'.repeat(40),content:btoa('Original source')})};}});
vm.runInContext(code,context);vm.runInContext("workspace={repository:'owner/article',authUrl:'https://login.example.test',sections:[{title:'Introduction',path:'article/sections/intro.tex'}]};",context);
(async()=>{
 await vm.runInContext("openSection('article/sections/intro.tex')",context);fields.get('#section-source').value='Texto atualizado com acentuação';
 await vm.runInContext('beginGitHubLogin()',context);const saved=JSON.parse(storage.get('article-github-login'));
 assert.equal(new URL(assigned).origin,'https://login.example.test');assert.equal(new URL(assigned).searchParams.get('state'),crypto.createHash('sha256').update(saved.verifier).digest('base64url'));assert.equal(saved.draft.source,'Texto atualizado com acentuação');assert(!storage.get('article-github-login').includes('ghu_'));
 location.hash='#github-login=encrypted-ticket';await vm.runInContext('completeGitHubLogin()',context);assert.equal(location.hash,'#article');assert.equal(storage.size,0);assert.match(fields.get('#connection-status').textContent,/author/);assert.equal(fields.get('#section-source').value,'Texto atualizado com acentuação');
 await vm.runInContext('saveSection()',context);assert.equal(putToken,'Bearer ghu_user_token_test_123456789');assert.equal(putBody.sha,'a'.repeat(40));assert.equal(new TextDecoder().decode(Uint8Array.from(atob(putBody.content),c=>c.charCodeAt(0))),'Texto atualizado com acentuação');assert.match(fields.get('#section-feedback').textContent,/Seção salva/);assert.equal(vm.runInContext('baseSha',context),'b'.repeat(40));
 await vm.runInContext('disconnectGitHub()',context);assert.equal(vm.runInContext('accessToken',context),'');fields.get('#section-source').value='Draft preserved after cancellation';await vm.runInContext('beginGitHubLogin()',context);location.hash='#github-login=cancelled-ticket';denyLogin=true;await vm.runInContext('completeGitHubLogin()',context);assert.equal(fields.get('#section-source').value,'Draft preserved after cancellation');assert.equal(vm.runInContext('accessToken',context),'');assert.equal(storage.size,0);console.log('PASS: same-tab login proof; preserve draft on success and cancellation; authenticated UTF8 save and disconnect');
})().catch(error=>{console.error(error);process.exitCode=1;});
