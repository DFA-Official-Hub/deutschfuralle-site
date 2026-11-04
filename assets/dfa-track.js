/* DFA tracking: attribution, events, double-count guard */
(function(){
  var FT='dfa-ft', LT='dfa-lt', P=['utm_source','utm_medium','utm_campaign','utm_content','utm_term'];
  var NAMES={instagram:'Instagram',facebook:'Facebook',threads:'Threads',youtube:'YouTube',tiktok:'TikTok',linkedin:'LinkedIn',pinterest:'Pinterest',podcast:'our podcast',whatsapp:'WhatsApp',google:'Google',email:'email'};
  function get(k){try{return JSON.parse(localStorage.getItem(k)||'null')}catch(e){return null}}
  function put(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
  function clean(v){return String(v||'').toLowerCase().trim().replace(/\s+/g,'-').replace(/[^a-z0-9._-]/g,'').slice(0,100)}
  var q=new URLSearchParams(location.search), t={};
  P.forEach(function(k){var v=clean(q.get(k));if(v)t[k]=v});
  ['gclid','fbclid'].forEach(function(k){var v=q.get(k);if(v)t[k]=v.slice(0,200)});
  if(!t.utm_source&&document.referrer){try{var h=new URL(document.referrer).hostname.replace(/^www\./,'');
    if(!/deutschfuralle\.com$/.test(h)){var m=h.match(/instagram|facebook|threads|youtube|tiktok|linkedin|pinterest|google/);t.utm_source=m?m[0]:h;t.utm_medium=m?(m[0]==='google'?'organic':'social'):'referral';}}catch(e){}}
  var now=new Date().toISOString();
  if(t.utm_source||t.gclid||t.fbclid){
    t.landing_page=location.pathname+location.search; t.ts=now;
    put(LT,t);                       // last touch: overwritten on every tagged visit
    if(!get(FT))put(FT,t);           // first touch: written once, never overwritten
  } else if(!get(FT)){
    put(FT,{utm_source:'direct',utm_medium:'none',landing_page:location.pathname,ts:now});
  }
  window.DFAAttr={
    first:function(){return get(FT)||{}}, last:function(){return get(LT)||get(FT)||{}},
    via:function(){var s=(get(LT)||get(FT)||{}).utm_source;return s&&NAMES[s]?' (via '+NAMES[s]+')':''}
  };
})();
(function(){
  var suppressUntil=0;
  function uuid(){return (crypto.randomUUID&&crypto.randomUUID())||String(Date.now())+Math.random().toString(16).slice(2)}
  // gtag reserves the key `event_id` and strips it from GA4 hits, so the same UUID is also sent as `dfa_event_id`
  // (register that one as the event-scoped custom dimension).
  function ga(n,p){ p=p||{}; if(p.event_id)p.dfa_event_id=p.event_id; if(window.gtag) gtag('event',n,p); }
  // gtag batches events (~1 s) and calls event_callback before the hit leaves, and a same-tab navigation drops the batch.
  // sent(cb,max): cb runs once a GA4 /g/collect request started after this call has gone out, or after max ms.
  function sent(cb,max){ var t0=performance.now(),done=false,ob=null; function fin(){ if(done)return; done=true; try{ob&&ob.disconnect()}catch(e){} cb(); }
    if(!window.gtag||window['ga-disable-G-L3X22MD03E']||!('PerformanceObserver' in window)){ setTimeout(fin,0); return; }
    try{ ob=new PerformanceObserver(function(l){ l.getEntries().forEach(function(e){ if(e.startTime>=t0&&/\/g\/collect/.test(e.name))fin(); }); }); ob.observe({type:'resource',buffered:false}); }catch(e){}
    setTimeout(fin,max||1500); }
  function px(n,p,eid){ if(window.fbq&&window.DFAConsent&&DFAConsent.granted()) fbq('track',n,p||{},{eventID:eid}); }
  window.DFATrack={
    lead:function(o){ var eid=o.event_id||uuid(); ga('generate_lead',{form:o.form,method:o.method||'',course:o.course||'',timing:o.timing||'',event_id:eid}); if(o.cb)sent(o.cb,o.max);
                      px('Lead',{content_name:o.course||o.form,content_category:o.form},eid); return eid; },
    suppressWa:function(){ suppressUntil=Date.now()+5000; },
    sent:sent
  };
  document.addEventListener('click',function(e){
    var a=e.target.closest&&e.target.closest('a[href]'); if(!a)return; var h=a.href, loc=a.closest('footer')?'footer':a.closest('header,nav')?'header':'body';
    if(a.matches('a[href*="wa.me/"], a[href*="api.whatsapp.com/"]')){
      if(Date.now()<suppressUntil)return;                 // guard: registration redirect already counted as generate_lead
      var eid=uuid(); ga('whatsapp_click',{link_location:loc,page_path:location.pathname,event_id:eid}); px('Contact',{content_name:'whatsapp'},eid); return; }
    if(/whatsapp\.com\/channel\//.test(h)){ ga('whatsapp_channel_click',{page_path:location.pathname}); return; }
    var bk=a.getAttribute('data-goatcounter-click'); if(bk){ ga('book_click',{item_id:bk,store:(h.match(/amazon|gumroad|etsy/)||['other'])[0]}); return; }
    var pd=h.match(/open\.spotify\.com\/show|podcasts\.apple\.com|castbox\.fm|pca\.st|deezer\.com\/show|player\.fm|podcastaddict\.com|tunein\.com|podchaser\.com|podfriend\.com|podcastindex\.org/);
    if(pd){ ga('podcast_click',{platform:pd[0].replace(/^(open|podcasts)\./,'').split(/[./]/)[0]}); }
  },true);
})();
