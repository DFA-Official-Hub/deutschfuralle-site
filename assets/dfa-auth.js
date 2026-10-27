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
var roleFor=null,isAdm=false,isStu=false,roleP=null;async function adminLink(sess){var uid=sess&&sess.user&&sess.user.id||null;
if(uid!==roleFor){roleFor=uid;roleP=uid?Promise.all([sb.from('profiles').select('role').eq('id',uid).maybeSingle(),sb.from('enrollments').select('id').eq('email',String(sess.user.email||'').toLowerCase()).neq('status','revoked').limit(1)]).then(function(r){var a=!!(r[0].data&&r[0].data.role==='admin');isStu=!a&&!!(r[1].data&&r[1].data.length);return a},function(){isStu=false;return false}):(isStu=false,Promise.resolve(false))}
var p=roleP;isAdm=await p;if(p!==roleP)return;try{if(uid)localStorage.setItem('dfa-pill',isAdm?'admin':isStu?'student':'');else localStorage.removeItem('dfa-pill')}catch(e){}
var a=document.querySelector('a.acct:not(.acct-adm)'),x=document.getElementById('dfa-admin-link');
if(isAdm&&a&&!x){var l=document.createElement('a');l.id='dfa-admin-link';l.className='acct acct-adm';l.href=a.getAttribute('href').replace('account.html','admin.html');l.textContent='Admin';if(/admin\.html$/.test(location.pathname))l.setAttribute('aria-current','page');a.parentNode.insertBefore(l,a)}else if(!isAdm&&x)x.remove();
var y=document.getElementById('dfa-course-link');if(isStu&&a&&!y){var c=document.createElement('a');c.id='dfa-course-link';c.className='acct acct-adm';c.href=a.getAttribute('href').replace('account.html','portal.html');c.textContent='My course';if(/portal\.html$/.test(location.pathname))c.setAttribute('aria-current','page');a.parentNode.insertBefore(c,a)}else if(!isStu&&y)y.remove()}
sb.auth.onAuthStateChange(function(_e,s){setTimeout(function(){header(s)},0)});
/* Edge Function call that survives a revoked/expired login: refresh once on 401, else ask to log in again. */
async function readErr(r){try{if(r.error&&r.error.context&&r.error.context.json)return await r.error.context.clone().json()}catch(e){}return null}
async function invoke(name,body){var r=await sb.functions.invoke(name,{body:body});if(!r.error)return r;
 var st=r.error.context&&r.error.context.status;
 if(st===401){var rf=await sb.auth.refreshSession();if(!rf.error&&rf.data&&rf.data.session){r=await sb.functions.invoke(name,{body:body});if(!r.error)return r}
  else{await sb.auth.signOut({scope:'local'});return {data:{error:'Your login has expired. Please log in again.',relogin:true},error:r.error}}}
 var j=await readErr(r);return {data:j||{error:'Could not reach the server. Please try again.'},error:r.error}}
window.DFA={invoke:invoke,sb:sb,esc:esc,profile:profile,setRemember:setRemember,remember:remember,FEATURES:FEATURES,SITE:'https://www.deutschfuralle.com'};
})();
