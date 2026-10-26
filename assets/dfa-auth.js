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
function header(sess){document.querySelectorAll('a.acct span').forEach(function(a){a.textContent=sess?'My account':'Log in'})}
sb.auth.onAuthStateChange(function(_e,s){header(s)});
window.DFA={sb:sb,esc:esc,profile:profile,setRemember:setRemember,remember:remember,FEATURES:FEATURES,SITE:'https://www.deutschfuralle.com'};
})();
