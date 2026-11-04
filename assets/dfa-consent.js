/* DFA consent banner: self-hosted, Consent Mode v2 advanced, Meta Pixel only after Accept */
(function(){
  var KEY='dfa-consent', PIXEL_ID='1600742430613672';
  function read(){try{var c=JSON.parse(localStorage.getItem(KEY)||'null');return c&&c.v===1?c:null}catch(e){return null}}
  function save(s){try{localStorage.setItem(KEY,JSON.stringify({v:1,s:s,t:new Date().toISOString()}))}catch(e){}}
  function loadPixel(){
    if(window.fbq||!/^\d+$/.test(PIXEL_ID))return;
    if(!window.DFA_LIVE&&!window.DFA_DEBUG)return; // preview/local hosts: never send to the production Pixel (see tools/tracking-head.html)
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};
    if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;
    s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
    fbq('consent','grant');fbq('init',PIXEL_ID);fbq('track','PageView');
  }
  function apply(s){
    var g=s==='granted'?'granted':'denied';
    gtag('consent','update',{ad_storage:g,ad_user_data:g,ad_personalization:g,analytics_storage:g});
    if(g==='granted')loadPixel(); else if(window.fbq)fbq('consent','revoke');
  }
  function banner(){
    if(document.getElementById('dfa-cc'))return;
    var d=document.createElement('div');d.id='dfa-cc';d.setAttribute('role','dialog');d.setAttribute('aria-live','polite');d.setAttribute('aria-label','Cookie consent');
    d.innerHTML='<p>We use cookies for analytics and to measure our ads (Google Analytics, Meta). You can accept or reject. See our <a href="/privacy.html#cookies">Privacy Policy</a>.</p>'+
      '<div class="dfa-cc-btns"><button type="button" class="btn outline" data-c="denied">Reject</button><button type="button" class="btn outline" data-c="granted">Accept</button></div>';
    d.addEventListener('click',function(e){var s=e.target.getAttribute&&e.target.getAttribute('data-c');if(!s)return;save(s);apply(s);d.remove();});
    document.body.appendChild(d);
  }
  window.DFAConsent={granted:function(){var c=read();return !!(c&&c.s==='granted')},open:banner};
  var c=read(); if(c){ if(c.s==='granted')loadPixel(); } else banner();
  document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('[data-cookie-settings]');if(a){e.preventDefault();banner();}});
})();
