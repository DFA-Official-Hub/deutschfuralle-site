/* Sample A1 Lesen mock test, written by Deutsch Für Alle. Auto-scored in the browser. */
(function(){
var root=document.getElementById('exam-app');if(!root)return;var E=DFA.esc,sb=DFA.sb,SLUG='a1-lesen-sample-1';
var T=[
{title:'Teil 1: Eine E-Mail',text:'Liebe Sara,\n\nwie geht es dir? Ich wohne jetzt in Köln. Meine Wohnung ist klein, aber sie hat einen Balkon. Ich arbeite in einem Café am Bahnhof, von Montag bis Freitag, immer von 7 bis 14 Uhr. Am Wochenende habe ich frei.\nKommst du am Samstag zu mir? Wir können zusammen kochen. Bring bitte Brot mit, ich kaufe Gemüse und Käse.\n\nViele Grüße\nLena',
 q:[{t:'Lena wohnt in Köln.',o:['Richtig','Falsch'],a:0},{t:'Lenas Wohnung ist groß.',o:['Richtig','Falsch'],a:1},{t:'Lena arbeitet am Samstag.',o:['Richtig','Falsch'],a:1},{t:'Was soll Sara mitbringen?',o:['Gemüse','Brot','Käse'],a:1}]},
{title:'Teil 2: Anzeigen',text:'A) Sprachschule Sonne: Deutschkurse am Abend, Montag und Mittwoch, 18 bis 20 Uhr. Anmeldung online.\nB) Fahrrad zu verkaufen, fast neu, 90 Euro. Nur am Wochenende anrufen.\nC) Bäckerei Lange sucht Verkäuferin oder Verkäufer, Arbeitszeit 6 bis 12 Uhr.\nD) Arztpraxis Dr. Weber: Vom 3. bis 14. August geschlossen. Vertretung: Praxis Dr. Klein, Gartenstraße 5.',
 q:[{t:'Sie möchten am Abend Deutsch lernen. Welche Anzeige passt?',o:['A','B','C'],a:0},{t:'Sie suchen eine Arbeit am Morgen. Welche Anzeige passt?',o:['B','C','D'],a:1},{t:'Sie sind am 5. August krank. Wohin gehen Sie?',o:['Praxis Dr. Weber','Praxis Dr. Klein','Sprachschule Sonne'],a:1}]},
{title:'Teil 3: Schilder',text:'1) Am Bahnhof: „Fahrkarten bitte vor der Fahrt am Automaten kaufen.“\n2) Im Supermarkt: „Heute bis 22 Uhr geöffnet. Sonntag geschlossen.“\n3) Im Museum: „Fotos ohne Blitz erlaubt.“',
 q:[{t:'Man kann die Fahrkarte im Zug kaufen.',o:['Richtig','Falsch'],a:1},{t:'Der Supermarkt ist am Sonntag geöffnet.',o:['Richtig','Falsch'],a:1},{t:'Im Museum darf man fotografieren.',o:['Richtig','Falsch'],a:0}]}];
var n=0,h='<form id="exam-form">';
T.forEach(function(p,pi){h+='<div class="ex-part ac-card"><h3>'+p.title+'</h3><div class="ex-text" lang="de">'+E(p.text).replace(/\n/g,'<br>')+'</div>';
 p.q.forEach(function(q){n++;h+='<fieldset class="ex-q" data-a="'+q.a+'"><legend><b>'+n+'.</b> <span lang="de">'+E(q.t)+'</span></legend><div class="ex-opts">'+q.o.map(function(o,oi){return '<label><input type="radio" name="q'+n+'" value="'+oi+'" required> <span lang="de">'+E(o)+'</span></label>'}).join('')+'</div></fieldset>'});h+='</div>'});
h+='<div class="ex-submit"><button class="btn">Check my answers</button><span class="adm-mut" id="ex-note"></span></div></form><div id="ex-result" aria-live="polite"></div><div id="ex-hist"></div>';root.innerHTML=h;
var tStart=Date.now(),note=document.getElementById('ex-note');
sb.auth.getSession().then(function(s){note.textContent=s.data.session?'Your score will be saved to your account.':'Log in to save your scores.';if(s.data.session)hist()});
async function hist(){var r=await sb.from('exam_attempts').select('score,max_score,created_at').eq('exam_slug',SLUG).order('created_at',{ascending:false}).limit(5);
 if(r.data&&r.data.length)document.getElementById('ex-hist').innerHTML='<div class="ac-card"><h3>Your recent attempts</h3><ul>'+r.data.map(function(a){return '<li>'+a.score+' / '+a.max_score+' · '+new Date(a.created_at).toLocaleString('en-GB')+'</li>'}).join('')+'</ul></div>'}
document.getElementById('exam-form').onsubmit=async function(e){e.preventDefault();var sc=0,ans={};
 this.querySelectorAll('.ex-q').forEach(function(f,i){var v=f.querySelector('input:checked'),ok=v&&+v.value===+f.dataset.a;ans['q'+(i+1)]=v?+v.value:null;if(ok)sc++;f.classList.remove('ok','bad');f.classList.add(ok?'ok':'bad')});
 var pct=Math.round(sc/n*100),pass=pct>=60;
 document.getElementById('ex-result').innerHTML='<div class="ac-card ex-res"><h3>'+sc+' out of '+n+' ('+pct+'%)</h3><p>'+(pass?'Well done, that would be a pass in this part. Look at the red answers to see what tripped you up.':'Not quite there yet, 60% is the usual pass mark. Read the texts again and look at the questions marked in red.')+'</p></div>';
 document.getElementById('ex-result').scrollIntoView({behavior:'smooth',block:'center'});
 var s=(await sb.auth.getSession()).data.session;if(s){var r=await sb.from('exam_attempts').insert({exam_slug:SLUG,score:sc,max_score:n,answers:Object.assign(ans,{seconds:Math.round((Date.now()-tStart)/1000)})});note.textContent=r.error?'Could not save: '+r.error.message:'Saved to your account.';hist()}};
})();
