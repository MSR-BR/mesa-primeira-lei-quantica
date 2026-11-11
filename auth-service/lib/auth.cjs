'use strict';
const crypto=require('node:crypto');
const COOKIE='__Host-article-oauth';
const escapeHTML=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function config(){
 const base=new URL(process.env.AUTH_BASE_URL),page=new URL(process.env.ARTICLE_URL);
 if(base.protocol!=='https:' || page.protocol!=='https:' || base.username || page.username)throw new Error('invalid_configuration');
 const repository=process.env.GITHUB_REPOSITORY;
 if(!/^[\w.-]+\/[\w.-]+$/.test(repository||''))throw new Error('invalid_repository');
 const secret=Buffer.from(process.env.AUTH_STATE_KEY||'','base64');if(secret.length!==32)throw new Error('invalid_state_key');
 return {base:base.origin,page:page.href,origin:page.origin,repository,secret,clientId:process.env.GITHUB_APP_CLIENT_ID,clientSecret:process.env.GITHUB_APP_CLIENT_SECRET,repositoryId:process.env.GITHUB_REPOSITORY_ID};
}
function seal(payload){const key=config().secret,iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);const body=Buffer.concat([cipher.update(JSON.stringify(payload)),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),body]).toString('base64url');}
function unseal(value,kind){
 if(typeof value!=='string'||value.length>4000)throw new Error('invalid_state');
 const raw=Buffer.from(value,'base64url');if(raw.length<30)throw new Error('invalid_state');
 const decipher=crypto.createDecipheriv('aes-256-gcm',config().secret,raw.subarray(0,12));decipher.setAuthTag(raw.subarray(12,28));
 const payload=JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)),decipher.final()]).toString());
 if(payload.kind!==kind||!Number.isSafeInteger(payload.exp)||payload.exp<Date.now()||payload.exp>Date.now()+3600000)throw new Error('expired_state');return payload;
}
function constantEqual(a,b){const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&crypto.timingSafeEqual(x,y);}
function cookie(req){return (req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1)||'';}
function setCookie(res,value,maxAge=900){res.setHeader('Set-Cookie',`${COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`);}
function headers(res){res.setHeader('Cache-Control','no-store, max-age=0');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');}
function html(res,body,status=200,script=''){
 headers(res);const nonce=crypto.randomBytes(18).toString('base64');res.setHeader('Content-Security-Policy',`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; form-action https://github.com 'self'; base-uri 'none'; frame-ancestors 'none'`);res.setHeader('Content-Type','text/html; charset=utf-8');res.statusCode=status;
 res.end(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Conexão do artigo</title><style>body{font:18px/1.5 system-ui;max-width:680px;margin:64px auto;padding:24px}textarea{width:100%;height:120px}button{padding:12px}</style>${body}${script?`<script nonce="${nonce}">${script}</script>`:''}</html>`);
}
function query(req,key){const value=req.query?.[key];return typeof value==='string'?value:new URL(req.url,'https://local.invalid').searchParams.get(key)||'';}
function sendResult(res,result){
 const c=config();setCookie(res,'',0);headers(res);
 const grant={...result,tokenExpiresAt:Date.now()+Math.min(Number(result.expiresIn)||28800,28800)*1000,kind:'result',exp:Date.now()+60000};
 const ticket=seal(grant);const redirect=new URL(c.page);redirect.hash='github-login='+ticket;
 res.statusCode=302;res.setHeader('Location',redirect.href);res.end();
}
async function session(req,res){
 const c=config();headers(res);
 if(req.headers.origin!==c.origin){res.statusCode=403;return res.end();}
 res.setHeader('Access-Control-Allow-Origin',c.origin);res.setHeader('Vary','Origin');
 if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','POST');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.statusCode=204;return res.end();}
 if(req.method!=='POST'){res.statusCode=405;return res.end();}
 try{
  const body=typeof req.body==='string'?JSON.parse(req.body):req.body;
  if(typeof body?.verifier!=='string'||!/^[A-Za-z0-9_-]{43,100}$/.test(body.verifier))throw new Error('invalid_proof');
  const grant=unseal(body.ticket,'result');const challenge=crypto.createHash('sha256').update(body.verifier).digest('base64url');
  if(!constantEqual(challenge,grant.state))throw new Error('invalid_proof');
  res.setHeader('Content-Type','application/json');res.statusCode=200;
  res.end(JSON.stringify(grant.error?{error:grant.error}:{token:grant.token,login:grant.login,expiresIn:Math.max(0,Math.floor((grant.tokenExpiresAt-Date.now())/1000))}));
 }catch{res.statusCode=400;res.end(JSON.stringify({error:'A sessão de entrada expirou ou não pertence a esta aba. Entre novamente com GitHub.'}));}
}
async function github(path,token,options={}){const response=await fetch('https://api.github.com/'+path,{...options,signal:AbortSignal.timeout(15000),headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10','User-Agent':'group-article-workspace',...(token?{Authorization:'Bearer '+token}:{}),...options.headers}});if(!response.ok)throw new Error('github_'+response.status);return response.status===204?null:response.json();}
async function revoke(token){const c=config();await github(`applications/${c.clientId}/token`,null,{method:'DELETE',headers:{Authorization:'Basic '+Buffer.from(c.clientId+':'+c.clientSecret).toString('base64'),'Content-Type':'application/json'},body:JSON.stringify({access_token:token})});}
async function login(req,res){
 try{const c=config();headers(res);if(req.method!=='GET'){res.statusCode=405;return res.end();}if(!c.clientId||!c.clientSecret){return html(res,'<h1>Integração em configuração</h1><p>A conexão do GitHub ainda não foi ativada.</p>',503);}
 const clientState=query(req,'state');if(!/^[A-Za-z0-9_-]{32,100}$/.test(clientState))return html(res,'<h1>Pedido de conexão inválido</h1>',400);
 const verifier=crypto.randomBytes(32).toString('base64url'),nonce=crypto.randomBytes(32).toString('base64url');
 const state=seal({kind:'login',clientState,verifier,nonce,exp:Date.now()+900000});setCookie(res,nonce);
 const url=new URL('https://github.com/login/oauth/authorize');for(const [key,value] of Object.entries({client_id:c.clientId,redirect_uri:c.base+'/api/callback',state,code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',allow_signup:'true'}))url.searchParams.set(key,value);
 res.statusCode=302;res.setHeader('Location',url.href);res.end();
 }catch{html(res,'<h1>Não foi possível iniciar a conexão</h1>',503);}
}
async function callback(req,res){
 let state,token;
 try{
  if(req.method!=='GET'){res.statusCode=405;return res.end();}
  const c=config();state=unseal(query(req,'state'),'login');if(!constantEqual(cookie(req),state.nonce))throw new Error('invalid_cookie');
  if(query(req,'error'))return sendResult(res,{state:state.clientState,error:'A conexão não foi autorizada. Você pode tentar novamente.'});
  const code=query(req,'code');if(!/^[\w-]{10,300}$/.test(code))throw new Error('invalid_code');
  const response=await fetch('https://github.com/login/oauth/access_token',{method:'POST',signal:AbortSignal.timeout(15000),headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({client_id:c.clientId,client_secret:c.clientSecret,code,redirect_uri:c.base+'/api/callback',code_verifier:state.verifier,...(c.repositoryId?{repository_id:c.repositoryId}:{})})});
  if(!response.ok)throw new Error('token_exchange');const grant=await response.json();token=grant.access_token;if(typeof token!=='string'||!token.startsWith('ghu_'))throw new Error('invalid_grant');
  const [user,repo,installations]=await Promise.all([github('user',token),github('repos/'+c.repository,token),github('user/installations?per_page=100',token)]);
  if(!repo.permissions?.push)throw new Error('no_write_access');
  let allowed=false;
  for(const installation of installations.installations||[]){if(installation.client_id&&installation.client_id!==c.clientId)continue;if(installation.permissions?.contents!=='write'||installation.permissions?.actions!=='write')continue;const repos=await github(`user/installations/${installation.id}/repositories?per_page=100`,token);if(repos.repositories?.some(r=>r.full_name.toLowerCase()===c.repository.toLowerCase())){allowed=true;break;}}
  if(!allowed)throw new Error('app_not_installed');
  return sendResult(res,{state:state.clientState,token,login:user.login,expiresIn:grant.expires_in||28800});
 }catch(error){if(token)try{await revoke(token);}catch{/* Do not log credentials. */}console.error('github_login_failed', ['no_write_access','app_not_installed','invalid_cookie','invalid_grant'].includes(error.message)?error.message:'authorization_failed');if(state)return sendResult(res,{state:state.clientState,error:'Sua conta precisa estar adicionada como colaboradora e a integração precisa estar instalada no repositório do artigo.'});return html(res,'<h1>Conexão inválida ou expirada</h1><p>Feche esta janela e inicie novamente pela página do artigo.</p>',400);}
}
async function logout(req,res){
 const c=config();headers(res);if(req.headers.origin!==c.origin){res.statusCode=403;return res.end();}res.setHeader('Access-Control-Allow-Origin',c.origin);res.setHeader('Vary','Origin');
 if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','POST');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.statusCode=204;return res.end();}
 if(req.method!=='POST'){res.statusCode=405;return res.end();}let body;try{body=typeof req.body==='string'?JSON.parse(req.body):req.body;}catch{res.statusCode=400;return res.end();}
 if(typeof body?.token!=='string'||!/^ghu_[A-Za-z0-9_]{10,300}$/.test(body.token)){res.statusCode=400;return res.end();}
 try{await revoke(body.token);}catch{res.statusCode=502;return res.end();}res.statusCode=204;res.end();
}
module.exports={config,seal,unseal,constantEqual,cookie,setCookie,headers,html,query,sendResult,github,login,callback,logout,session,escapeHTML};
