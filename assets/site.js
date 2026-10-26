(()=>{const h=document.querySelector('header.site');let hq=0;const on=()=>{hq=0;h.classList.toggle('shrink',scrollY>40)};addEventListener('scroll',()=>{if(!hq)hq=requestAnimationFrame(on)},{passive:true});on();
const t=document.querySelector('.menu-toggle'),n=document.getElementById('nav');t.addEventListener('click',()=>{const o=n.classList.toggle('open');t.setAttribute('aria-expanded',o)});
const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in-view');io.unobserve(e.target)}}),{threshold:.12,rootMargin:'0px 0px -40px 0px'});
document.querySelectorAll('.reveal').forEach(el=>io.observe(el));
const co=new IntersectionObserver(es=>es.forEach(e=>{if(!e.isIntersecting)return;co.unobserve(e.target);const el=e.target,to=+el.dataset.to,t0=performance.now(),d=1400;
const step=now=>{const p=Math.min(1,(now-t0)/d);el.textContent=Math.round(to*(1-Math.pow(1-p,3)));if(p<1)requestAnimationFrame(step)};requestAnimationFrame(step)}),{threshold:.6});
document.querySelectorAll('.count').forEach(el=>co.observe(el));
document.querySelectorAll('.carousel-sec').forEach(sec=>{const tr=sec.querySelector('.track'),sl=[...tr.children],dots=sec.querySelector('.dots');let i=0;
const per=()=>Math.max(1,Math.round(tr.parentElement.clientWidth/sl[0].getBoundingClientRect().width));const max=()=>Math.max(0,sl.length-per());
const go=k=>{i=k>max()?0:k<0?max():k;const gap=parseFloat(getComputedStyle(tr).gap)||0;tr.style.transform=`translateX(${-i*(sl[0].getBoundingClientRect().width+gap)}px)`;
[...dots.children].forEach((d,j)=>d.classList.toggle('on',j===i))};
const build=()=>{dots.innerHTML='';for(let j=0;j<=max();j++){const b=document.createElement('button');b.setAttribute('aria-label','Slide '+(j+1));b.onclick=()=>{go(j);rs()};dots.appendChild(b)}go(Math.min(i,max()))};
sec.querySelector('.prev').onclick=()=>{go(i-1);rs()};sec.querySelector('.next').onclick=()=>{go(i+1);rs()};
let tm;const rs=()=>{clearInterval(tm);tm=setInterval(()=>go(i+1),3800)};sec.addEventListener('mouseenter',()=>clearInterval(tm));sec.addEventListener('mouseleave',rs);
addEventListener('resize',build);build();rs();new IntersectionObserver(([e])=>e.isIntersecting?rs():clearInterval(tm)).observe(sec)});})();

(()=>{const d=document,b=d.body;
/* back to top */
const tt=d.querySelector('.totop');let sq=0;const so=()=>{sq=0;tt.classList.toggle('show',scrollY>700);b.classList.toggle('scrolled',scrollY>500)};addEventListener('scroll',()=>{if(!sq)sq=requestAnimationFrame(so)},{passive:true});
/* hide floating buttons while the footer is visible */
const ft=d.querySelector('footer.site');if(ft)new IntersectionObserver(([e])=>b.classList.toggle('foot-in',e.isIntersecting)).observe(ft);
/* pause infinite CSS animations when offscreen */
const ao=new IntersectionObserver(es=>es.forEach(e=>e.target.classList.toggle('anim-off',!e.isIntersecting)));
d.querySelectorAll('.hero,.marquee,.page-head,section').forEach(el=>ao.observe(el));
tt.addEventListener('click',()=>{scrollTo({top:0,behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth'});d.querySelector('.brand').focus({preventScroll:true})});
/* keyboard dropdowns: Esc closes, aria-expanded mirrors state */
d.querySelectorAll('.has-sub').forEach(li=>{const a=li.querySelector(':scope>a');a.setAttribute('aria-haspopup','true');a.setAttribute('aria-expanded','false');
const set=o=>{li.classList.toggle('open',o);a.setAttribute('aria-expanded',o)};
li.addEventListener('mouseenter',()=>set(true));li.addEventListener('mouseleave',()=>set(false));
li.addEventListener('focusin',()=>set(true));li.addEventListener('focusout',e=>{if(!li.contains(e.relatedTarget))set(false)});
li.addEventListener('keydown',e=>{if(e.key==='Escape'){set(false);a.focus();li.classList.add('esc');}});});
d.addEventListener('keydown',e=>{const n=d.getElementById('nav'),t=d.querySelector('.menu-toggle');if(e.key==='Escape'&&n.classList.contains('open')){n.classList.remove('open');t.setAttribute('aria-expanded','false');t.focus()}});
/* custom cursor: fine pointers only, no reduced motion */
const fine=matchMedia('(hover:hover) and (pointer:fine)').matches,rm=matchMedia('(prefers-reduced-motion:reduce)').matches;if(!fine)return;
const dot=d.createElement('div'),ring=d.createElement('div');dot.className='cur-dot';ring.className='cur-ring';[dot,ring].forEach(e=>{e.setAttribute('aria-hidden','true');b.appendChild(e)});
const hero=d.querySelector('.hero')||d.querySelector('.page-head')||d.body,hg=d.createElement('div');hg.className='hglow';hg.setAttribute('aria-hidden','true');hero.insertBefore(hg,hero.querySelector('.in'));
let mx=-100,my=-100,rx=mx,ry=my,gx=0,gy=0,raf=0;
const loop=()=>{rx+=(mx-rx)*.18;ry+=(my-ry)*.18;ring.style.transform=`translate3d(${rx}px,${ry}px,0)`;
const r=hero.getBoundingClientRect();const tx=mx-r.left,ty=my-r.top;gx+=(tx-gx)*.08;gy+=(ty-gy)*.08;hg.style.transform=`translate3d(${gx}px,${gy}px,0)`;
raf=(Math.abs(mx-rx)+Math.abs(my-ry)+Math.abs(tx-gx)+Math.abs(ty-gy)>.3)?requestAnimationFrame(loop):0};
const kick=()=>{if(!raf)raf=requestAnimationFrame(loop)};
const H='a,button,summary,[role=button],input,select,label';
d.addEventListener('pointermove',e=>{if(e.pointerType!=='mouse')return;mx=e.clientX;my=e.clientY;dot.style.transform=`translate3d(${mx}px,${my}px,0)`;
if(rm){rx=mx;ry=my;ring.style.transform=dot.style.transform}else kick();b.classList.add('cur-on');
const t=e.target.closest?e.target:null;ring.classList.toggle('hov',!!(t&&t.closest(H)));
const inH=t&&t.closest('.hero');hero.classList.toggle('glowing',!!inH)},{passive:true});
addEventListener('scroll',kick,{passive:true});
d.addEventListener('pointerdown',()=>ring.classList.add('down'));d.addEventListener('pointerup',()=>ring.classList.remove('down'));
d.documentElement.addEventListener('mouseleave',()=>{b.classList.remove('cur-on');hero.classList.remove('glowing')});
})();
(()=>{const d=document.getElementById('lb');if(!d||!d.showModal)return;const im=d.querySelector('img');
document.querySelectorAll('a[data-lb]').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();im.src=a.href;im.alt=a.querySelector('img').alt;d.showModal()}));
d.addEventListener('click',e=>{if(e.target!==im){d.close();im.removeAttribute('src')}});})();
/* header account button label (no Supabase load needed) */
(()=>{try{const k='sb-owmsddezprhrjiinznmq-auth-token';if(localStorage.getItem(k)||sessionStorage.getItem(k))document.querySelectorAll('a.acct span').forEach(a=>a.textContent='My account')}catch(e){}})();
