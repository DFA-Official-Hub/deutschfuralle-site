(function(){var car=document.querySelector('.car');if(!car)return;var tr=car.querySelector('.car-track'),S=[].slice.call(tr.children),D=[].slice.call(document.querySelectorAll('.cd')),cnt=document.querySelector('.car-count'),pv=car.querySelector('.prev'),nx=car.querySelector('.next'),cur=0,N=S.length;
function go(i){i=Math.max(0,Math.min(N-1,i));tr.scrollTo({left:S[i].offsetLeft,behavior:'smooth'})}
function upd(){var i=Math.round(tr.scrollLeft/tr.clientWidth);if(i===cur&&cnt.dataset.ok)return;cnt.dataset.ok=1;cur=i;D.forEach(function(d,j){d.classList.toggle('on',j===i);d.setAttribute('aria-current',j===i?'true':'false')});cnt.textContent=(i+1)+' / '+N;pv.disabled=i===0;nx.disabled=i===N-1;S.forEach(function(s,j){var v=s.querySelector('video');if(v&&j!==i)v.pause()})}
var t;tr.addEventListener('scroll',function(){clearTimeout(t);t=setTimeout(upd,60)},{passive:true});
pv.onclick=function(){go(cur-1)};nx.onclick=function(){go(cur+1)};D.forEach(function(d,j){d.onclick=function(){go(j)}});
tr.addEventListener('keydown',function(e){if(e.key==='ArrowLeft'){e.preventDefault();go(cur-1)}if(e.key==='ArrowRight'){e.preventDefault();go(cur+1)}});
/* mouse drag on desktop */
var dn=false,sx=0,sl=0,mv=false;tr.addEventListener('mousedown',function(e){if(e.target.tagName==='VIDEO')return;dn=true;mv=false;sx=e.pageX;sl=tr.scrollLeft;tr.style.scrollSnapType='none';tr.style.scrollBehavior='auto'});
window.addEventListener('mousemove',function(e){if(!dn)return;var dx=e.pageX-sx;if(Math.abs(dx)>5)mv=true;tr.scrollLeft=sl-dx});
window.addEventListener('mouseup',function(e){if(!dn)return;dn=false;tr.style.scrollSnapType='';tr.style.scrollBehavior='';var dx=e.pageX-sx;go(Math.abs(dx)>50?cur+(dx<0?1:-1):cur)});
/* lightbox */
var lb=document.getElementById('lb'),B=document.getElementById('lbBody'),C=document.getElementById('lbCap'),li=0,lx=0;
function show(i){li=(i+N)%N;var s=S[li].dataset;B.innerHTML=s.t==='vid'?'<video src="'+s.s+'" controls autoplay muted playsinline></video>':'<img src="'+s.s+'" alt="'+s.a.replace(/"/g,'&quot;')+'">';C.textContent=(li+1)+' / '+N+' · '+s.a}
function open(i){S.forEach(function(s){var v=s.querySelector('video');if(v)v.pause()});show(i);lb.hidden=false;document.body.style.overflow='hidden';lb.querySelector('.lb-x').focus()}
function close(){lb.hidden=true;B.innerHTML='';document.body.style.overflow='';go(li);document.querySelector('.car-zoom').focus()}
S.forEach(function(s,j){if(s.dataset.t==='img')s.addEventListener('click',function(){if(!mv)open(j)})});
document.querySelector('.car-zoom').onclick=function(){open(cur)};
lb.querySelector('.lb-x').onclick=close;lb.querySelector('.lb-p').onclick=function(){show(li-1)};lb.querySelector('.lb-n').onclick=function(){show(li+1)};
lb.addEventListener('click',function(e){if(e.target===lb||e.target===B)close()});
lb.addEventListener('touchstart',function(e){lx=e.touches[0].clientX},{passive:true});lb.addEventListener('touchend',function(e){var dx=e.changedTouches[0].clientX-lx;if(Math.abs(dx)>50)show(li+(dx<0?1:-1))});
document.addEventListener('keydown',function(e){if(lb.hidden)return;if(e.key==='Escape')close();if(e.key==='ArrowLeft')show(li-1);if(e.key==='ArrowRight')show(li+1)});upd()})();
