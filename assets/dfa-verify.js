(function(){
var sb=DFA.sb,E=DFA.esc,out=document.getElementById('vf-out'),inp=document.getElementById('vf-code');
function d(x){return x?new Date(String(x).slice(0,10)+'T00:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}):'–'}
async function check(code){code=String(code||'').trim().toUpperCase();if(!code)return;inp.value=code;out.innerHTML='<p>Checking…</p>';
 var r=await sb.functions.invoke('admission',{body:{action:'verify',code:code}});var x=r.data||{};
 if(x.revoked){out.innerHTML='<p><b>This certificate has been withdrawn</b> and is no longer valid. Questions? Write to <a href="mailto:contact.deutschfuralle@gmail.com">contact.deutschfuralle@gmail.com</a>.</p>';return}
 if(r.error||!x.found){out.innerHTML=x.unreleased?'<p><b>No released certificate found for this code.</b> If the course has just finished, the certificate may not be released yet. Please try again later, or write to <a href="mailto:contact.deutschfuralle@gmail.com">contact.deutschfuralle@gmail.com</a>.</p>':'<p><b>No certificate found for this code.</b> Please check the code on the certificate, or write to <a href="mailto:contact.deutschfuralle@gmail.com">contact.deutschfuralle@gmail.com</a>.</p>';return}
 out.innerHTML='<div class="vf-ok"><span class="vf-badge"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>Valid</span><h2 class="vf-title">DFA Course Participation Certificate</h2></div><dl class="vf-dl">'+
  '<dt>Name</dt><dd>'+E(x.name||'–')+'</dd><dt>Course</dt><dd>'+E(x.course||'–')+'</dd>'+
  '<dt>Course dates</dt><dd>'+d(x.start_date)+' – '+d(x.end_date)+'</dd>'+
  '<dt>Certificate no.</dt><dd>'+E(x.certificate_no)+'</dd><dt>Issued</dt><dd>'+d(x.issued_at)+'</dd></dl>'+
  (x.image&&x.image.url?'<a href="'+E(x.image.url)+'" target="_blank" rel="noopener"><img class="cert-img" src="'+E(x.image.url)+'" alt="Certificate '+E(x.certificate_no)+'"></a><p><a class="btn sm" href="'+E(x.image.download||x.image.url)+'">Download certificate</a></p>':'')}
document.getElementById('vf-form').onsubmit=function(e){e.preventDefault();history.replaceState(null,'','?code='+encodeURIComponent(inp.value.trim().toUpperCase()));check(inp.value)};
var q=new URLSearchParams(location.search).get('code');if(q)check(q);
})();
