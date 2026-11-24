/** QA Tester recheck, round 2 — browser side (assets/dfa-admin*.js, dfa-auth.js, dfa-verify.js). */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = (p) => readFileSync(path.join(root, p), 'utf8');
const adm = rd('assets/dfa-admin.js'), pro = rd('assets/dfa-admin-pro.js'), css = rd('assets/dfa-admin-pro.css'), auth = rd('assets/dfa-auth.js'), ver = rd('assets/dfa-verify.js'), html = rd('admin.html');

// 1. wrong student after a re-render
assert.ok(/document\.addEventListener\('click',function\(ev\)\{var t=ev\.target&&ev\.target\.closest&&ev\.target\.closest\('\.adm-card button/.test(adm), 'capture-phase card guard');
assert.ok(/\},true\);\nasync function enr|\},true\);\n[^\n]*\nasync function enr/.test(adm) || /ev\.stopImmediatePropagation\(\)\}\},true\)/.test(adm));
assert.ok(/B\.classList\.contains\('adm-busy'\)\|\|now<\(B\._settle\|\|0\)\|\|!card\.isConnected\|\|\(card\.dataset\.seq&&\+card\.dataset\.seq!==ENRSEQ\)\|\|dbl/.test(adm), 'busy, settle window, detached, old draw, double click');
assert.ok(/B\.classList\.remove\('adm-busy'\);B\._seq=seq;B\._settle=Date\.now\(\)\+400/.test(adm), 'busy until the new list is drawn');
assert.ok(!/if\(seq!==ENRSEQ\)return;B\.classList\.remove\('adm-busy'\);/.test(adm), 'no early un-busy before payments/bar load');
assert.ok(/data-id="'\+x\.id\+'" data-stid="'\+E\(x\.student_id\|\|''\)\+'" data-seq="'\+ENRSEQ\+'"/.test(adm), 'cards carry enrollment id, Student ID and draw number');
assert.ok(/var x0=rows\.find\(function\(y\)\{return y\.id===id\}\);if\(!x0\|\|!tr\.isConnected\|\|\(tr\.dataset\.stid\|\|''\)!==String\(x0\.student_id\|\|''\)\)/.test(adm));
assert.ok(/function cfm\(t\)\{return confirm\('Student: '\+WHO\+'\\n\\n'\+t\)\}/.test(adm), 'every card confirm names the student and ID');
const wire = adm.slice(adm.indexOf('function wireCards('), adm.indexOf('async function refreshOne('));
assert.equal((wire.match(/[^.\w]confirm\(/g) || []).length, 1, 'only cfm() itself calls confirm() in card handlers');
assert.ok(/expect_sid:SID/.test(adm) && /expect_sid:sid\|\|undefined/.test(pro), 'actions send the Student ID shown on the card');
assert.ok(/if\(!x\|\|!card\.isConnected\|\|\+card\.dataset\.id!==x\.id/.test(pro), 'More menu actions are bound to the card');
assert.ok(/if\(B\._seq!==seq0\)return;/.test(pro), 'a slow decorate for an old draw is dropped');
// TEST mark: name + ID shown, typed Student ID
const tm = pro.slice(pro.indexOf('async function testMark('), pro.indexOf('/* ---------- small dialogs'));
assert.ok(/word:word/.test(tm) && /var sid=x\.student_id\|\|'',word=sid\|\|'TEST'/.test(tm) && /Student ID <b>'\+E\(sid\)/.test(tm) && /confirm:c\.word/.test(tm));
assert.ok(!/inv\('pro_mark_test',\{id:id,on:on\}\)/.test(pro), 'data check uses the typed confirm too');
assert.ok(!/window\.confirm|!confirm\(on\?'Mark '/.test(pro));

// 3. speed
assert.ok(/forceFunctionRegion='\+FN_REGION/.test(auth) && /FN_REGION='ap-northeast-1'/.test(auth), 'functions pinned next to the database');
assert.ok(/r\.error\.name==='FunctionsFetchError'\)\{pinOn=false/.test(auth), 'falls back when the region is unreachable');
assert.ok(/SAFE_RETRY=/.test(auth) && !/SAFE_RETRY=[^\n]*\b(activate|record_payment|certify|pro_adjust)\b/.test(auth), 'money/certificate actions are never retried automatically');
assert.ok(/lock:LOCK/.test(auth) && /window\.supabase\.processLock/.test(auth), 'in-tab auth lock');
assert.ok(/function warm\(\)\{try\{counts\(\);batches\(\);allTags\(\)\}/.test(pro) && /if\(PRO\.warm\)PRO\.warm\(\);r=await PRO\.studentQuery/.test(adm), 'filter bar lookups start with the list');
assert.ok(/var barP=PRO\?PRO\.barHtml\(ST,total\):null;/.test(adm), 'bar builds while payments load');
for (const k of ['dash', 'rem', 'rv']) assert.ok(new RegExp(`tabCache\\('${k}'`).test(pro) && new RegExp(`freshNote\\('${k}'\\)`).test(pro), 'cached tab with Refresh: ' + k);
assert.ok(/freshNote\('batches'\)/.test(pro) && /var bs=await batches\(\);/.test(pro));
assert.ok(/can\('attendance'\)\?'<button type="button" class="btn outline sm" data-ba="att"/.test(pro), 'Attendance button is hidden unless the staff member has attendance');
assert.ok(/function invalidate\(\)\{CCat=0;BATCHES=null;BATCHESp=null;TGp=null;TABC=\{\}\}/.test(pro), 'writes clear the caches');
assert.ok(/function onTab\(t\)/.test(pro) && /if\(!onTab\('db'\)\)return;/.test(pro), 'late answers never paint over another tab');

// 4. attendance: one RPC, one activity line
assert.ok(/sb\.rpc\('attendance_save',\{p_batch:b\.id,p_date:date/.test(pro) && !/sb\.from\('attendance'\)\.upsert/.test(pro));
assert.ok(/var LSEQ=0;async function load\(more\)\{var my=\+\+LSEQ;/.test(pro), 'activity filter: newest request wins');

// 5. slips
const sc = pro.slice(pro.indexOf('async function slipCheck('), pro.indexOf('async function uploadProof('));
assert.ok(/file\.size<200/.test(sc) && /w<10\|\|h<10/.test(sc) && /createImageBitmap/.test(sc));
assert.ok(/!a\.data\.has_proof/.test(pro) && /select\('id,proof_file'\)\.eq\('id',pid\)/.test(pro), 'saved slip is read back before success');
assert.ok(/toast\(file\?'Slip saved':'Reference saved'\)/.test(pro) && !/toast\('Saved'\);after&&after\(\)/.test(pro));

// 6. emails
assert.ok(/data-resend="'\+l\.id\+'"/.test(pro) && /inv\('email_resend',\{log_id:/.test(pro), 'admin Resend in the email log');
assert.ok(/<option value="certificate">Certificates<\/option><option value="adjustment">Discount \/ refund receipts<\/option>/.test(pro));
assert.ok(/l\.status==='skipped'/.test(pro));
assert.ok(/action:'certify',id:id,email:mail/.test(adm), 'certify can email the certificate');

// 7. stale cards
assert.ok(/async function refreshOne\(id\)/.test(adm) && /B\._refreshOne=refreshOne/.test(adm));
assert.ok(/return tagsDlg\(x,mt,one\)/.test(pro) && /B\._refreshOne\?B\._refreshOne\(cid\)/.test(pro) && /refreshOne\(id\);return\}/.test(adm));

// 8. UX
assert.ok(/document\.querySelectorAll\('dialog\.adm-dlg'\)\.forEach\(function\(o\)\{if\(o\.dataset\.t===t0\)/.test(adm), 'one dialog per title (no stacking)');
assert.ok(/\.adm-dlg \[hidden\],\.adm-dlg \.btn\[hidden\]\{display:none!important\}/.test(css), 'hidden dialog buttons stay hidden (no stray Send)');
assert.ok(/value="ok">Save<\/button>/.test(adm) && !/value="ok">Send<\/button>/.test(adm));
assert.ok(/Class status <select name="sst"/.test(pro) && /label\.adm-stk\{display:inline-flex;flex-direction:column/.test(css));
assert.ok(/>Email reminder now<\/button>/.test(pro) && !/>Send now</.test(pro));
assert.ok(/fm0\.name\.oninput=function\(\)\{if\(!touched\)tk\.checked=\/\\btest\\b\/i\.test\(fm0\.name\.value\)\}/.test(adm), 'TEST suggested from the name');
assert.ok(/localStorage\.getItem\('dfa-adm-privacy'\)!=='0'\}catch\(e\)\{return true\}/.test(pro), 'Hide contacts is on by default');

// 9. verify shows REVOKED
assert.ok(/>REVOKED<\/span>/.test(ver) && /x\.certificate_no\?' '\+E\(x\.certificate_no\)/.test(ver));

// versions bumped
assert.ok(/dfa-admin-pro\.css\?v=6/.test(html) && /dfa-auth\.js\?v=47/.test(html) && /dfa-admin-pro\.js\?v=8/.test(html) && /dfa-admin\.js\?v=55/.test(html));
// no private contacts in the new UI text
for (const s of [adm, pro, auth, ver]) assert.ok(!/deutschfuraalle@|wa\.me\/92|\+92 ?3\d{2}/.test(s));
console.log('admin-qa2-ui: all checks passed');
