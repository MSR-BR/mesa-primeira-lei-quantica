'use strict';
const crypto=require('node:crypto');
const {config,seal,unseal,constantEqual,cookie,setCookie,headers,html,query,github,escapeHTML}=require('../lib/auth.cjs');
function encryptSetup(value){
 const publicKey=process.env.AUTH_SETUP_PUBLIC_KEY;if(!publicKey)throw new Error('setup_disabled');
 const key=crypto.randomBytes(32),iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
 const body=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);
 const envelope={key:crypto.publicEncrypt({key:publicKey,oaepHash:'sha256',padding:crypto.constants.RSA_PKCS1_OAEP_PADDING},key).toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:body.toString('base64')};
 return Buffer.from(JSON.stringify(envelope)).toString('base64');
}
module.exports=async(req,res)=>{
 try{
  const c=config();headers(res);
  // Setup is disabled as soon as the app credentials are installed.
  if(c.clientId||!process.env.AUTH_SETUP_CODE_HASH||!process.env.AUTH_SETUP_PUBLIC_KEY)return html(res,'<h1>Configuração encerrada</h1>',404);
  if(req.method==='GET' && !query(req,'code'))return html(res,'<h1>Configuração inicial</h1><p>Etapa administrativa única. Os autores usarão apenas o botão Entrar com GitHub.</p><form method="post"><label for="setup-code">Código de configuração</label><input id="setup-code" name="setup_code" type="password" required autocomplete="off"><button>Preparar integração</button></form>');
  if(req.method==='POST'){
   const body=typeof req.body==='string'?Object.fromEntries(new URLSearchParams(req.body)):req.body;
   const digest=crypto.createHash('sha256').update(String(body?.setup_code||'')).digest('hex');
   if(!constantEqual(digest,process.env.AUTH_SETUP_CODE_HASH))return html(res,'<h1>Configuração não autorizada</h1>',403);
   const nonce=crypto.randomBytes(32).toString('base64url'),state=seal({kind:'setup',nonce,exp:Date.now()+900000});setCookie(res,nonce);
   const manifest={name:process.env.GITHUB_APP_NAME||'Artigo em Grupo',url:c.page,description:'Login e colaboração no artigo, com aprovação humana e histórico por autor.',redirect_url:c.base+'/api/setup',callback_urls:[c.base+'/api/callback'],setup_url:c.page,public:true,hook_attributes:{url:c.base+'/api/events',active:false},default_permissions:{contents:'write',actions:'write',metadata:'read'},default_events:[],request_oauth_on_install:false};
   return html(res,`<h1>Integração pronta para registrar</h1><p>O GitHub mostrará os dados da integração antes da confirmação. A instalação será restrita ao repositório do artigo.</p><form action="https://github.com/settings/apps/new?state=${encodeURIComponent(state)}" method="post"><input type="hidden" name="manifest" value="${escapeHTML(JSON.stringify(manifest))}"><button>Conferir integração no GitHub</button></form>`);
  }
  if(req.method!=='GET'){res.statusCode=405;return res.end();}
  const state=unseal(query(req,'state'),'setup');if(!constantEqual(cookie(req),state.nonce))throw new Error('invalid_cookie');
  const code=query(req,'code');if(!/^[A-Za-z0-9_-]{10,300}$/.test(code))throw new Error('invalid_code');
  const app=await github('app-manifests/'+encodeURIComponent(code)+'/conversions',null,{method:'POST'});
  const encrypted=encryptSetup({appId:app.id,slug:app.slug,clientId:app.client_id,clientSecret:app.client_secret});
  setCookie(res,'',0);
  return html(res,`<h1>Integração registrada</h1><p>Configuração criptografada para instalação automática no serviço. Nenhuma chave precisa ser copiada pelos autores.</p><textarea id="setup-result" readonly>${encrypted}</textarea><p><a id="install-app" href="https://github.com/apps/${encodeURIComponent(app.slug)}/installations/new">Instalar somente no repositório do artigo</a></p>`);
 }catch{console.error('github_app_setup_failed');return html(res,'<h1>Não foi possível concluir a configuração</h1><p>A etapa expirou ou não pôde ser validada. Nenhuma credencial foi exibida.</p>',400);}
};
module.exports.encryptSetup=encryptSetup;
