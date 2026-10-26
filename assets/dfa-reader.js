(function(){
var sb=DFA.sb,E=DFA.esc,app=document.getElementById('reader-app'),cv=document.getElementById('rd-canvas'),ctx=cv.getContext('2d');
var book=new URLSearchParams(location.search).get('book')||'',page=1,pages=0,busy=false;
var dev=localStorage.getItem('dfa-device');if(!dev){dev=(crypto.randomUUID?crypto.randomUUID():String(Math.random()).slice(2)+Date.now());localStorage.setItem('dfa-device',dev)}
var st=document.getElementById('rd-status'),pg=document.getElementById('rd-page');
['contextmenu','dragstart','selectstart','copy'].forEach(function(ev){document.addEventListener(ev,function(e){if(e.target.closest('#reader-app'))e.preventDefault()})});
document.addEventListener('keydown',function(e){var k=e.key.toLowerCase();if((e.ctrlKey||e.metaKey)&&(k==='s'||k==='p'||k==='c'))e.preventDefault();if(k==='arrowright')go(page+1);if(k==='arrowleft')go(page-1)});
window.addEventListener('beforeprint',function(){ctx.clearRect(0,0,cv.width,cv.height)});
async function go(n){if(busy||n<1||(pages&&n>pages))return;busy=true;st.textContent='Loading page '+n+'…';
 var r=await sb.functions.invoke('reader',{body:{book:book,page:n,device:dev}});busy=false;
 if(r.error||!r.data||!r.data.url){var m=r.data&&(r.data.message||r.data.error);if(!m&&r.error&&r.error.context&&r.error.context.json){try{var j=await r.error.context.json();m=j.message||j.error}catch(e){}}
  st.textContent=m||'This page could not be opened.';return}
 pages=r.data.pages;page=n;document.getElementById('rd-title').textContent=r.data.title||'';
 var blob=await (await fetch(r.data.url,{cache:'no-store'})).blob(),bmp=await createImageBitmap(blob);
 cv.width=bmp.width;cv.height=bmp.height;ctx.drawImage(bmp,0,0);bmp.close&&bmp.close();
 pg.textContent='Page '+page+' of '+pages;st.textContent='';document.getElementById('rd-prev').disabled=page<=1;document.getElementById('rd-next').disabled=page>=pages}
document.getElementById('rd-prev').onclick=function(){go(page-1)};document.getElementById('rd-next').onclick=function(){go(page+1)};
DFA.sb.auth.getSession().then(function(s){if(!s.data.session){app.innerHTML='<div class="ac-card"><h2>Please log in</h2><p>The online reader is for enrolled students.</p><a class="btn" href="account.html?next='+encodeURIComponent('/reader.html?book='+book)+'">Log in</a></div>';return}go(1)});
})();
