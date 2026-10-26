/* Live book reviews. Needs supabase-js + dfa-auth.js. Only real reviews from signed-in readers are shown. */
(function(){
var box=document.getElementById('reviews');if(!box||!window.DFA)return;var sb=DFA.sb,E=DFA.esc;
var slug=location.pathname.split('/').pop().replace(/\.html$/,'')||box.dataset.slug;
var list=box.querySelector('.rv-list'),form=box.querySelector('.rv-form');
function stars(n){var r=Math.round(n);return '<span class="rv-stars" aria-hidden="true">'+'★'.repeat(r)+'<span class="off">'+'★'.repeat(5-r)+'</span></span>'}
function date(d){return new Date(d).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}
var me=null,mine=null;
async function load(){
 var q=await sb.from('reviews').select('id,user_id,username,rating,comment,created_at,updated_at,verified_buyer,hidden').eq('book_slug',slug).order('created_at',{ascending:false});
 if(q.error){list.innerHTML='<div class="rv-empty"><p>Reviews could not be loaded just now. Please try again in a moment.</p></div>';return}
 var rows=q.data.filter(function(r){return !r.hidden});mine=me?q.data.find(function(r){return r.user_id===me.id}):null;
 var n=rows.length,avg=n?rows.reduce(function(a,r){return a+r.rating},0)/n:0;
 var h='<div class="rv-sum">'+(n?stars(avg)+'<span><b>'+avg.toFixed(1)+'</b> out of 5 · '+n+' review'+(n>1?'s':'')+'</span>':'<span class="rv-stars off" aria-hidden="true">★★★★★</span><span>No ratings yet</span>')+'</div>';
 if(!n)h+='<div class="rv-empty"><p><b>No reviews yet.</b></p><p>Used this book with your child or in class? Your honest rating helps other parents and learners choose.</p></div>';
 else h+='<ul class="rv-items">'+rows.map(function(r){return '<li class="rv-item"><div class="rv-top">'+stars(r.rating)+'<span class="sr">'+r.rating+' out of 5</span><b>'+E(r.username||'Reader')+'</b>'+(r.verified_buyer?'<span class="rv-vb">Verified buyer</span>':'')+'<time>'+date(r.created_at)+'</time></div>'+(r.comment?'<p>'+E(r.comment)+'</p>':'')+'</li>'}).join('')+'</ul>';
 list.innerHTML=h;renderForm()}
function renderForm(){
 if(!me){form.removeAttribute('aria-disabled');form.innerHTML='<h3>Write a review</h3><p>Log in or create a free account to rate this book. It takes under a minute.</p><a class="btn" href="../account.html?next='+encodeURIComponent(location.pathname+'#reviews')+'">Log in to review</a>';return}
 var r=mine||{rating:0,comment:''};
 form.removeAttribute('aria-disabled');
 form.innerHTML='<h3>'+(mine?'Your review':'Write a review')+'</h3>'+(mine&&mine.hidden?'<p class="rv-small">Your review is currently hidden by a moderator.</p>':'')+
 '<fieldset class="rv-rate"><legend>Your rating</legend><div class="rv-starpick">'+[5,4,3,2,1].map(function(i){return '<input type="radio" name="rt" id="rt'+i+'" value="'+i+'"'+(r.rating===i?' checked':'')+'><label for="rt'+i+'" title="'+i+' star'+(i>1?'s':'')+'">★<span class="sr">'+i+' star'+(i>1?'s':'')+'</span></label>'}).join('')+'</div></fieldset>'+
 '<label>Your review <textarea rows="4" maxlength="2000" placeholder="What did you like? What could be better?">'+E(r.comment||'')+'</textarea></label>'+
 '<p class="rv-small">Posting as <b>'+E(me.username||me.email)+'</b>.</p><div class="rv-btns"><button class="btn" type="button" data-save>'+(mine?'Update review':'Post review')+'</button>'+(mine?'<button class="btn outline" type="button" data-del>Delete</button>':'')+'</div><p class="rv-msg" role="status"></p>';
 var msg=form.querySelector('.rv-msg');
 form.querySelector('[data-save]').onclick=async function(){var v=form.querySelector('input[name=rt]:checked');if(!v){msg.textContent='Please pick a star rating first.';return}
  var c=form.querySelector('textarea').value.trim()||null,res;this.disabled=true;
  res=mine?await sb.from('reviews').update({rating:+v.value,comment:c}).eq('id',mine.id):await sb.from('reviews').insert({book_slug:slug,rating:+v.value,comment:c});
  this.disabled=false;if(res.error){msg.textContent='Sorry, that did not save: '+res.error.message;return}await load();form.querySelector('.rv-msg').textContent='Thanks, your review is saved.'};
 var d=form.querySelector('[data-del]');if(d)d.onclick=async function(){if(!confirm('Delete your review?'))return;var res=await sb.from('reviews').delete().eq('id',mine.id);if(res.error){msg.textContent=res.error.message;return}await load()}}
DFA.profile().then(function(p){me=p;load()});
})();
