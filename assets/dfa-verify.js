(function(){
var sb=DFA.sb,E=DFA.esc,out=document.getElementById('vf-out'),inp=document.getElementById('vf-code');
function d(x){return x?new Date(String(x).slice(0,10)+'T00:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}):'–'}
async function check(code){code=String(code||'').trim().toUpperCase();if(!code)return;inp.value=code;out.innerHTML='<p>Checking…</p>';
 var r=await sb.functions.invoke('admission',{body:{action:'verify',code:code}});var x=r.data||{};
 if(r.error||!x.found){out.innerHTML='<p><b>No certificate found for this code.</b> Please check the code on the certificate, or write to <a href="mailto:contact.deutschfuralle@gmail.com">contact.deutschfuralle@gmail.com</a>.</p>';return}
 out.innerHTML='<h2>Valid DFA Course Participation Certificate</h2><dl class="vf-dl">'+
  '<dt>Name</dt><dd>'+E(x.name||'–')+'</dd><dt>Course</dt><dd>'+E(x.course||'–')+'</dd>'+
  '<dt>Course dates</dt><dd>'+d(x.start_date)+' – '+d(x.end_date)+'</dd>'+
  '<dt>Certificate no.</dt><dd>'+E(x.certificate_no)+'</dd><dt>Issued</dt><dd>'+d(x.issued_at)+'</dd></dl>'+
  '<p class="adm-mut">This certificate only confirms participation in a Deutsch Für Alle course. It is not affiliated with or issued by the Goethe-Institut, ÖSD, ECL or any other exam body, and it has no connection with any embassy.</p>'}
document.getElementById('vf-form').onsubmit=function(e){e.preventDefault();history.replaceState(null,'','?code='+encodeURIComponent(inp.value.trim().toUpperCase()));check(inp.value)};
var q=new URLSearchParams(location.search).get('code');if(q)check(q);
})();
