/* DFA A1 mock exam (Start Deutsch 1 format). Original material by Deutsch Für Alle. Marked in the browser; nothing is uploaded except an optional score row for logged-in students. */
(function(){
var root=document.getElementById('mock-app');if(!root)return;
var V='41',AU='assets/audio/a1-mock-1/',KEY='dfa-a1-mock-1',SLUG='a1-mock-1';
function esc(s){return String(s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function nl(s){return esc(s).replace(/\n/g,'<br>')}
var RF=['Richtig','Falsch'];

/* ---------- HÖREN ---------- */
var H=[
{id:1,t:'Wann fährt der Zug nach Hamburg heute?',o:['um 9:30 Uhr','um 9:10 Uhr','um 10:00 Uhr'],a:0,
 tr:'Frau: Entschuldigung, wann fährt der Zug nach Hamburg?\nMann: Nach Hamburg? Normalerweise um zehn nach neun. Aber heute hat er Verspätung. Er fährt erst um halb zehn.\nFrau: Um halb zehn. Okay, vielen Dank!'},
{id:2,t:'Was kauft die Frau?',o:['nur Bananen','Tomaten und Äpfel','Tomaten und Bananen'],a:2,
 tr:'Mann: Guten Tag! Was möchten Sie?\nFrau: Ein Kilo Tomaten, bitte. Haben Sie auch Äpfel?\nMann: Äpfel haben wir heute leider nicht. Aber die Bananen sind sehr gut.\nFrau: Gut, dann nehme ich noch ein Kilo Bananen.'},
{id:3,t:'Wo ist das Büro von Frau Malik?',o:['im ersten Stock','im zweiten Stock','im dritten Stock'],a:2,
 tr:'Frau: Entschuldigung, wo ist das Büro von Frau Malik?\nMann: Im dritten Stock, Zimmer 305. Der Aufzug ist leider kaputt. Bitte nehmen Sie die Treppe.\nFrau: Kein Problem. Danke schön!'},
{id:4,t:'Wie viel bezahlt der Mann?',o:['2,00 €','3,50 €','5,00 €'],a:1,
 tr:'Mann: Was kostet ein Kaffee?\nFrau: Ein kleiner Kaffee kostet zwei Euro, ein großer drei Euro fünfzig.\nMann: Dann einen großen, bitte.'},
{id:5,t:'Wann hat Herr Khan einen Termin?',o:['am Donnerstag','am Mittwoch','am Freitag'],a:0,
 tr:'Frau: Praxis Dr. Hoffmann, guten Morgen.\nMann: Guten Morgen, hier ist Imran Khan. Ich brauche bitte einen Termin. Geht es am Mittwoch?\nFrau: Mittwoch ist leider schon voll. Am Donnerstag um elf Uhr ist noch etwas frei.\nMann: Donnerstag um elf? Ja, das passt gut.'},
{id:6,t:'Wie fährt die Frau jetzt zur Arbeit?',o:['mit dem Bus','mit dem Fahrrad','mit der U-Bahn'],a:2,
 tr:'Mann: Fährst du immer mit dem Bus zur Arbeit?\nFrau: Nein. Im Sommer fahre ich mit dem Fahrrad. Aber jetzt im Winter nehme ich die U-Bahn.'},
{id:7,t:'Der Zug nach Frankfurt fährt heute von Gleis 4.',o:RF,a:1,
 tr:'Achtung an Gleis 4! Der Regionalexpress nach Frankfurt fährt heute nicht von Gleis 4, sondern von Gleis 7. Bitte gehen Sie zu Gleis 7.'},
{id:8,t:'Der Supermarkt schließt bald.',o:RF,a:0,
 tr:'Liebe Kundinnen und Kunden, unser Markt schließt in fünfzehn Minuten. Bitte kommen Sie jetzt zur Kasse. Vielen Dank für Ihren Einkauf!'},
{id:9,t:'Der Flug nach Istanbul hat Verspätung.',o:RF,a:1,
 tr:'Information für die Passagiere nach Istanbul: Bitte gehen Sie jetzt zum Ausgang B 12. Der Flug ist pünktlich.'},
{id:10,t:'Im dritten Stock sind Kinderschuhe billiger.',o:RF,a:0,
 tr:'Heute im dritten Stock: Alle Kinderschuhe sind zwanzig Prozent billiger. Das Angebot gibt es nur bis Samstag.'},
{id:11,t:'Was möchte Mona?',o:['morgen ins Kino gehen','heute Abend ins Kino gehen','mit Ayesha arbeiten'],a:0,
 tr:'Hallo Ayesha, hier ist Mona. Wir wollten doch heute Abend ins Kino gehen. Das geht leider nicht, ich muss arbeiten. Gehen wir morgen? Ruf mich bitte zurück. Tschüss!'},
{id:12,t:'Bis wann kann Herr Ahmed sein Auto heute abholen?',o:['bis 16 Uhr','bis 18 Uhr','bis 20 Uhr'],a:1,
 tr:'Guten Tag, Herr Ahmed, hier ist das Autohaus Becker. Ihr Auto ist fertig. Sie können es heute bis achtzehn Uhr abholen. Morgen haben wir geschlossen. Auf Wiederhören!'},
{id:13,t:'Wo ist das Geld?',o:['in der Küche','im Wohnzimmer','in der Schule'],a:0,
 tr:'Hallo Tim, hier ist Mama. Kannst du bitte nach der Schule einkaufen? Wir brauchen Milch, Eier und Brot. Das Geld liegt in der Küche auf dem Tisch. Danke, bis später!'},
{id:14,t:'Wann beginnt der Deutschkurs?',o:['am Montag um 9 Uhr','am Dienstag um 12 Uhr','am Dienstag um 9 Uhr'],a:2,
 tr:'Hallo, hier spricht Daniel von der Sprachschule Lingua. Ihr Deutschkurs beginnt nicht am Montag, sondern erst am Dienstag, um neun Uhr. Bis Dienstag!'},
{id:15,t:'Was soll Herr Schulz machen?',o:['den Schlüssel abholen','in Urlaub fahren','die Blumen gießen'],a:2,
 tr:'Hallo Herr Schulz, hier ist Frau Rana aus dem zweiten Stock. Ich bin ab morgen eine Woche im Urlaub. Können Sie bitte meine Blumen gießen? Den Schlüssel bringe ich heute Abend vorbei. Vielen Dank!'}];
var HT=[{n:'Teil 1',from:0,to:6,plays:2,ins:'Sie hören sechs kurze Gespräche. Sie hören jeden Text <b>zweimal</b>. Kreuzen Sie an: a, b oder c.',en:'Six short conversations. Each one can be played twice.'},
{n:'Teil 2',from:6,to:10,plays:1,ins:'Sie hören vier Durchsagen. Sie hören jeden Text <b>einmal</b>. Kreuzen Sie an: Richtig oder Falsch.',en:'Four announcements. Each one plays only once, so listen carefully.'},
{n:'Teil 3',from:10,to:15,plays:2,ins:'Sie hören fünf Nachrichten am Telefon. Sie hören jeden Text <b>zweimal</b>. Kreuzen Sie an: a, b oder c.',en:'Five phone messages. Each one can be played twice.'}];

/* ---------- LESEN ---------- */
var L1=[{h:'E-Mail',x:'Liebe Jana,\n\nich bin jetzt seit zwei Wochen in Berlin. Mein Deutschkurs ist jeden Tag von 9 bis 13 Uhr. Am Nachmittag arbeite ich in einem Restaurant. Meine Wohnung ist nicht groß, aber sie ist hell und ganz nah am Kurs. Ich gehe immer zu Fuß.\nAm Sonntag besucht mich mein Bruder. Er wohnt in Hamburg. Kommst du auch? Wir kochen pakistanisches Essen!\n\nViele Grüße\nBilal',
 q:[{t:'Bilal lernt am Vormittag Deutsch.',a:0},{t:'Bilal fährt mit dem Bus zum Kurs.',a:1},{t:'Bilals Bruder wohnt in Hamburg.',a:0}]},
{h:'Notiz',x:'Hallo Sven,\nich bin beim Arzt und komme erst um 15 Uhr nach Hause. Das Essen ist im Kühlschrank. Du musst es nur warm machen. Und vergiss nicht: Um 16 Uhr hast du Fußballtraining!\nMama',
 q:[{t:'Die Mutter ist am Nachmittag wieder zu Hause.',a:0},{t:'Sven muss heute kochen.',a:1}]}];
var L2=[{t:'Sie möchten am Wochenende Deutsch lernen.',a:'<b>Sprachschule Hallo</b><br>Intensivkurse Deutsch<br>Montag bis Freitag, 8 bis 12 Uhr',b:'<b>Volkshochschule Mitte</b><br>Deutsch A1 für Anfänger<br>samstags 10 bis 14 Uhr',k:1},
{t:'Sie suchen eine günstige Wohnung für eine Person.',a:'<b>1-Zimmer-Wohnung</b><br>30 m², Küche, Bad<br>380 € warm',b:'<b>Haus mit Garten</b><br>5 Zimmer, ideal für Familien<br>1.600 € im Monat',k:0},
{t:'Sie möchten am Sonntag frisches Brot kaufen.',a:'<b>Bäckerei Korn</b><br>Mo bis Sa 6 bis 18 Uhr<br>Sonntag geschlossen',b:'<b>Café Morgen</b><br>Bäckerei und Café<br>täglich 7 bis 17 Uhr, auch sonntags',k:1},
{t:'Sie möchten online einen Termin beim Bürgeramt machen.',a:'<span class="url">www.stadt-info.de/buergeramt</span>Pass, Ausweis, Anmeldung:<br>Termine hier online buchen',b:'<span class="url">www.stadt-info.de/bibliothek</span>Bücher online suchen<br>und verlängern',k:0},
{t:'Ihr Sohn ist 8 Jahre alt. Er möchte schwimmen lernen.',a:'<b>Schwimmbad Nord</b><br>Schwimmkurse für Kinder von 6 bis 10 Jahren<br>mittwochs 15 Uhr',b:'<b>Fitness-Studio Fit</b><br>Aqua-Fitness für Erwachsene<br>Mo und Do, 19 Uhr',k:0}];
var L3=[{w:'An der Tür einer Arztpraxis',s:'Praxis vom 2. bis 13. Juni geschlossen.\nIn dringenden Fällen: Dr. Wagner, Hauptstraße 8',t:'Im Juni können Sie zu Dr. Wagner gehen.',a:0},
{w:'In der Bibliothek',s:'Bitte nicht essen und trinken!\nWasser in Flaschen ist erlaubt.',t:'In der Bibliothek darf man Wasser trinken.',a:0},
{w:'Im Bus',s:'Fahrkarten bitte beim Fahrer kaufen.\nNur Bargeld!',t:'Sie können im Bus mit Karte bezahlen.',a:1},
{w:'Im Schwimmbad',s:'Montag 10 bis 14 Uhr:\nnur für Frauen',t:'Männer können am Montag um 11 Uhr schwimmen.',a:1},
{w:'Am Supermarkt',s:'Neue Öffnungszeiten ab 1. März:\nMo bis Sa 7 bis 22 Uhr',t:'Ab März ist der Supermarkt bis 22 Uhr offen.',a:0}];

/* ---------- SPRECHEN ---------- */
var SP1=['Name','Alter','Land','Wohnort','Sprachen','Beruf','Hobby'];
var SP1M='Ich heiße Ali Raza. Ich bin 27 Jahre alt. Ich komme aus Pakistan, aus Multan. Jetzt wohne ich in Lahore. Ich spreche Urdu, Punjabi, Englisch und ein bisschen Deutsch. Ich bin Krankenpfleger von Beruf. Mein Hobby ist Fußball.';
var SP2=[{th:'Essen und Trinken',c:[['Frühstück','Was essen Sie zum Frühstück?','Ich esse Brot mit Ei und trinke Tee.'],['Lieblingsessen','Was ist Ihr Lieblingsessen?','Mein Lieblingsessen ist Biryani.'],['Getränk','Was trinken Sie gern?','Ich trinke gern Chai mit Milch.'],['Restaurant','Gehen Sie oft ins Restaurant?','Nein, nur am Wochenende.'],['Kochen','Kochen Sie gern?','Ja, ich koche fast jeden Abend.'],['Obst','Welches Obst mögen Sie?','Ich mag Mangos.']]},
{th:'Freizeit',c:[['Wochenende','Was machen Sie am Wochenende?','Ich besuche meine Familie.'],['Sport','Welchen Sport machen Sie?','Ich spiele Cricket.'],['Kino','Gehen Sie gern ins Kino?','Ja, einmal im Monat.'],['Musik','Welche Musik hören Sie gern?','Ich höre gern Popmusik.'],['Urlaub','Wohin fahren Sie im Urlaub?','Ich fahre nach Murree.'],['Freunde','Wann treffen Sie Ihre Freunde?','Am Freitagabend.']]}];
var SP3=[['🪟','Fenster','Können Sie bitte das Fenster aufmachen?','Ja, natürlich.'],['💧','Wasser','Kann ich bitte ein Glas Wasser haben?','Ja, hier, bitte.'],['✏️','Stift','Kannst du mir bitte einen Stift geben?','Klar, bitte schön.'],['📱','Handy','Machen Sie bitte Ihr Handy aus.','Oh, Entschuldigung!'],['💡','Licht','Mach bitte das Licht an.','Okay, kein Problem.'],['🍬','Zucker','Gib mir bitte den Zucker.','Bitte schön.'],['🚪','Tür','Kannst du bitte die Tür zumachen?','Ja, gern.'],['🕒','Uhr','Wie spät ist es, bitte?','Es ist Viertel nach drei.']];

var SECS=[{k:'h',n:'Hören',min:20},{k:'l',n:'Lesen',min:25},{k:'s',n:'Schreiben',min:20},{k:'p',n:'Sprechen',min:15}];
var st;try{st=JSON.parse(localStorage.getItem(KEY))||{}}catch(e){st={}}
st.ans=st.ans||{};st.done=st.done||{};st.plays=st.plays||{};st.left=st.left||{};st.self=st.self||{};
function save(){try{localStorage.setItem(KEY,JSON.stringify(st))}catch(e){}}

function radio(name,opts,letters){var cur=st.ans[name];return '<div class="ex-opts">'+opts.map(function(o,i){return '<label><input type="radio" name="'+name+'" value="'+i+'"'+(cur===i?' checked':'')+'> <span lang="de">'+(letters?'<b>'+'abc'[i]+'</b> ':'')+esc(o)+'</span></label>'}).join('')+'</div>'}
function q(name,num,text,opts,letters){return '<fieldset class="ex-q" data-q="'+name+'"><legend><b>'+num+'</b> <span lang="de">'+esc(text)+'</span></legend>'+radio(name,opts,letters)+'</fieldset>'}

/* ---------- RENDER ---------- */
function shell(){var h='<div class="mk-tabs" role="tablist">';
 SECS.forEach(function(s,i){h+='<button type="button" role="tab" class="mk-tab" data-tab="'+s.k+'"><span>'+(i+1)+'</span>'+s.n+'<small>'+s.min+' Min.</small>'+(st.done[s.k]?'<i aria-label="erledigt">✓</i>':'')+'</button>'});
 h+='<button type="button" role="tab" class="mk-tab" data-tab="r"><span>★</span>Ergebnis<small>/100</small></button></div><div id="mk-body"></div>';root.innerHTML=h;
 root.querySelectorAll('.mk-tab').forEach(function(b){b.onclick=function(){show(b.dataset.tab)}});}
var timer=null;
function bar(k){var s=SECS.filter(function(x){return x.k===k})[0];var left=st.left[k]!=null?st.left[k]:s.min*60;
 return '<div class="mk-bar"><div><b>'+s.n+'</b><span class="adm-mut">'+s.min+' Minuten</span></div><div class="mk-time" id="mk-time" aria-live="off">'+fmt(left)+'</div>'+(st.done[k]?'<span class="mk-pill">abgegeben</span>':'<button type="button" class="btn sm" id="mk-start">'+(st.left[k]!=null?'Weiter':'Timer starten')+'</button>')+'</div>'}
function fmt(t){t=Math.max(0,t|0);return (t/60|0)+':'+('0'+t%60).slice(-2)}
function runTimer(k){clearInterval(timer);var s=SECS.filter(function(x){return x.k===k})[0];if(st.left[k]==null)st.left[k]=s.min*60;var el=document.getElementById('mk-time');
 timer=setInterval(function(){st.left[k]--;if(el)el.textContent=fmt(st.left[k]);if(st.left[k]<=60&&el)el.classList.add('low');if(st.left[k]%5===0)save();
  if(st.left[k]<=0){clearInterval(timer);if(k==='p'){el.textContent='0:00';return}alert('Die Zeit ist um. Your answers for '+s.n+' are now submitted.');submit(k)}},1000)}
function show(k){clearInterval(timer);var b=document.getElementById('mk-body');root.querySelectorAll('.mk-tab').forEach(function(t){t.classList.toggle('on',t.dataset.tab===k);t.setAttribute('aria-selected',t.dataset.tab===k)});var on=root.querySelector('.mk-tab.on');if(on&&on.parentNode.scrollWidth>on.parentNode.clientWidth)on.parentNode.scrollLeft=on.offsetLeft-12;
 b.innerHTML=k==='h'?renderH():k==='l'?renderL():k==='s'?renderS():k==='p'?renderP():renderR();wire(k);st.cur=k;save();
 if(k!=='r'){var sb=document.getElementById('mk-start');if(sb)sb.onclick=function(){sb.remove();runTimer(k);b.classList.add('live')};if(st.done[k])b.classList.add('locked')}
 var top=root.getBoundingClientRect().top+scrollY-90;if(scrollY>top)scrollTo({top:top,behavior:'smooth'})}

function renderH(){var h=bar('h')+'<p class="mk-note">Press <b>Timer starten</b> first. You can play each recording only as often as in the real exam: twice in Teil 1 and 3, once in Teil 2. There is no pause or rewind button, on purpose.</p>';
 HT.forEach(function(t){h+='<div class="ex-part ac-card"><h3>Hören, '+t.n+'</h3><p class="mk-ins" lang="de">'+t.ins+'</p><p class="adm-mut">'+t.en+'</p>';
  H.slice(t.from,t.to).forEach(function(x){var used=st.plays['h'+x.id]||0,left=t.plays-used;
   h+='<div class="mk-item"><button type="button" class="mk-play" data-a="'+x.id+'" data-max="'+t.plays+'"'+(left<=0?' disabled':'')+'><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg><span>'+(left<=0?'Schon gehört':'Abspielen')+'</span><em>'+left+'× übrig</em></button>'+q('h'+x.id,x.id,x.t,x.o,t.plays===2)+'</div>'});h+='</div>'});
 return h+foot('h')}
function renderL(){var h=bar('l'),n=0;
 h+='<div class="ex-part ac-card"><h3>Lesen, Teil 1</h3><p class="mk-ins" lang="de">Lesen Sie die zwei Texte und die Aufgaben 1 bis 5. Kreuzen Sie an: Richtig oder Falsch.</p>';
 L1.forEach(function(t){h+='<div class="ex-text" lang="de">'+nl(t.x)+'</div>';t.q.forEach(function(x){n++;h+=q('l'+n,n,x.t,RF)})});h+='</div>';
 h+='<div class="ex-part ac-card"><h3>Lesen, Teil 2</h3><p class="mk-ins" lang="de">Lesen Sie die Aufgaben 6 bis 10 und die Anzeigen. Wo finden Sie Informationen? Kreuzen Sie an: a oder b.</p>';
 L2.forEach(function(x){n++;var c=st.ans['l'+n];h+='<fieldset class="ex-q mk-ab" data-q="l'+n+'"><legend><b>'+n+'</b> <span lang="de">'+esc(x.t)+'</span></legend><div class="mk-ads">'+['a','b'].map(function(L,i){return '<label class="mk-ad"><input type="radio" name="l'+n+'" value="'+i+'"'+(c===i?' checked':'')+'><span class="mk-ad-l">'+L+'</span><span class="mk-ad-x" lang="de">'+x[L]+'</span></label>'}).join('')+'</div></fieldset>'});h+='</div>';
 h+='<div class="ex-part ac-card"><h3>Lesen, Teil 3</h3><p class="mk-ins" lang="de">Lesen Sie die Schilder und die Aufgaben 11 bis 15. Kreuzen Sie an: Richtig oder Falsch.</p>';
 L3.forEach(function(x){n++;h+='<div class="mk-sign"><small>'+esc(x.w)+'</small><div lang="de">'+nl(x.s)+'</div></div>'+q('l'+n,n,x.t,RF)});h+='</div>';return h+foot('l')}
function inp(id,ph){return '<input type="text" id="'+id+'" data-k="'+id+'" value="'+esc(st.ans[id]||'')+'" autocomplete="off" spellcheck="false"'+(ph?' placeholder="'+ph+'"':'')+'>'}
function chk(id,opts){return '<div class="ex-opts">'+opts.map(function(o,i){return '<label><input type="radio" name="'+id+'" value="'+i+'"'+(st.ans[id]===i?' checked':'')+'> <span lang="de">'+o+'</span></label>'}).join('')+'</div>'}
function renderS(){var h=bar('s');
 h+='<div class="ex-part ac-card"><h3>Schreiben, Teil 1</h3><p class="mk-ins" lang="de">Ihre Freundin Sana Mirza möchte einen Deutschkurs machen. Die Sprachschule braucht ein Formular. Im Formular fehlen fünf Informationen. Helfen Sie Ihrer Freundin und schreiben Sie die fünf Informationen in das Formular.</p>';
 h+='<div class="ex-text" lang="de">Sana Mirza ist 24 Jahre alt. Sie kommt aus Lahore in Pakistan und wohnt seit drei Monaten in Köln, in der Bergstraße 12. Sie spricht Urdu und Englisch. Am Tag arbeitet Sana in einem Hotel, darum möchte sie nur am Abend lernen. Den Kurs bezahlt sie mit Überweisung.</div>';
 h+='<div class="mk-form" lang="de"><div class="mk-fh">Sprachschule Lingua · Anmeldung</div>'+
 '<div class="mk-fr"><span>Familienname</span><b>Mirza</b></div><div class="mk-fr"><span>Vorname</span><b>Sana</b></div>'+
 '<div class="mk-fr"><span>Alter <em>(1)</em></span>'+inp('s1')+'</div><div class="mk-fr"><span>Herkunftsland <em>(2)</em></span>'+inp('s2')+'</div>'+
 '<div class="mk-fr"><span>Adresse</span><b>Bergstraße 12, 50667 Köln</b></div><div class="mk-fr"><span>Sprachen <em>(3)</em></span>'+inp('s3')+'</div>'+
 '<div class="mk-fr"><span>Kurszeit <em>(4)</em></span>'+chk('s4',['Vormittag','Nachmittag','Abend'])+'</div>'+
 '<div class="mk-fr"><span>Zahlung <em>(5)</em></span>'+chk('s5',['bar','mit Karte','Überweisung'])+'</div></div></div>';
 h+='<div class="ex-part ac-card"><h3>Schreiben, Teil 2</h3><p class="mk-ins" lang="de">Sie haben am Samstag Geburtstag und machen eine Party. Schreiben Sie Ihrem Freund Jonas eine E-Mail.</p><ul class="mk-pts" lang="de"><li>Warum schreiben Sie?</li><li>Wann und wo ist die Party?</li><li>Was soll Jonas mitbringen?</li></ul><p class="mk-ins" lang="de">Schreiben Sie zu jedem Punkt ein bis zwei Sätze (circa 30 Wörter). Vergessen Sie nicht die Anrede und den Gruß.</p>'+
 '<textarea id="s6" data-k="s6" rows="8" lang="de" spellcheck="false" placeholder="Lieber Jonas, …">'+esc(st.ans.s6||'')+'</textarea><p class="adm-mut" id="s6c"></p></div>';
 h+='<div id="s-review"></div>';return h+foot('s')}
function renderP(){var h=bar('p')+'<p class="mk-note">In the real exam you speak in a small group with two examiners. Here you practise alone: draw a card, say your answer out loud, then compare with our sample. You can record yourself. The recording stays in your browser and is never uploaded.</p>';
 h+='<div class="ex-part ac-card"><h3>Sprechen, Teil 1: Sich vorstellen</h3><p class="mk-ins" lang="de">Stellen Sie sich vor. Sagen Sie etwas zu diesen Punkten:</p><div class="mk-chips">'+SP1.map(function(w){return '<span>'+w+'</span>'}).join('')+'</div>'+
 '<p class="mk-ins" lang="de">Danach fragt die Prüferin zum Beispiel: <i>„Buchstabieren Sie bitte Ihren Vornamen.“</i> oder <i>„Wie ist Ihre Telefonnummer?“</i> (A made-up number is fine.)</p>'+rec('p1')+samp(SP1M)+'</div>';
 h+='<div class="ex-part ac-card"><h3>Sprechen, Teil 2: Um Informationen bitten und Informationen geben</h3><p class="mk-ins" lang="de">Ziehen Sie eine Karte. Stellen Sie eine Frage mit dem Wort. Ihr Partner antwortet. Dann fragt Ihr Partner Sie.</p>'+
 '<div class="mk-theme"><label>Thema <select id="p2t">'+SP2.map(function(t,i){return '<option value="'+i+'">'+t.th+'</option>'}).join('')+'</select></label><button type="button" class="btn sm" id="p2d">Karte ziehen</button></div><div id="p2c" class="mk-card-wrap"></div>'+rec('p2')+'</div>';
 h+='<div class="ex-part ac-card"><h3>Sprechen, Teil 3: Bitten formulieren und darauf reagieren</h3><p class="mk-ins" lang="de">Ziehen Sie eine Bildkarte. Formulieren Sie eine Bitte. Ihr Partner reagiert darauf.</p>'+
 '<div class="mk-theme"><button type="button" class="btn sm" id="p3d">Bildkarte ziehen</button></div><div id="p3c" class="mk-card-wrap"></div>'+rec('p3')+'</div>';
 h+='<div class="ex-part ac-card"><h3>Selbsteinschätzung</h3><p class="adm-mut">Be honest. Real examiners give up to 3 points for Teil 1 and 6 points each for Teil 2 and 3.</p>'+
 selfq('pa','Teil 1: Ich habe alle 7 Punkte gesagt, buchstabiert und eine Zahl gesagt.',[['0',0],['teilweise',1.5],['ja',3]])+
 selfq('pb','Teil 2: Ich kann zu jeder Karte eine richtige Frage stellen und antworten.',[['0',0],['manchmal',3],['fast immer',6]])+
 selfq('pc','Teil 3: Ich kann zu jedem Bild eine Bitte sagen und reagieren.',[['0',0],['manchmal',3],['fast immer',6]])+'</div>';
 return h+foot('p')}
function selfq(id,t,o){var c=st.self[id];return '<fieldset class="ex-q mk-self" data-self="'+id+'"><legend lang="de">'+t+'</legend><div class="ex-opts">'+o.map(function(x){return '<label><input type="radio" name="'+id+'" value="'+x[1]+'"'+(c===x[1]?' checked':'')+'> '+x[0]+' ('+x[1]+' P.)</label>'}).join('')+'</div></fieldset>'}
function rec(id){return '<div class="mk-rec" data-rec="'+id+'"><button type="button" class="btn outline sm mk-rb">● Aufnehmen</button><span class="mk-rt adm-mut"></span><audio controls hidden></audio></div>'}
function samp(t){return '<details class="mk-samp"><summary>Beispiel anhören / lesen (sample answer)</summary><p lang="de">'+esc(t)+'</p></details>'}
function foot(k){if(k==='p')return '<div class="ex-submit"><button type="button" class="btn" id="mk-sub">Sprechen abschließen</button><span class="adm-mut">Saves your self-rating for the final result.</span></div>';
 return st.done[k]?'<div class="ex-submit"><button type="button" class="btn outline" id="mk-next">Weiter zum nächsten Teil</button></div>':'<div class="ex-submit"><button type="button" class="btn" id="mk-sub">Abgeben</button><span class="adm-mut">Once you submit, you can’t change your answers. The marks and solutions come at the end.</span></div>'}

/* ---------- BEHAVIOUR ---------- */
var aud=new Audio(),busy=false;aud.preload='none';
function wire(k){var b=document.getElementById('mk-body');
 b.querySelectorAll('input[type=radio]').forEach(function(r){r.onchange=function(){if(r.closest('[data-self]'))st.self[r.name]=+r.value;else st.ans[r.name]=isNaN(+r.value)?r.value:+r.value;save()}});
 b.querySelectorAll('input[type=text],textarea').forEach(function(t){t.oninput=function(){st.ans[t.dataset.k]=t.value;save();if(t.id==='s6')wc()}});if(k==='s')wc();
 b.querySelectorAll('.mk-play').forEach(function(p){p.onclick=function(){play(p)}});
 var s=document.getElementById('mk-sub');if(s)s.onclick=function(){if(k==='p'){st.done.p=true;save();show('r');return}
  var open=b.querySelectorAll('.ex-q[data-q]').length-b.querySelectorAll('.ex-q[data-q] input:checked').length;
  if(!confirm(open>0?open+' question(s) still have no answer. Submit anyway?':'Submit this part now?'))return;submit(k)};
 var nx=document.getElementById('mk-next');if(nx)nx.onclick=function(){show(SECS[SECS.map(function(x){return x.k}).indexOf(k)+1].k)};
 if(k==='p')wireP();if(k==='r')wireR();}
function wc(){var t=(st.ans.s6||'').trim(),n=t?t.split(/\s+/).length:0,el=document.getElementById('s6c');if(el)el.textContent=n+' Wörter'+(n&&n<20?' · a bit short, aim for about 30':'')}
function play(p){if(busy||p.disabled)return;var id=p.dataset.a,max=+p.dataset.max,used=st.plays['h'+id]||0;if(used>=max)return;
 if(st.left.h==null){var sb=document.getElementById('mk-start');if(sb)sb.click()}
 busy=true;st.plays['h'+id]=used+1;save();root.classList.add('mk-busy');p.classList.add('on');p.querySelector('span').textContent='Läuft …';
 aud.src=AU+'h'+id+'.mp3?v='+V;aud.onended=aud.onerror=function(){busy=false;root.classList.remove('mk-busy');p.classList.remove('on');var left=max-st.plays['h'+id];p.querySelector('em').textContent=left+'× übrig';p.querySelector('span').textContent=left?'Noch einmal':'Schon gehört';if(!left)p.disabled=true};
 aud.play().catch(function(){aud.onended()})}
function submit(k){clearInterval(timer);aud.pause();busy=false;st.done[k]=true;save();shell();var i=SECS.map(function(x){return x.k}).indexOf(k);show(i<3?SECS[i+1].k:'r')}
var mr=null,chunks=[];
function wireP(){var b=document.getElementById('mk-body');
 var d2=document.getElementById('p2d'),d3=document.getElementById('p3d'),last2=-1,last3=-1;
 function pick(n,last){var r;do{r=Math.random()*n|0}while(n>1&&r===last);return r}
 d2.onclick=function(){var t=SP2[+document.getElementById('p2t').value],i=pick(t.c.length,last2);last2=i;var c=t.c[i];
  document.getElementById('p2c').innerHTML='<div class="mk-card"><small>Thema: '+t.th+'</small><b lang="de">'+c[0]+'</b></div><details class="mk-samp"><summary>Beispiel</summary><p lang="de"><b>Frage:</b> '+c[1]+'<br><b>Antwort:</b> '+c[2]+'</p></details>'};
 d3.onclick=function(){var i=pick(SP3.length,last3);last3=i;var c=SP3[i];
  document.getElementById('p3c').innerHTML='<div class="mk-card pic"><span class="mk-emo" aria-hidden="true">'+c[0]+'</span><button type="button" class="mk-word">Wort zeigen</button></div><details class="mk-samp"><summary>Beispiel</summary><p lang="de"><b>Bitte:</b> '+c[2]+'<br><b>Reaktion:</b> '+c[3]+'</p></details>';
  var w=document.querySelector('#p3c .mk-word');w.onclick=function(){w.outerHTML='<b lang="de">'+c[1]+'</b>'}};
 b.querySelectorAll('.mk-rec').forEach(function(r){var btn=r.querySelector('.mk-rb'),au=r.querySelector('audio'),t=r.querySelector('.mk-rt'),iv;
  btn.onclick=async function(){if(mr&&mr.state==='recording'){mr.stop();return}
   if(!navigator.mediaDevices||!window.MediaRecorder){t.textContent='Recording isn’t supported in this browser.';return}
   try{var s=await navigator.mediaDevices.getUserMedia({audio:true})}catch(e){t.textContent='Microphone blocked. Allow it in your browser settings to record.';return}
   chunks=[];mr=new MediaRecorder(s);var sec=0;mr.ondataavailable=function(e){chunks.push(e.data)};
   mr.onstop=function(){clearInterval(iv);s.getTracks().forEach(function(x){x.stop()});au.src=URL.createObjectURL(new Blob(chunks,{type:mr.mimeType}));au.hidden=false;btn.textContent='● Neu aufnehmen';t.textContent='Listen back. Nothing was uploaded.'};
   mr.start();btn.textContent='■ Stopp';iv=setInterval(function(){t.textContent='Aufnahme … '+fmt(++sec)},1000)}})}

/* ---------- RESULTS ---------- */
function norm(s){return String(s||'').toLowerCase().replace(/[^a-zäöüß0-9 ]/g,' ').replace(/\s+/g,' ').trim()}
function sGap(){var a=st.ans;return [/^(24|vierundzwanzig)( jahre)?( alt)?$/.test(norm(a.s1)),/^pakistan$/.test(norm(a.s2)),/urdu/.test(norm(a.s3))&&/englisch|english/.test(norm(a.s3)),a.s4===2,a.s5===2]}
function score(){var h=H.filter(function(x){return st.ans['h'+x.id]===x.a}).length,n=0,l=0;
 L1.forEach(function(t){t.q.forEach(function(x){n++;if(st.ans['l'+n]===x.a)l++})});L2.forEach(function(x){n++;if(st.ans['l'+n]===x.k)l++});L3.forEach(function(x){n++;if(st.ans['l'+n]===x.a)l++});
 var g=sGap().filter(Boolean).length,w=['sa','sb','sc','sd'].reduce(function(s,k){return s+(st.self[k]||0)},0),p=['pa','pb','pc'].reduce(function(s,k){return s+(st.self[k]||0)},0);
 function c(x){return Math.round(x*25/15*10)/10}return {h:h,l:l,s:g+w,p:p,H:c(h),L:c(l),S:c(g+w),P:c(p)}}
function renderR(){var sc=score(),tot=Math.round(sc.H+sc.L+sc.S+sc.P),pass=tot>=60,miss=SECS.filter(function(s){return !st.done[s.k]});
 var h='<div class="ac-card mk-res'+(pass?' pass':'')+'"><div class="mk-big"><b>'+tot+'</b><span>/ 100</span></div><div><h2>'+(pass?'Bestanden!':'Noch nicht bestanden')+'</h2><p>'+(pass?'That’s a pass on this practice paper. The real exam also needs 60 out of 100. Do one more round under strict time before you book.':'You need 60 out of 100 to pass. Look at the answers below, see where the points went, and try again in a few days.')+'</p>'+
 (miss.length?'<p class="mk-warn">Not finished yet: '+miss.map(function(s){return s.n}).join(', ')+'. Those parts count as 0 until you do them.</p>':'')+'</div></div>';
 h+='<div class="mk-mods">'+[['Hören',sc.h,sc.H],['Lesen',sc.l,sc.L],['Schreiben',sc.s,sc.S],['Sprechen',sc.p,sc.P]].map(function(m){return '<div class="mk-mod"><span>'+m[0]+'</span><b>'+m[2]+'</b><small>von 25 · '+m[1]+'/15 Rohpunkte</small><i style="width:'+(m[2]*4)+'%"></i></div>'}).join('')+'</div>';
 h+='<p class="adm-mut">Like the real Goethe-Zertifikat A1: each module has 15 raw points, converted to 25, total 100. Hören, Lesen and the form in Schreiben Teil 1 are marked automatically. The e-mail and Sprechen use your own self-rating, so ask a teacher if you want an honest second opinion.</p>';
 /* Hören review */
 h+='<div class="ac-card mk-rev"><h3>Hören: Lösungen und Transkripte</h3>'+H.map(function(x){var u=st.ans['h'+x.id],ok=u===x.a;return '<details class="'+(ok?'ok':'bad')+'"><summary><b>'+x.id+'</b> '+(ok?'✓':'✗')+' <span lang="de">'+esc(x.t)+'</span></summary><p>Your answer: '+(u==null?'–':esc(x.o[u]))+' · Correct: <b lang="de">'+esc(x.o[x.a])+'</b></p><p class="mk-tr" lang="de">'+nl(x.tr)+'</p><button type="button" class="btn outline sm mk-replay" data-a="'+x.id+'">▶ Nochmal anhören</button></details>'}).join('')+'</div>';
 var n=0,rows=[];L1.forEach(function(t){t.q.forEach(function(x){n++;rows.push([n,x.t,RF,x.a])})});L2.forEach(function(x){n++;rows.push([n,x.t,['a','b'],x.k])});L3.forEach(function(x){n++;rows.push([n,x.t,RF,x.a])});
 h+='<div class="ac-card mk-rev"><h3>Lesen: Lösungen</h3>'+rows.map(function(r){var u=st.ans['l'+r[0]],ok=u===r[3];return '<details class="'+(ok?'ok':'bad')+'"><summary><b>'+r[0]+'</b> '+(ok?'✓':'✗')+' <span lang="de">'+esc(r[1])+'</span></summary><p>Your answer: '+(u==null?'–':r[2][u])+' · Correct: <b>'+r[2][r[3]]+'</b></p></details>'}).join('')+'</div>';
 var g=sGap(),lab=['Alter: 24','Herkunftsland: Pakistan','Sprachen: Urdu, Englisch','Kurszeit: Abend','Zahlung: Überweisung'],you=[st.ans.s1,st.ans.s2,st.ans.s3,['Vormittag','Nachmittag','Abend'][st.ans.s4],['bar','mit Karte','Überweisung'][st.ans.s5]];
 h+='<div class="ac-card mk-rev"><h3>Schreiben, Teil 1: Formular ('+g.filter(Boolean).length+'/5)</h3>'+lab.map(function(x,i){return '<p class="'+(g[i]?'ok':'bad')+'">'+(g[i]?'✓':'✗')+' <span lang="de">'+x+'</span> <span class="adm-mut">· you wrote: '+esc(you[i]||'–')+'</span></p>'}).join('')+'<p class="adm-mut">Small spelling slips cost the point in the real exam too. Write <i lang="de">Pakistan</i>, not <i>Pakistani</i>.</p></div>';
 h+='<div class="ac-card mk-rev"><h3>Schreiben, Teil 2: E-Mail an Jonas</h3><p><b>Your text:</b></p><p class="mk-tr" lang="de">'+(st.ans.s6?nl(st.ans.s6):'<i>no text</i>')+'</p><p><b>Beispiel (model answer, 39 Wörter):</b></p><p class="mk-tr" lang="de">Lieber Jonas,<br>am Samstag habe ich Geburtstag und ich mache eine kleine Party. Die Party beginnt um 19 Uhr bei mir zu Hause in der Gartenstraße 5. Kannst du bitte Musik oder einen Salat mitbringen? Ich freue mich!<br>Viele Grüße<br>Ali</p>'+
 '<p><b>Check your own text and give yourself points:</b></p>'+
 selfq('sa','Punkt 1: Ich schreibe, warum ich schreibe (Geburtstag, Party).',[['fehlt',0],['unklar',1.5],['klar',3]])+selfq('sb','Punkt 2: Wann und wo die Party ist.',[['fehlt',0],['unklar',1.5],['klar',3]])+selfq('sc','Punkt 3: Was Jonas mitbringen soll.',[['fehlt',0],['unklar',1.5],['klar',3]])+selfq('sd','Anrede (Lieber Jonas) und Gruß (Viele Grüße) sind da.',[['nein',0],['ja',1]])+
 '<p class="adm-mut">“Unklar” means a reader would have to guess what you mean. Grammar mistakes are fine at A1 as long as the message is clear.</p></div>';
 h+='<div class="ex-submit"><button type="button" class="btn" id="mk-again">Neu starten</button><a class="btn outline" href="assets/docs/dfa-a1-mock-1-antwortbogen.pdf" download>Antwortbogen (PDF)</a>'+(SECS.every(function(s){return st.done[s.k]})&&window.DFA&&DFA.sb?'<button type="button" class="btn outline" id="mk-push">Save score to my account</button>':'')+'<span class="adm-mut" id="mk-save"></span></div>';
 return h}
function wireR(){document.querySelectorAll('.mk-replay').forEach(function(b){b.onclick=function(){aud.onended=aud.onerror=null;aud.src=AU+'h'+b.dataset.a+'.mp3?v='+V;aud.play()}});
 document.getElementById('mk-again').onclick=function(){if(!confirm('Delete all answers and start the mock exam again?'))return;st={ans:{},done:{},plays:{},left:{},self:{}};save();shell();show('h')};
 var saved=false;document.querySelectorAll('[data-self] input').forEach(function(r){r.addEventListener('change',function(){var y=scrollY;show('r');scrollTo(0,y)})});
 var ps=document.getElementById('mk-push');if(ps)ps.onclick=pushScore}
async function pushScore(){if(!SECS.every(function(s){return st.done[s.k]}))return;var D=window.DFA,el=document.getElementById('mk-save');if(!D||!D.sb)return;
 try{var s=(await D.sb.auth.getSession()).data.session;if(!s){el.innerHTML='You’re not logged in. <a href="account.html">Log in</a> in a new tab, then press save again.';return}
  var sc=score(),tot=Math.round(sc.H+sc.L+sc.S+sc.P),sig=JSON.stringify(sc);if(st.pushed===sig){el.textContent='Saved to your account.';return}
  var r=await D.sb.from('exam_attempts').insert({exam_slug:SLUG,score:tot,max_score:100,answers:{mods:sc,ans:st.ans}});if(!r.error){st.pushed=sig;save()}el.textContent=r.error?'Could not save your score right now.':'Saved to your account.'}catch(e){}}
shell();show(st.cur||'h');
})();
