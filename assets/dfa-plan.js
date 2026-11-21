/* Fee installment plans (custom schedules). Shared by admin.html and portal.html.
   Keep in sync with supabase/functions/admission/plan.ts (tests/installment-plan.test.mjs checks both). */
(function(g){
var ISO=/^\d{4}-\d{2}-\d{2}$/,MAX=1000000;
function isDate(s){if(!ISO.test(String(s||'')))return false;var t=Date.parse(s+'T00:00:00Z');return !isNaN(t)&&new Date(t).toISOString().slice(0,10)===s}
/** Same calendar day k months later; clamps to the month's last day (31 Jan + 1 month = 28/29 Feb). */
function addMonths(d,k){var p=d.split('-').map(Number),y=p[0],m=p[1]-1+k,yy=y+Math.floor(m/12),mm=((m%12)+12)%12,last=new Date(Date.UTC(yy,mm+1,0)).getUTCDate();return new Date(Date.UTC(yy,mm,Math.min(p[2],last))).toISOString().slice(0,10)}
function addDays(d,n){return new Date(Date.parse(d+'T00:00:00Z')+n*864e5).toISOString().slice(0,10)}
/** Even split rounded down to 1,000 (or 500 for small shares); the remainder goes on the last installment. */
function splitEven(total,n){total=Math.round(Number(total)||0);n=Math.round(Number(n)||0);if(n<1)return[];if(total<=0)return Array(n).fill(0);
 var share=total/n,unit=share>=10000?1000:share>=1000?500:1,base=Math.floor(share/unit)*unit,out=[];if(base<=0)base=Math.floor(share)||0;
 for(var i=0;i<n-1;i++)out.push(base);out.push(total-base*(n-1));return out}
/** Suggested due dates: first on the start date, then one month apart. */
function suggestDates(start,n){var out=[];for(var i=0;i<n;i++)out.push(addMonths(start,i));return out}
function suggest(total,n,start){var a=splitEven(total,n),d=suggestDates(start,n);return a.map(function(x,i){return {no:i+1,amount:x,due:d[i]}})}
/** Validates an admin-entered schedule. Returns {plan,total} or {error}. */
function normalize(list){if(!Array.isArray(list))return {error:'Add the installments.'};if(list.length<2||list.length>5)return {error:'Pick 2 to 5 installments.'};
 var out=[],total=0;for(var i=0;i<list.length;i++){var x=list[i]||{},a=typeof x.amount==='number'?x.amount:NaN,d=String(x.due||'');
  if(!(Number.isSafeInteger(a)&&a>0&&a<=MAX))return {error:'Installment '+(i+1)+': enter an amount in whole rupees.'};
  if(!isDate(d))return {error:'Installment '+(i+1)+': pick a due date.'};
  if(i&&d<out[i-1].due)return {error:'Installment '+(i+1)+' is due before installment '+i+'. Put the dates in order.'};
  out.push({no:i+1,amount:a,due:d});total+=a}
 return {plan:out,total:total}}
/** Status of each installment from the total paid so far (payments fill installments in order).
    pays (optional): [{amount,paid_on,installment_no}] used to show the date an installment was completed. */
function status(plan,paid,pays){paid=Math.max(Number(paid)||0,0);var ps=(pays||[]).slice().sort(function(a,b){return (a.installment_no||0)-(b.installment_no||0)}),cum=0,need=0;
 return (plan||[]).map(function(x){need+=Number(x.amount)||0;var left=Math.max(Math.min(need-paid,Number(x.amount)||0),0),st=left<=0?'paid':left<x.amount?'partial':'due',on=null;
  if(st==='paid'&&ps.length){cum=0;for(var j=0;j<ps.length;j++){cum+=Number(ps[j].amount)||0;if(cum>=need){on=ps[j].paid_on?String(ps[j].paid_on).slice(0,10):null;break}}}
  return {no:x.no,amount:x.amount,due:x.due,status:st,left:left,paid_on:on}})}
/** First installment that is not fully paid: {no,due,left,of} or null when everything is paid. */
function next(plan,paid){var s=status(plan,paid);for(var i=0;i<s.length;i++)if(s[i].status!=='paid')return {no:s[i].no,due:s[i].due,left:s[i].left,of:s.length};return null}
function lockedRows(plan,paid,pays){if(Array.isArray(plan)&&plan.length)return status(plan,paid).filter(function(x){return x.status==='paid'}).map(function(x){return {amount:x.amount,due:x.due}});
 return (pays||[]).slice().sort(function(a,b){return (a.installment_no||0)-(b.installment_no||0)}).map(function(p){return {amount:Number(p.amount)||0,due:String(p.paid_on||'').slice(0,10)}})}
function checkLocked(locked,nx){if(locked.length>nx.length)return 'The plan needs at least '+locked.length+' installments, because '+locked.length+' are already paid.';
 for(var i=0;i<locked.length;i++)if(nx[i].amount!==locked[i].amount||nx[i].due!==locked[i].due)return 'Installment '+(i+1)+' is already paid, so its amount and date can\'t change.';return null}
function payLabel(plan,before,after){var n=(plan||[]).length;if(!n)return '';var cum=0,a=-1,b=-1,se=false,ee=false;
 for(var i=0;i<n;i++){var lo=cum;cum+=Number(plan[i].amount)||0;if(a<0&&before<cum){a=i;se=before===lo}if(a>=0&&b<0&&after<=cum){b=i;ee=after===cum}}
 if(a<0)return '';if(b<0){b=n-1;ee=true}var part=!(se&&ee);return a===b?'Installment '+(a+1)+' of '+n+(part?' (part payment)':''):'Installments '+(a+1)+'\u2013'+(b+1)+' of '+n+(part?' (part payment)':'')}
var METHODS={cash:'Cash',bank:'Bank transfer',jazzcash:'JazzCash',easypaisa:'Easypaisa',other:'Other'};
var API={METHODS:METHODS,lockedRows:lockedRows,checkLocked:checkLocked,payLabel:payLabel,isDate:isDate,addMonths:addMonths,addDays:addDays,splitEven:splitEven,suggestDates:suggestDates,suggest:suggest,normalize:normalize,status:status,next:next};
g.DFA_PLAN=API;
})(typeof window!=='undefined'?window:globalThis);
