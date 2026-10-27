/* Deutsch Für Alle accounts: shared Supabase client (publishable key only). */
(function(){
var URL='https://owmsddezprhrjiinznmq.supabase.co',KEY='sb_publishable_INSc9yCl-RpPJ4vIkRxDDQ_7woGXiRj';
/* Login options that need setup by the site owner. Flip to true once configured in Supabase. */
var FEATURES={google:false,
 /* Cloudflare Turnstile bot check: paste the SITE KEY here once Turnstile is set up in Cloudflare AND enabled in Supabase (Auth > Bot and Abuse Protection). */
 turnstile:''};
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
sb.auth.onAuthStateChange(function(_e,s){setTimeout(function(){header(s);if(s)gate(s);else{G={}}idleSetup(s)},0)});
/* Edge Function call that survives a revoked/expired login: refresh once on 401, else ask to log in again. */
async function readErr(r){try{if(r.error&&r.error.context&&r.error.context.json)return await r.error.context.clone().json()}catch(e){}return null}
async function invoke(name,body){if(name!=='security'){var gs=(await sb.auth.getSession()).data.session;if(gs)await gate(gs)}var r=await sb.functions.invoke(name,{body:body});if(!r.error)return r;
 var st=r.error.context&&r.error.context.status;
 if(st===401){var rf=await sb.auth.refreshSession();if(!rf.error&&rf.data&&rf.data.session){r=await sb.functions.invoke(name,{body:body});if(!r.error)return r}
  else{await sb.auth.signOut({scope:'local'});return {data:{error:'Your login has expired. Please log in again.',relogin:true},error:r.error}}}
 var j=await readErr(r);return {data:(j&&j.error)?j:{error:st===546?'The server took too long (status 546). Please try again.':st?'Server error (status '+st+'). Please try again.':'Could not reach the server. Please check your connection and try again.'},error:r.error}}
function certPill(no,c,cls){var h='doc.html?type=cert&no='+encodeURIComponent(no);if(c&&c.image&&c.image.url)return '<a class="'+cls+'" target="_blank" rel="noopener" href="'+h+'">Certificate '+esc(no)+'</a>';
 return '<span class="'+cls+' is-off" aria-disabled="true" title="Your certificate will be available here once it is released.">Certificate '+esc(no)+' · coming soon</span><span class="adm-mut cert-note">Your certificate will be available here once it is released.</span>'}
function receiptPills(id,pays,cls,inv){pays=(pays||[]).slice().sort(function(a,b){return a.installment_no-b.installment_no});if(!pays.length&&inv)pays=[{invoice_no:inv,installment_no:1,installments:1}];
 return pays.map(function(p){var lb=p.installments>1||p.installment_no>1?' ('+(p.is_final&&p.installment_no>1?'Final, ':'')+p.installment_no+' of '+Math.max(p.installments,p.installment_no)+')':'',h='doc.html?id='+id+'&type=receipt&inv='+encodeURIComponent(p.invoice_no);
  return '<a class="'+cls+'" target="_blank" rel="noopener" href="'+h+'">Receipt '+esc(p.invoice_no)+lb+'</a>'}).join('')}
async function paysFor(ids){if(!ids.length)return {};var r=await sb.from('payments').select('enrollment_id,invoice_no,installment_no,installments,is_final,amount').in('enrollment_id',ids);var m={};(r.data||[]).forEach(function(p){(m[p.enrollment_id]=m[p.enrollment_id]||[]).push(p)});return m}

/* ---------- Security: device check, email code, 2FA prompt, auto logout, password helpers ---------- */
function devId(){try{var d=localStorage.getItem('dfa-device');if(!d){d=(crypto.randomUUID?crypto.randomUUID():String(Math.random()).slice(2)+Date.now());localStorage.setItem('dfa-device',d)}return d}catch(e){return 'nostorage'}}
function jwt(t){try{var p=t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');while(p.length%4)p+='=';return JSON.parse(atob(p))}catch(e){return {}}}
var G={};
function gate(s){var sid=jwt(s.access_token).session_id||'x';if(G[sid])return G[sid];G[sid]=runGate(s,sid).catch(function(){return true});return G[sid]}
function modal(html){var m=document.createElement('div');m.className='dfa-gate';m.setAttribute('role','dialog');m.setAttribute('aria-modal','true');m.innerHTML='<div class="dfa-gate-box">'+html+'</div>';document.body.appendChild(m);var i=m.querySelector('input');if(i)setTimeout(function(){i.focus()},50);return m}
async function bye(text){await sb.auth.signOut({scope:'local'});G={};var m=modal('<h3>Signed out</h3><p>'+esc(text)+'</p><div class="dfa-gate-acts"><a class="btn" href="'+(location.pathname.indexOf('/books/')>=0?'../':'')+'account.html">OK</a></div>');return false}
async function runGate(s,sid){
 try{var ok=sessionStorage.getItem('dfa-ok');if(ok===sid)return true}catch(e){}
 var a=await sb.auth.mfa.getAuthenticatorAssuranceLevel();
 if(a.data&&a.data.nextLevel==='aal2'&&a.data.currentLevel!=='aal2'){if(!(await mfaPrompt()))return false}
 for(var n=0;n<3;n++){var r=await sb.functions.invoke('security',{body:{action:'check',device_id:devId()}});var d=r.data||{};
  if(r.error&&r.error.context&&r.error.context.status===401){var rf=await sb.auth.refreshSession();if(rf.error)return bye('Your login has expired. Please log in again.');continue}
  if(r.error)return true; /* server unreachable: do not lock people out of public pages */
  if(d.ok){try{sessionStorage.setItem('dfa-ok',sid)}catch(e){}return true}
  if(d.blocked)return bye(d.error);
  if(d.challenge==='email')return emailPrompt(d.to,sid);
  return true}
 return true}
function emailPrompt(to,sid){return new Promise(function(res){
 var m=modal('<h3>Confirm it is you</h3><p>For your security we sent a 6-digit code to <b>'+esc(to)+'</b>. Enter it below to finish signing in.</p><form><label>Code<input inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required></label><p class="dfa-gate-msg" role="status"></p><div class="dfa-gate-acts"><button class="btn">Confirm</button><button type="button" class="btn outline" data-r>Send a new code</button><button type="button" class="ac-link" data-x>Log out</button></div></form>');
 var f=m.querySelector('form'),msg=m.querySelector('.dfa-gate-msg');
 f.onsubmit=async function(e){e.preventDefault();var b=f.querySelector('button');b.disabled=true;var r=await sb.functions.invoke('security',{body:{action:'verify_code',code:f.querySelector('input').value,device_id:devId()}});b.disabled=false;
  if(r.data&&r.data.ok){try{sessionStorage.setItem('dfa-ok',sid)}catch(e){}m.remove();res(true)}else msg.textContent=(r.data&&r.data.error)||'Could not check the code. Please try again.'};
 m.querySelector('[data-r]').onclick=async function(){var r=await sb.functions.invoke('security',{body:{action:'resend_code'}});msg.textContent=r.data&&r.data.ok?'A new code is on its way to '+r.data.to+'.':(r.data&&r.data.error)||'Please try again in a minute.'};
 m.querySelector('[data-x]').onclick=async function(){m.remove();await sb.auth.signOut({scope:'local'});G={};res(false);location.reload()}})}
async function mfaPrompt(){var l=await sb.auth.mfa.listFactors();var all=((l.data&&l.data.all)||[]).filter(function(f){return f.status==='verified'});
 var totp=all.filter(function(f){return f.factor_type==='totp'})[0],wa=all.filter(function(f){return f.factor_type==='webauthn'})[0];if(!totp&&!wa)return true;
 return new Promise(function(res){
 var m=modal('<h3>Two-step verification</h3>'+(totp?'<p>Open your authenticator app and enter the 6-digit code for Deutsch Für Alle.</p><form><label>Code<input inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required></label>':'<form>')+'<p class="dfa-gate-msg" role="status"></p><div class="dfa-gate-acts">'+(totp?'<button class="btn">Verify</button>':'')+(wa?'<button type="button" class="btn'+(totp?' outline':'')+'" data-pk>Use passkey / fingerprint</button>':'')+'<button type="button" class="ac-link" data-x>Log out</button></div></form>');
 var f=m.querySelector('form'),msg=m.querySelector('.dfa-gate-msg');
 f.onsubmit=async function(e){e.preventDefault();var r=await sb.auth.mfa.challengeAndVerify({factorId:totp.id,code:f.querySelector('input').value.trim()});if(r.error)msg.textContent='That code did not work. Please wait for the next code and try again.';else{m.remove();sb.functions.invoke('security',{body:{action:'mfa_changed',what:'2FA sign-in (app)'}});res(true)}};
 var pk=m.querySelector('[data-pk]');if(pk)pk.onclick=async function(){try{var r=await sb.auth.mfa.webauthn.authenticate({factorId:wa.id});if(r.error)throw r.error;m.remove();res(true)}catch(x){msg.textContent='The passkey check did not complete. Please try again.'}};
 m.querySelector('[data-x]').onclick=async function(){m.remove();await sb.auth.signOut({scope:'local'});G={};res(false);location.reload()}})}
/* Auto logout after inactivity: admins 30 min; students who did not tick "Keep me logged in" 2 hours. */
var idleT=null,idleOn=0,last=Date.now();function mark(){var t=Date.now();if(t-last>15000){last=t;try{localStorage.setItem('dfa-act',t)}catch(e){}}}
function idleSetup(s){clearInterval(idleT);if(!s)return;var lim=null;
 roleP&&roleP.then(function(adm){lim=adm?30:(remember()?null:120);if(!lim)return;if(!idleOn){idleOn=1;['pointerdown','keydown','scroll','touchstart'].forEach(function(ev){addEventListener(ev,mark,{passive:true})})}last=Date.now();try{localStorage.setItem('dfa-act',last)}catch(e){}
  idleT=setInterval(async function(){var la=last;try{la=Math.max(la,+localStorage.getItem('dfa-act')||0)}catch(e){}if(Date.now()-la>lim*60000){clearInterval(idleT);await sb.auth.signOut({scope:'local'});G={};modal('<h3>Signed out for your security</h3><p>You were inactive for '+(lim>=60?lim/60+' hours':lim+' minutes')+', so we signed you out.</p><div class="dfa-gate-acts"><a class="btn" href="'+(location.pathname.indexOf('/books/')>=0?'../':'')+'account.html">Log in again</a></div>')}},30000)})}
function pwCheck(pw,email){pw=String(pw||'');var lc=String(email||'').split('@')[0].toLowerCase();
 if(pw.length<10)return 'Use at least 10 characters.';if(!/[a-z]/.test(pw)||!/[A-Z]/.test(pw))return 'Use both lowercase and capital letters.';if(!/[0-9]/.test(pw))return 'Add at least one number.';
 if(lc.length>=4&&pw.toLowerCase().indexOf(lc)>=0)return 'Do not use your email name in the password.';
 if(/^(password|passwort|qwerty|deutsch|german|123456|abc123|letmein|welcome|pakistan)/i.test(pw.replace(/[^a-z0-9]/gi,'')))return 'This password is too easy to guess. Please choose another.';return ''}
function eyes(root){(root||document).querySelectorAll('input[type=password]:not([data-eye])').forEach(function(i){i.setAttribute('data-eye','1');var w=document.createElement('span');w.className='pw-wrap';i.parentNode.insertBefore(w,i);w.appendChild(i);var b=document.createElement('button');b.type='button';b.className='pw-eye';b.setAttribute('aria-label','Show password');b.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 5c-5 0-9 4.5-10 7 1 2.5 5 7 10 7s9-4.5 10-7c-1-2.5-5-7-10-7zm0 11.5A4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 0 1 0 9zm0-7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"/></svg>';
 b.onclick=function(){var sh=i.type==='password';i.type=sh?'text':'password';b.setAttribute('aria-label',sh?'Hide password':'Show password');b.classList.toggle('on',sh)};w.appendChild(b)})}
/* Turnstile (only when a site key is configured) */
var tsP=null;function turnstile(el){if(!FEATURES.turnstile||!el)return Promise.resolve(null);if(!tsP)tsP=new Promise(function(ok){var sc=document.createElement('script');sc.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';sc.async=true;sc.onload=function(){ok(window.turnstile)};document.head.appendChild(sc)});
 return tsP.then(function(t){var box={token:null};box.id=t.render(el,{sitekey:FEATURES.turnstile,appearance:'always',callback:function(k){box.token=k},'expired-callback':function(){box.token=null}});box.reset=function(){box.token=null;try{t.reset(box.id)}catch(e){}};return box})}

window.DFA={gate:gate,devId:devId,pwCheck:pwCheck,eyes:eyes,turnstile:turnstile,jwt:jwt,receiptPills:receiptPills,paysFor:paysFor,certPill:certPill,invoke:invoke,sb:sb,esc:esc,profile:profile,setRemember:setRemember,remember:remember,FEATURES:FEATURES,SITE:'https://www.deutschfuralle.com'};
})();
