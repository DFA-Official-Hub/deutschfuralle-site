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
  function px(n,p,eid){ if(window.fbq&&window.DFAConsent&&DFAConsent.granted()) fbq('track',n,p||{},{eventID:eid}); }
  // Hold-off before a page navigation (registration redirect): the hits are sent first, then `done` runs once they have had
  // a chance to leave, never later than LEAD_CAP ms. With consent declined or the tag scripts not loaded there is nothing to wait for.
  var LEAD_CAP=900, PX_WINDOW=400;   // fbq has no callback: it gets a fixed window (< cap); GA4 gets event_callback + beacon transport
  function consented(){ return !!(window.DFAConsent&&DFAConsent.granted()); }
  function gaLoaded(){ return !!(window.google_tag_manager&&window.google_tag_manager['G-L3X22MD03E']); }   // set only once gtag.js itself has loaded
  function pxLoaded(){ return !!(window.fbq&&window.fbq.callMethod); }                                        // set only once fbevents.js has loaded
  window.DFATrack={
    lead:function(o,done){
      var eid=o.event_id||uuid(), p={form:o.form,method:o.method||'',course:o.course||'',timing:o.timing||'',event_id:eid};
      var wait=typeof done==='function'&&consented(), waitGa=wait&&gaLoaded(), waitPx=wait&&pxLoaded(), fired=false, pend=0, cap;
      function fin(){ if(fired)return; fired=true; clearTimeout(cap); try{done()}catch(e){} }
      function one(){ if(--pend<=0)fin(); }
      if(waitGa){ pend++; p.transport_type='beacon'; p.event_callback=one; }
      if(waitPx){ pend++; }
      ga('generate_lead',p);
      px('Lead',{content_name:o.course||o.form,content_category:o.form},eid);
      if(waitPx) setTimeout(one,PX_WINDOW);
      if(typeof done==='function'){ if(pend>0) cap=setTimeout(fin,LEAD_CAP); else fin(); }
      return eid; },
    suppressWa:function(){ suppressUntil=Date.now()+5000; }
  };
  document.addEventListener('click',function(e){
    var a=e.target.closest&&e.target.closest('a[href]'); if(!a)return; var h=a.href, loc=a.closest('footer')?'footer':a.closest('header,nav')?'header':'body';
    if(a.matches('a[href="/whatsapp"], a[href^="/whatsapp?"], a[href*="wa.me/"], a[href*="api.whatsapp.com/"]')){   // /whatsapp = redirect page → Supabase wa function (number in secret)
      if(Date.now()<suppressUntil)return;                 // guard: registration redirect already counted as generate_lead
      var eid=uuid(); ga('whatsapp_click',{link_location:loc,page_path:location.pathname,event_id:eid}); px('Contact',{content_name:'whatsapp'},eid); return; }
    if(/whatsapp\.com\/channel\//.test(h)){ ga('whatsapp_channel_click',{page_path:location.pathname}); return; }
    var bk=a.getAttribute('data-goatcounter-click'); if(bk){ ga('book_click',{item_id:bk,store:(h.match(/amazon|gumroad|etsy/)||['other'])[0]}); return; }
    var pd=h.match(/open\.spotify\.com\/show|podcasts\.apple\.com|castbox\.fm|pca\.st|deezer\.com\/show|player\.fm|podcastaddict\.com|tunein\.com|podchaser\.com|podfriend\.com|podcastindex\.org/);
    if(pd){ var pf=pd[0].replace(/^(open|podcasts)\./,'').split(/[./]/)[0]; ga('podcast_click',{platform:({apple:'apple_podcasts',pca:'pocketcasts'})[pf]||pf}); }
  },true);
})();
