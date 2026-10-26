(function(){
var sb=DFA.sb,E=DFA.esc,app=document.getElementById('adm-app'),COURSES=[];
function d(x){return x?new Date(x.length===10?x+'T00:00:00':x).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}):''}
function today(){return new Date(Date.now()+5*3600e3).toISOString().slice(0,10)}
function table(cols,rows){return '<div class="adm-scroll"><table class="adm"><thead><tr>'+cols.map(function(c){return '<th>'+c+'</th>'}).join('')+'</tr></thead><tbody>'+rows.map(function(r){return '<tr'+(r.attr||'')+'>'+r.cells.map(function(c,i){return '<td data-l="'+cols[i]+'"'+(c.cls?' class="'+c.cls+'"':'')+'>'+(c.h!=null?c.h:E(c))+'</td>'}).join('')+'</tr>'}).join('')+'</tbody></table></div>'}
async function init(){var p=await DFA.profile();
 if(!p||p.role!=='admin'){app.innerHTML='<div class="ac-card"><h2>Not available</h2><p>This page is for site staff only. <a href="account.html">Go to your account</a>.</p></div>';return}
 COURSES=(await sb.from('courses').select('*').order('duration_days')).data||[];
 app.innerHTML='<div class="ac-tabs adm-tabs" role="tablist"><button type="button" role="tab" aria-selected="true" data-t="en">Students</button><button type="button" role="tab" aria-selected="false" data-t="rv">Reviews</button><button type="button" role="tab" aria-selected="false" data-t="us">Accounts</button></div><div id="adm-body"></div>';
 app.querySelectorAll('[data-t]').forEach(function(b){b.onclick=function(){app.querySelectorAll('[data-t]').forEach(function(x){x.setAttribute('aria-selected',x===b)});({en:enr,rv:reviews,us:users})[b.dataset.t]()}});enr()}
function copts(sel){return '<option value="">Pick course…</option>'+COURSES.map(function(c){return '<option value="'+c.code+'"'+(c.code===sel?' selected':'')+'>'+E(c.name)+' ('+c.duration_days+' days)</option>'}).join('')}
async function enr(filter){filter=filter||'pending';var B=document.getElementById('adm-body');B.innerHTML='<p>Loading…</p>';
 var q=sb.from('enrollments').select('*').order('created_at',{ascending:false}).limit(300);if(filter!=='all')q=q.eq('status',filter);var r=await q;if(r.error){B.textContent=r.error.message;return}
 var h='<div class="adm-bar"><label>Show <select id="enf">'+['pending','active','expired','revoked','all'].map(function(s){return '<option'+(s===filter?' selected':'')+'>'+s+'</option>'}).join('')+'</select></label><span>'+r.data.length+' found</span><button type="button" class="btn outline sm" id="enadd">Add student</button></div><div id="enform"></div>';
 h+=r.data.length?table(['Student','Course','Status','Access','Actions'],r.data.map(function(x){var pend=x.status==='pending';return {attr:' data-id="'+x.id+'"',cells:[
  {h:'<b>'+E(x.full_name||'–')+'</b><br><span class="adm-mut">'+E(x.email)+'</span><br><span class="adm-mut">Registered '+d(x.created_at)+'</span>'},
  {h:pend?'<select data-c>'+copts(x.course_code)+'</select>'+(x.course_label&&!x.course_code?'<br><span class="adm-mut">Form: '+E(x.course_label)+'</span>':''):E((COURSES.find(function(c){return c.code===x.course_code})||{}).name||x.course_label||'')},
  {h:'<span class="adm-st st-'+x.status+'">'+x.status+'</span>'+(x.welcome_sent_at?'<br><span class="adm-mut">Welcome sent</span>':'')+(x.receipt_url&&/^https:\/\//.test(x.receipt_url)?'<br><a href="'+E(x.receipt_url)+'" target="_blank" rel="noopener">View receipt</a>':(pend?'<br><span class="adm-mut">No receipt uploaded</span>':''))},
  {h:pend?'<label class="adm-mut">Start <input type="date" data-s value="'+today()+'"></label>':(x.start_date?d(x.start_date)+' → '+d(x.end_date):'')},
  {cls:'adm-a',h:pend?'<button type="button" class="btn sm" data-a="pay">Payment received</button><button type="button" class="btn outline sm danger" data-a="rev">Remove</button>':x.status==='active'?'<button type="button" class="btn outline sm danger" data-a="rev">Revoke</button>':''}]}})):'<p>Nothing here.</p>';
 B.innerHTML=h;
 B.querySelector('#enf').onchange=function(){enr(this.value)};
 B.querySelector('#enadd').onclick=function(){var f=B.querySelector('#enform');f.innerHTML='<form class="adm-add"><input name="email" type="email" placeholder="Student email" required><input name="name" placeholder="Full name"><select name="course" required>'+copts('')+'</select><button class="btn sm">Add as pending</button></form>';
  f.querySelector('form').onsubmit=async function(e){e.preventDefault();var res=await sb.from('enrollments').insert({email:this.email.value,full_name:this.name.value||null,course_code:this.course.value,course_label:null,source:'manual'});if(res.error)return alert(res.error.message);enr('pending')}};
 B.querySelectorAll('[data-a]').forEach(function(b){b.onclick=async function(){var tr=b.closest('tr'),id=+tr.dataset.id,res;
  if(b.dataset.a==='pay'){var c=tr.querySelector('[data-c]').value,s=tr.querySelector('[data-s]').value;if(!c)return alert('Pick the course first.');
   if(!confirm('Mark payment received and open access from '+s+'?'))return;b.disabled=true;
   res=await sb.functions.invoke('admission',{body:{action:'activate',id:id,course_code:c,start_date:s}});b.disabled=false;
   if(res.error||res.data&&res.data.error)return alert((res.data&&res.data.error)||res.error.message);
   alert('Activated until '+d(res.data.enrollment.end_date)+'. Welcome email: '+(res.data.email==='sent'?'sent':'not sent (email sending is switched off)'));enr(filter);return}
  if(!confirm(b.textContent+' this enrollment?'))return;
  res=b.textContent==='Remove'?await sb.from('enrollments').delete().eq('id',id):await sb.from('enrollments').update({status:'revoked'}).eq('id',id);if(res.error)alert(res.error.message);enr(filter)}})}
async function reviews(){var B=document.getElementById('adm-body');B.innerHTML='<p>Loading…</p>';
 var r=await sb.from('reviews').select('*').order('created_at',{ascending:false});if(r.error){B.textContent=r.error.message;return}
 if(!r.data.length){B.innerHTML='<p>No reviews yet.</p>';return}
 B.innerHTML=table(['Book','User','Stars','Comment','Date','Status','Actions'],r.data.map(function(x){return {attr:' data-id="'+x.id+'"'+(x.hidden?' class="is-hidden"':''),cells:[{h:'<a href="books/'+E(x.book_slug)+'.html#reviews">'+E(x.book_slug)+'</a>'},x.username,String(x.rating),{cls:'adm-c',h:E(x.comment)},d(x.created_at),{h:(x.hidden?'Hidden':'Visible')+(x.verified_buyer?'<br><b>Verified buyer</b>':'')},{cls:'adm-a',h:'<button type="button" class="btn outline sm" data-a="hide">'+(x.hidden?'Show':'Hide')+'</button><button type="button" class="btn outline sm" data-a="vb">'+(x.verified_buyer?'Unverify':'Verify buyer')+'</button><button type="button" class="btn outline sm danger" data-a="del">Delete</button>'}]}}));
 B.querySelectorAll('[data-a]').forEach(function(b){b.onclick=async function(){var tr=b.closest('tr'),id=+tr.dataset.id,x=r.data.find(function(y){return y.id===id}),res;
  if(b.dataset.a==='del'){if(!confirm('Delete this review for good?'))return;res=await sb.from('reviews').delete().eq('id',id)}
  else res=await sb.from('reviews').update(b.dataset.a==='hide'?{hidden:!x.hidden}:{verified_buyer:!x.verified_buyer}).eq('id',id);
  if(res.error)alert(res.error.message);reviews()}})}
async function users(){var B=document.getElementById('adm-body');B.innerHTML='<p>Loading…</p>';
 var r=await sb.from('profiles').select('*').order('created_at',{ascending:false});if(r.error){B.textContent=r.error.message;return}
 B.innerHTML='<p>'+r.data.length+' account'+(r.data.length===1?'':'s')+'</p>'+table(['Username','Name','Country','Phone','Role','Joined','Reader'],r.data.map(function(x){return {attr:' data-u="'+x.id+'"',cells:[x.username,x.full_name||'',x.country||'',x.phone||'',x.role,d(x.created_at),{cls:'adm-a',h:'<button type="button" class="btn outline sm" data-a="dev">Reset devices</button>'}]}}));
 B.querySelectorAll('[data-a=dev]').forEach(function(b){b.onclick=async function(){var res=await sb.from('reader_devices').delete().eq('user_id',b.closest('tr').dataset.u);alert(res.error?res.error.message:'Devices cleared.')}})}
init();})();
