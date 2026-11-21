/* DFA tracking: attribution, events, double-count guard */
(function(){
  var FT='dfa-ft', LT='dfa-lt', P=['utm_source','utm_medium','utm_campaign','utm_content','utm_term'];
  var NAMES={instagram:'Instagram',facebook:'Facebook',threads:'Threads',youtube:'YouTube',tiktok:'TikTok',linkedin:'LinkedIn',pinterest:'Pinterest',podcast:'our podcast',whatsapp:'WhatsApp',google:'Google',email:'email'};
  function get(k){try{return JSON.parse(localStorage.getItem(k)||'null')}catch(e){return null}}
  function put(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
  // utm_medium for a source host or bare source name. Exact host or subdomain match only (never a substring), checked in order:
  // AI -> ai_referral, search -> organic, social -> social, anything else -> referral. AI goes first: gemini.google.com is ai_referral.
  var TLD='(?:com|co\\.[a-z]{2}|com\\.[a-z]{2}|[a-z]{2})';             // google.com, google.co.uk, google.com.pk, google.de
  var MED=[
    ['ai_referral',['chatgpt.com','chat.openai.com','perplexity.ai','gemini.google.com','copilot.microsoft.com','claude.ai'],
      ['chatgpt','openai','perplexity','gemini','copilot','claude']],
    ['organic',['bing.com','duckduckgo.com','yahoo.com','baidu.com','ecosia.org','search.brave.com','startpage.com','qwant.com','ask.com','naver.com','seznam.cz'],
      ['google','bing','duckduckgo','ddg','yahoo','yandex','baidu','ecosia','brave','startpage','qwant','naver','seznam'],
      new RegExp('^(?:[a-z0-9-]+\\.)*(?:google|yandex|yahoo)\\.'+TLD+'$')],
    ['social',['facebook.com','fb.com','fb.me','instagram.com','threads.net','threads.com','t.co','x.com','twitter.com','linkedin.com','lnkd.in',
      'youtube.com','youtu.be','tiktok.com','pin.it','reddit.com','whatsapp.com','wa.me','t.me','telegram.org','snapchat.com','quora.com'],
      ['facebook','fb','ig','instagram','threads','twitter','x','linkedin','youtube','yt','tiktok','pinterest','reddit','whatsapp','wa','telegram','snapchat','quora'],
      new RegExp('^(?:[a-z0-9-]+\\.)*pinterest\\.'+TLD+'$')]
  ];
  function mediumFor(src){
    var h=String(src||'').toLowerCase().trim().replace(/^[a-z]+:\/\//,'').split(/[\/?#:]/)[0].replace(/\.$/,'').replace(/^www\./,'');   // 'www.google.com.' -> 'google.com'
    if(!h)return 'referral';
    for(var i=0;i<MED.length;i++){var r=MED[i];
      if(h.indexOf('.')<0){if(r[2].indexOf(h)>=0)return r[0];continue;}                       // bare name: 'facebook', 'google'
      for(var j=0;j<r[1].length;j++){var d=r[1][j];if(h===d||h.slice(-d.length-1)==='.'+d)return r[0];}
      if(r[3]&&r[3].test(h))return r[0];}
    return 'referral';
  }
  // android-app://<package> referrers (Android apps): classify by the app's web host. Known packages first, otherwise the
  // package's leading domain part reversed (com.facebook.katana -> facebook.com). Only used for the medium; the source is unchanged.
  var APPS={'com.google.android.googlequicksearchbox':'google.com','com.google.android.gm':'mail.google.com','com.google.android.youtube':'youtube.com',
    'com.google.android.apps.bard':'gemini.google.com','com.google.android.apps.gemini':'gemini.google.com','com.openai.chatgpt':'chatgpt.com',
    'com.anthropic.claude':'claude.ai','ai.perplexity.app.android':'perplexity.ai','com.microsoft.copilot':'copilot.microsoft.com','com.microsoft.bing':'bing.com',
    'com.duckduckgo.mobile.android':'duckduckgo.com','com.facebook.katana':'facebook.com','com.facebook.lite':'facebook.com','com.facebook.orca':'facebook.com',
    'com.instagram.android':'instagram.com','com.instagram.barcelona':'threads.net','com.linkedin.android':'linkedin.com','com.twitter.android':'x.com',
    'com.zhiliaoapp.musically':'tiktok.com','com.ss.android.ugc.trill':'tiktok.com','com.pinterest':'pinterest.com','com.reddit.frontpage':'reddit.com',
    'com.whatsapp':'whatsapp.com','com.whatsapp.w4b':'whatsapp.com','org.telegram.messenger':'telegram.org'};
  function appHost(pkg){var k=String(pkg||'').toLowerCase().replace(/\.$/,'');if(APPS[k])return APPS[k];var a=k.split('.');return a.length>1?a[1]+'.'+a[0]:k}
  function clean(v){return String(v||'').toLowerCase().trim().replace(/\s+/g,'-').replace(/[^a-z0-9._-]/g,'').slice(0,100)}
  var q=new URLSearchParams(location.search), t={};
  P.forEach(function(k){var v=clean(q.get(k));if(v)t[k]=v});
  ['gclid','fbclid'].forEach(function(k){var v=q.get(k);if(v)t[k]=v.slice(0,200)});
  if(t.utm_source&&!t.utm_medium)t.utm_medium=mediumFor(t.utm_source);   // e.g. ?utm_source=chatgpt.com with no medium; an explicit medium is never touched
  if(!t.utm_source&&document.referrer){try{var h=new URL(document.referrer).hostname.replace(/^www\./,'');
    if(!/deutschfuralle\.com$/.test(h)){var m=h.match(/instagram|facebook|threads|youtube|tiktok|linkedin|pinterest|google/);t.utm_source=m?m[0]:h;
      t.utm_medium=t.utm_medium||mediumFor(/^android-app:/i.test(document.referrer)?appHost(h):h);}}catch(e){}}
  var now=new Date().toISOString();
  function land(u){if(typeof window.DFA_SCRUB==='function')return window.DFA_SCRUB(u);   // no auth params in the stored landing URL
    var m=u.split('?'),q=(m[1]||'').split('&').filter(function(kv){return kv&&!/^(code|access_token|refresh_token|token_hash|type|provider_token|provider_refresh_token|expires_at|expires_in|token_type)$/i.test(kv.split('=')[0])});return m[0]+(q.length?'?'+q.join('&'):'')}
  if(t.utm_source||t.gclid||t.fbclid){
    t.landing_page=land(location.pathname+location.search); t.ts=now;
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
  // Sign-up conversion handed over from the private account page (no analytics there): fire once on the next public page.
  // The flag is {m:'email',ts} only. Expired (7 days) or malformed flags are dropped without firing; Meta only with consent.
  (function(){
    if(/^\/(admin|portal|reader|account|doc)(\.html)?(\/|\/index\.html)?$/.test(location.pathname))return;   // private pages: leave the flag for a public page
    var K='dfa-pending-signup',raw=null,f=null;
    try{raw=localStorage.getItem(K)}catch(e){return}
    if(raw===null)return;
    try{localStorage.removeItem(K)}catch(e){}
    try{f=JSON.parse(raw)}catch(e){}
    var age=f&&typeof f.ts==='number'?Date.now()-f.ts:-1;
    if(!f||f.m!=='email'||!(age>=0&&age<7*864e5))return;
    if(typeof window.gtag!=='function'){window.dataLayer=window.dataLayer||[];window.gtag=function(){dataLayer.push(arguments)}}   // queued for gtag.js if the head stub is missing
    ga('sign_up',{method:'email'});
    px('CompleteRegistration',{},uuid());
  })();
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
