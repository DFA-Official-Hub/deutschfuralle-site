/* Deutsch Für Alle accounts: shared Supabase client (publishable key only). */
(function(){
var URL='https://owmsddezprhrjiinznmq.supabase.co',KEY='sb_publishable_INSc9yCl-RpPJ4vIkRxDDQ_7woGXiRj';
/* Login options that need setup by the site owner. Flip to true once configured in Supabase. */
var FEATURES={google:false,phone:false};
/* "Keep me logged in": localStorage when ticked, sessionStorage (ends with the browser) when not. */
var remember=function(){try{return localStorage.getItem('dfa-remember')!=='0'}catch(e){return true}};
var store={getItem:function(k){try{return (remember()?localStorage:sessionStorage).getItem(k)}catch(e){return null}},
setItem:function(k,v){try{(remember()?localStorage:sessionStorage).setItem(k,v)}catch(e){}},
removeItem:function(k){try{localStorage.removeItem(k);sessionStorage.removeItem(k)}catch(e){}}};
var sb=window.supabase.createClient(URL,KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storage:store,flowType:'pkce'}});
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function setRemember(on){try{localStorage.setItem('dfa-remember',on?'1':'0')}catch(e){}}
async function profile(){var s=(await sb.auth.getSession()).data.session;if(!s)return null;
var r=await sb.from('profiles').select('*').eq('id',s.user.id).maybeSingle();return r.data?Object.assign({email:s.user.email},r.data):{id:s.user.id,email:s.user.email}}
function header(sess){document.querySelectorAll('a.acct:not(.acct-adm) span').forEach(function(a){a.textContent=sess?'My account':'Log in'});adminLink(sess)}
var roleFor=null,isAdm=false,roleP=null;async function adminLink(sess){var uid=sess&&sess.user&&sess.user.id||null;
if(uid!==roleFor){roleFor=uid;roleP=uid?sb.from('profiles').select('role').eq('id',uid).maybeSingle().then(function(r){return !!(r.data&&r.data.role==='admin')},function(){return false}):Promise.resolve(false)}
var p=roleP;isAdm=await p;if(p!==roleP)return;
var a=document.querySelector('a.acct:not(.acct-adm)'),x=document.getElementById('dfa-admin-link');
if(isAdm&&a&&!x){var l=document.createElement('a');l.id='dfa-admin-link';l.className='acct acct-adm';l.href=a.getAttribute('href').replace('account.html','admin.html');l.textContent='Admin';if(/admin\.html$/.test(location.pathname))l.setAttribute('aria-current','page');a.parentNode.insertBefore(l,a)}else if(!isAdm&&x)x.remove()}
window.DFA={sb:sb,esc:esc,profile:profile,setRemember:setRemember,remember:remember,FEATURES:FEATURES,SITE:'https://www.deutschfuralle.com'};
})();
