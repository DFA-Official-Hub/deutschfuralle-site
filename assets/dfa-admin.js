(function(){
var sb=DFA.sb,E=DFA.esc,app=document.getElementById('adm-app'),COURSES=[],PUB=null;
function d(x){return x?new Date(x.length===10?x+'T00:00:00':x).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}):''}
function today(){return new Date(Date.now()+5*3600e3).toISOString().slice(0,10)}
function table(cols,rows){return '<div class="adm-scroll"><table class="adm"><thead><tr>'+cols.map(function(c){return '<th>'+c+'</th>'}).join('')+'</tr></thead><tbody>'+rows.map(function(r){return '<tr'+(r.attr||'')+'>'+r.cells.map(function(c,i){return '<td data-l="'+cols[i]+'"'+(c.cls?' class="'+c.cls+'"':'')+'>'+(c.h!=null?c.h:E(c))+'</td>'}).join('')+'</tr>'}).join('')+'</tbody></table></div>'}
async function init(){var p=await DFA.profile();
 if(!p||p.role!=='admin'){app.innerHTML='<div class="ac-card"><h2>Not available</h2><p>This page is for site staff only. <a href="account.html">Go to your account</a>.</p></div>';return}
 COURSES=(await sb.from('courses').select('*').order('duration_days')).data||[];
 app.innerHTML='<div class="ac-tabs adm-tabs" role="tablist"><button type="button" role="tab" aria-selected="true" data-t="en">Students</button><button type="button" role="tab" aria-selected="false" data-t="rv">Reviews</button><button type="button" role="tab" aria-selected="false" data-t="us">Accounts</button></div><div id="adm-body"></div>';
 app.querySelectorAll('[data-t]').forEach(function(b){b.onclick=function(){app.querySelectorAll('[data-t]').forEach(function(x){x.setAttribute('aria-selected',x===b)});({en:enr,rv:reviews,us:users})[b.dataset.t]();try{history.replaceState(null,'','#'+{en:'students',rv:'reviews',us:'accounts'}[b.dataset.t])}catch(e){}}});
 var hm={students:'en',reviews:'rv',accounts:'us'}[location.hash.slice(1)]||'en';app.querySelector('[data-t="'+hm+'"]').click()}
 addEventListener('hashchange',function(){var t={students:'en',reviews:'rv',accounts:'us'}[location.hash.slice(1)];var b=t&&app.querySelector('[data-t="'+t+'"]');if(b&&b.getAttribute('aria-selected')!=='true')b.click()});
function copts(sel){return '<option value="">Pick course…</option>'+COURSES.map(function(c){return '<option value="'+c.code+'"'+(c.code===sel?' selected':'')+'>'+E(c.name)+' ('+c.duration_days+' days)</option>'}).join('')}
async function enr(filter){filter=filter||'pending';var B=document.getElementById('adm-body');B.innerHTML='<p>Loading…</p>';
 var q=sb.from('enrollments').select('*').order('created_at',{ascending:false}).limit(300);if(filter!=='all')q=q.eq('status',filter);var r=await q;if(r.error){B.textContent=r.error.message;return}
 var h='<div class="adm-bar"><label>Show <select id="enf">'+['pending','active','expired','revoked','all'].map(function(s){return '<option'+(s===filter?' selected':'')+'>'+s+'</option>'}).join('')+'</select></label><span>'+r.data.length+' found</span><button type="button" class="btn outline sm" id="enadd">Add student</button><button type="button" class="btn outline sm" id="cimg">Certificate images: …</button></div><div id="enform"></div>';
 h+=r.data.length?table(['Student','Course','Status','Access','Actions'],r.data.map(function(x){var pend=x.status==='pending';return {attr:' data-id="'+x.id+'"',cells:[
  {h:'<b>'+E(x.full_name||'–')+'</b><br><span class="adm-mut">'+E(x.email)+'</span><br><span class="adm-mut">Registered '+d(x.created_at)+'</span>'},
  {h:pend?'<select data-c>'+copts(x.course_code)+'</select>'+(x.course_label&&!x.course_code?'<br><span class="adm-mut">Form: '+E(x.course_label)+'</span>':''):E((COURSES.find(function(c){return c.code===x.course_code})||{}).name||x.course_label||'')},
  {cls:'adm-stc',h:(function(){var m=[],L=[];
   if(x.welcome_sent_at)m.push('Welcome sent');if(x.student_id)m.push(E(x.student_id)+(x.batch_code?' · '+E(x.batch_code):''));if(x.invoice_no)m.push('Invoice '+E(x.invoice_no));
   if(x.certificate_no)m.push((x.certificate_revoked_at?'<b>Certificate revoked</b>':'Certificate '+E(x.certificate_no)));else if(x.certificate_hold)m.push('Certificate on hold');
   if(x.invoice_no){L.push('<a class="adm-pill" target="_blank" rel="noopener" href="doc.html?id='+x.id+'&type=admission">View admission form</a>');L.push('<a class="adm-pill" target="_blank" rel="noopener" href="doc.html?id='+x.id+'&type=receipt">View receipt PDF</a>')}
   if(x.receipt_url&&/^https:\/\//.test(x.receipt_url))L.push('<a class="adm-pill" href="'+E(x.receipt_url)+'" target="_blank" rel="noopener">View receipt</a>');else if(pend)m.push('No receipt uploaded');
   if(x.certificate_no){L.push('<a class="adm-pill" href="verify.html?code='+encodeURIComponent(x.certificate_code||'')+'" target="_blank" rel="noopener">Verify certificate</a>');L.push('<a class="adm-pill" target="_blank" rel="noopener" href="doc.html?id='+x.id+'&type=cert">View image</a>')}
   return '<span class="adm-st st-'+x.status+'">'+x.status+'</span>'+(m.length?'<ul class="adm-meta">'+m.map(function(t){return '<li>'+t+'</li>'}).join('')+'</ul>':'')+(x.docs_error?'<p class="adm-mut">Documents: '+E(x.docs_error)+'</p>':'')+(L.length?'<div class="adm-links">'+L.join('')+'</div>':'')})()},
  {h:pend?'<label class="adm-mut">Start <input type="date" data-s value="'+today()+'"></label>':(x.start_date?d(x.start_date)+' → '+d(x.end_date):'')},
  {cls:'adm-a',h:pend?'<button type="button" class="btn sm" data-a="pay">Payment received</button><button type="button" class="btn outline sm danger" data-a="rev">Remove</button>':((x.status==='active'||x.status==='expired')&&!x.certificate_no?'<button type="button" class="btn sm" data-a="cert" data-end="'+E(x.end_date||'')+'">Issue participation certificate</button><button type="button" class="btn outline sm" data-a="hold" data-h="'+(x.certificate_hold?0:1)+'">'+(x.certificate_hold?'Release certificate hold':'Hold certificate')+'</button>':'')+(x.certificate_no?'<button type="button" class="btn outline sm'+(x.certificate_revoked_at?'':' danger')+'" data-a="crev" data-u="'+(x.certificate_revoked_at?1:0)+'">'+(x.certificate_revoked_at?'Restore certificate':'Revoke certificate')+'</button>':'')+(x.status==='active'?'<button type="button" class="btn outline sm danger" data-a="rev">Revoke</button>':'')}]}})):'<p>Nothing here.</p>';
 B.innerHTML=h;
 B.querySelector('#enf').onchange=function(){enr(this.value)};
 (async function(){var cb=B.querySelector('#cimg');var pub=null;
  async function show(on){var r2=await sb.functions.invoke('admission',{body:{action:'cert_images',on:on}});if(r2.data)PUB=pub=r2.data.public;cb.textContent='Certificate images for students: '+(pub?'ON':'OFF (only you can preview)')}
  cb.textContent='Certificate images for students: ?';cb.onclick=function(){if(pub===null)return;var on=!pub;if(!confirm(on?'Show certificate images on the verify page and student portal, and save copies to Drive?':'Hide certificate images from students again?'))return;show(on)};
  if(PUB!==null)pub=PUB;else{var r3=await sb.functions.invoke('admission',{body:{action:'cert_images_status'}});PUB=pub=!!(r3.data&&r3.data.public)}cb.textContent='Certificate images for students: '+(pub?'ON':'OFF (only you can preview)')})();
 B.querySelectorAll('[data-doc]').forEach(function(a){a.onclick=async function(ev){ev.preventDefault();var w=window.open('','_blank'),t=a.textContent;a.textContent='Opening…';var r5=await sb.functions.invoke('admission',{body:{action:'doc_file_admin',id:+a.dataset.di,kind:a.dataset.doc}});a.textContent=t;
  if(r5.data&&r5.data.url){if(w)w.location=r5.data.url;else location.href=r5.data.url}else{if(w)w.close();alert((r5.data&&r5.data.error)||'Could not open the document.')}}});
 B.querySelectorAll('[data-ci]').forEach(function(a){a.onclick=async function(ev){ev.preventDefault();var w=window.open('','_blank');a.textContent='Creating…';var r4=await sb.functions.invoke('admission',{body:{action:'cert_file_admin',id:+a.dataset.ci}});a.textContent='View image';
  if(r4.data&&r4.data.url){if(w)w.location=r4.data.url;else location.href=r4.data.url}else{if(w)w.close();alert((r4.data&&r4.data.error)||'Could not create the certificate image.')}}});
 B.querySelector('#enadd').onclick=function(){var f=B.querySelector('#enform');f.innerHTML='<form class="adm-add"><input name="email" type="email" placeholder="Student email" required><input name="name" placeholder="Full name"><select name="course" required>'+copts('')+'</select><button class="btn sm">Add as pending</button></form>';
  f.querySelector('form').onsubmit=async function(e){e.preventDefault();var res=await sb.from('enrollments').insert({email:this.email.value,full_name:this.name.value||null,course_code:this.course.value,course_label:null,source:'manual'});if(res.error)return alert(res.error.message);enr('pending')}};
 B.querySelectorAll('[data-a]').forEach(function(b){b.onclick=async function(){var tr=b.closest('tr'),id=+tr.dataset.id,res;
  if(b.dataset.a==='hold'||b.dataset.a==='crev'){var hold=b.dataset.a==='hold',on=hold?b.dataset.h==='1':b.dataset.u!=='1';
   if(!confirm(hold?(on?'Hold this certificate? It will NOT be issued automatically when the course ends (e.g. the student did not attend).':'Release the hold? The certificate will be issued automatically after the course ends.'):(on?'Revoke this certificate? The verify page will stop showing it as valid.':'Restore this certificate as valid?')))return;
   b.disabled=true;res=await sb.functions.invoke('admission',{body:hold?{action:'cert_hold',id:id,hold:on}:{action:'cert_revoke',id:id,undo:!on}});b.disabled=false;
   if(res.error||(res.data&&res.data.error)){alert((res.data&&res.data.error)||'Something went wrong.');return}enr();return}
  if(b.dataset.a==='cert'){var end=b.dataset.end?new Date(Date.parse(b.dataset.end)-15*864e5).toISOString().slice(0,10):'',today=new Date().toISOString().slice(0,10);
   if(end&&end>today){if(!confirm('This course ends on '+end+'. Issue the participation certificate early anyway?'))return}else if(!confirm('Issue a Course Participation Certificate for this student?'))return;
   b.disabled=true;res=await sb.functions.invoke('admission',{body:{action:'certify',id:id}});b.disabled=false;
   if(res.error||(res.data&&res.data.error)){alert((res.data&&res.data.error)||'Could not issue the certificate.');return}
   alert('Certificate '+res.data.certificate_no+' issued.\nVerify link: '+DFA.SITE+'/verify.html?code='+res.data.certificate_code);enr();return}
  if(b.dataset.a==='pay'){var c=tr.querySelector('[data-c]').value,s=tr.querySelector('[data-s]').value;if(!c)return alert('Pick the course first.');
   if(!confirm('Have you checked that this fee is really in the bank account?\n\nMark payment received and open access from '+s+'? This creates the invoice, admission form and fee receipt (and emails them to the student when emails are switched on).'))return;b.disabled=true;
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
