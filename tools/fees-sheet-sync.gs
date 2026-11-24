/**
 * DFA fee summary -> Google Sheets (add as a new file "Fees sync" in the SAME Apps Script project as the
 * website automation script, so it reuses FN_URL, API_KEY, RESPONSES_SHEET_ID, token_() and call_()).
 *
 * What it does (every 10 minutes, and right after a payment / correction / plan change / details edit
 * when the web app URL is saved as FEES_SYNC_URL in Supabase):
 *   1) Registration responses sheet, tab "Form Responses 1": fills the website columns on the right
 *      (Course (website) … Last Updated (website)) and an empty Invoice No. Rows are found by
 *      "DFA Student ID", or by email when the ID cell is empty. Form question columns are never written.
 *   2) Finance tracker, tab "Students & Fees": value columns only (Enrollment ID, Student, Course, Registered,
 *      Status, Total Fee, Next Due Date). Paid, Balance and Payment Status are formulas and are never touched;
 *      Discount and Notes stay yours.
 *   3) Finance tracker, tab "Payments": one row per receipt (matched by Invoice No). Student (C) is a formula and
 *      is never written; Proof (H) is only filled when empty, as a link (never a formula).
 *      A voided payment gets Amount 0 and "VOID" in Notes.
 *
 * Safety:
 *   - Never writes a formula: text starting with = + - @ is written with a leading ' so Sheets shows it as text.
 *   - Cells that hold a formula are never overwritten. New rows only go into rows that are completely empty.
 *   - Dates are read and written in each spreadsheet's own time zone (no day shift).
 *   - Before the first run, run reconcilePayments() and read the log: every manual Payments row must carry its
 *     Invoice No. While a manual row without an invoice number exists, no new payment rows are added (so nothing is
 *     counted twice); existing rows are still updated.
 *   - Set FEES_DRY_RUN = true to only log what would change.
 *
 * Setup (once): paste this file, Save, run reconcilePayments (Allow) and check the log, then run installFeesSync.
 * Optional instant updates: Deploy > New deployment > Web app (Execute as: me, Who has access: Anyone), copy the
 * /exec URL and save it in Supabase as the secret FEES_SYNC_URL. The web app reads nothing from the request,
 * runs at most once a minute and always answers "ok".
 * Runs as the owner of this script (no service account, no sharing changes).
 */
var FINANCE_ID = '1ZIRuuIGrRlBw4Qa24LYWcCGlpnNoPmSdD7PL6jEFFDw';
var FEES_TEST_IDS = ['DFA-2026-0001', 'DFA-2026-0002']; // test entries, never written to the sheets
var FEES_DRY_RUN = false;
var FEES_SYNC_REGISTRATION = true;
var REG_FEE_COLS = ['Course (website)', 'Total Fee (PKR)', 'Paid (PKR)', 'Balance (PKR)', 'Installments', 'Next Due Date', 'Next Due Amount (PKR)', 'Payment Status', 'Last Updated (website)'];
var PAY_METHODS = { cash: 'Cash', bank: 'Bank transfer', jazzcash: 'JazzCash', easypaisa: 'Easypaisa', other: 'Other' };

function installFeesSync() {
  var have = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  if (have.indexOf('syncFees') < 0) ScriptApp.newTrigger('syncFees').timeBased().everyMinutes(10).create();
  syncFees();
}
/** Web app ping from the website: at most one sync a minute, never waits for a running sync, always answers ok. */
function doPost() {
  try {
    var cache = CacheService.getScriptCache();
    if (!cache.get('fees_ping')) { cache.put('fees_ping', '1', 60); syncFees(0); }
  } catch (err) { console.log('fees ping: ' + err); }
  return ContentService.createTextOutput('ok');
}

function syncFees(waitMs) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(typeof waitMs === 'number' ? waitMs : 20000)) return;
  try {
    var feed = call_({ action: 'fees_feed' });
    var rows = (feed.rows || []).filter(function (r) { return r.student_id && FEES_TEST_IDS.indexOf(r.student_id) < 0; });
    var log = [], fin = SpreadsheetApp.openById(FINANCE_ID);
    if (FEES_SYNC_REGISTRATION) syncRegistration_(SpreadsheetApp.openById(RESPONSES_SHEET_ID), rows, log);
    syncFinanceStudents_(fin, rows, log);
    syncFinancePayments_(fin, rows, log);
    if (log.length) console.log((FEES_DRY_RUN ? 'DRY RUN, nothing written:\n' : '') + log.join('\n'));
  } finally { lock.releaseLock(); }
}

/** "2026-12-31" -> Date at midnight in the spreadsheet's own zone. */
function pkDate_(iso, tz) { return iso ? Utilities.parseDate(String(iso).slice(0, 10), tz, 'yyyy-MM-dd') : ''; }
function show_(v, tz) { return v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : String(v === null || v === undefined ? '' : v); }
function same_(a, b, tz) { return show_(a, tz) === show_(b, tz); }
/** Text that Sheets would read as a formula is written as plain text. */
function safe_(v) { return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v; }
function blankRow_(r) { return r.every(function (x) { return x === '' || x === null; }); }
function col_(head, re) { for (var i = 0; i < head.length; i++) if (re.test(String(head[i]).trim())) return i; return -1; }
/** Writes one cell only when the value changed; never over a formula; records old -> new. */
function put_(sh, r, c, oldV, newV, log, what, tz, formula) {
  if (formula) return false;
  if (same_(oldV, newV, tz)) return false;
  if (!FEES_DRY_RUN) sh.getRange(r, c + 1).setValue(safe_(newV));
  log.push(sh.getName() + '!' + sh.getRange(r, c + 1).getA1Notation() + ' (' + what + '): ' + show_(oldV, tz) + ' -> ' + show_(newV, tz));
  return true;
}
function putLink_(sh, r, c, url, log, what) {
  if (!FEES_DRY_RUN) sh.getRange(r, c + 1).setRichTextValue(SpreadsheetApp.newRichTextValue().setText('View proof').setLinkUrl(url).build());
  log.push(sh.getName() + '!' + sh.getRange(r, c + 1).getA1Notation() + ' (' + what + '): (empty) -> link ' + url);
}
/** Next completely empty row (all values blank), or a new row at the end. */
function freeRow_(vals, head) {
  for (var j = 1; j < vals.length; j++) if (blankRow_(vals[j])) return j;
  vals.push(head.map(function () { return ''; })); return vals.length - 1;
}

function syncRegistration_(ss, rows, log) {
  var tz = ss.getSpreadsheetTimeZone(), sh = ss.getSheetByName('Form Responses 1');
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  REG_FEE_COLS.forEach(function (h) { if (head.indexOf(h) < 0) { if (!FEES_DRY_RUN) sh.getRange(1, head.length + 1).setValue(h); log.push('Form Responses 1: new heading ' + h); head.push(h); } });
  var data = sh.getRange(1, 1, sh.getLastRow(), head.length).getValues();
  var cId = col_(head, /^DFA Student ID$/i), cEm = col_(head, /^Email/i), cInv = col_(head, /^Invoice No/i), C = {};
  REG_FEE_COLS.forEach(function (h) { C[h] = head.indexOf(h); });
  rows.forEach(function (f) {
    var r = -1;
    for (var i = 1; i < data.length; i++) if (String(data[i][cId]).trim() === f.student_id) { r = i; break; }
    if (r < 0 && f.email) for (var j = 1; j < data.length; j++) if (!String(data[j][cId]).trim() && String(data[j][cEm]).trim().toLowerCase() === f.email.toLowerCase()) { r = j; break; }
    if (r < 0) return;
    var v = data[r], R = r + 1, ch = false;
    var want = { 'Course (website)': f.course, 'Total Fee (PKR)': f.fee_total === null ? '' : f.fee_total, 'Paid (PKR)': f.amount_paid, 'Balance (PKR)': f.balance_due === null ? '' : f.balance_due,
      'Installments': f.installments, 'Next Due Date': pkDate_(f.next_due_date, tz), 'Next Due Amount (PKR)': f.next_due_amount || '', 'Payment Status': f.payment_status };
    Object.keys(want).forEach(function (h) { if (put_(sh, R, C[h], v[C[h]], want[h], log, h, tz)) ch = true; });
    if (cInv >= 0 && f.invoice_no && !String(v[cInv]).trim()) ch = put_(sh, R, cInv, '', f.invoice_no, log, 'Invoice No', tz) || ch;
    if (ch && !FEES_DRY_RUN) sh.getRange(R, C['Last Updated (website)'] + 1).setValue(new Date());
  });
}

function syncFinanceStudents_(ss, rows, log) {
  var tz = ss.getSpreadsheetTimeZone(), sh = ss.getSheetByName('Students & Fees');
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  var c = { id: col_(head, /^Enrollment ID$/i), name: col_(head, /^Student$/i), course: col_(head, /^Course$/i), reg: col_(head, /^Registered$/i), status: col_(head, /^Status$/i), fee: col_(head, /^Total Fee$/i), due: col_(head, /^Next Due Date$/i) };
  if (Object.keys(c).some(function (k) { return c[k] < 0; })) throw new Error('Students & Fees: a heading was renamed; not writing.');
  var n = Math.max(sh.getLastRow(), 2), rg = sh.getRange(1, 1, n, head.length), vals = rg.getValues(), forms = rg.getFormulas();
  rows.forEach(function (f) {
    var r = -1;
    for (var i = 1; i < vals.length; i++) if (String(vals[i][c.id]).trim() === f.student_id) { r = i; break; }
    if (r < 0) { r = freeRow_(vals, head); if (!forms[r]) forms[r] = head.map(function () { return ''; }); log.push('Students & Fees: row ' + (r + 1) + ' used for ' + f.student_id); }
    var R = r + 1, st = f.status ? f.status.charAt(0).toUpperCase() + f.status.slice(1) : '';
    // Student name: filled only when empty (staff may have tidied the spelling in the tracker).
    if (!String(vals[r][c.name]).trim()) put_(sh, R, c.name, '', f.name, log, 'Student', tz, forms[r][c.name]);
    [[c.id, f.student_id, 'Enrollment ID'], [c.course, f.course, 'Course'], [c.reg, pkDate_(f.registered, tz), 'Registered'], [c.status, st, 'Status'],
     [c.fee, f.fee_total === null ? '' : f.fee_total, 'Total Fee'], [c.due, pkDate_(f.next_due_date, tz), 'Next Due Date']].forEach(function (w) {
      if (put_(sh, R, w[0], vals[r][w[0]], w[1], log, w[2], tz, forms[r][w[0]])) vals[r][w[0]] = w[1];
    });
  });
}

/** Lists manual Payments rows the sync can't match (no Invoice No) and website payments missing from the tab. Writes nothing. */
function reconcilePayments() {
  var feed = call_({ action: 'fees_feed' }), out = reconcile_(SpreadsheetApp.openById(FINANCE_ID), feed.rows || []);
  console.log(out.lines.join('\n') || 'Payments tab and website match.');
  return out;
}
function reconcile_(ss, rows) {
  var sh = ss.getSheetByName('Payments'), head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  var cId = col_(head, /^Enrollment ID$/i), cInv = col_(head, /^Invoice No/i), cAmt = col_(head, /^Amount$/i);
  var vals = sh.getRange(1, 1, Math.max(sh.getLastRow(), 2), head.length).getValues(), lines = [], have = {}, noInv = 0, known = {};
  rows.forEach(function (f) { (f.payments || []).forEach(function (p) { if (p.invoice_no) known[p.invoice_no] = { id: f.student_id, amount: p.amount }; }); });
  for (var i = 1; i < vals.length; i++) {
    var id = String(vals[i][cId]).trim(), inv = String(vals[i][cInv]).trim();
    if (!id && !inv) continue;
    if (!inv) { noInv++; lines.push('Row ' + (i + 1) + ': ' + id + ' PKR ' + vals[i][cAmt] + ' has no Invoice No. Add the receipt number (INV-…) or the sync would add it again.'); continue; }
    if (have[inv]) lines.push('Row ' + (i + 1) + ': ' + inv + ' appears twice (also row ' + have[inv] + ').');
    have[inv] = i + 1;
    if (!known[inv]) lines.push('Row ' + (i + 1) + ': ' + inv + ' is not a website payment (kept as it is).');
    else if (Number(vals[i][cAmt]) !== known[inv].amount) lines.push('Row ' + (i + 1) + ': ' + inv + ' amount ' + vals[i][cAmt] + ' -> website ' + known[inv].amount + ' (will be updated).');
  }
  Object.keys(known).forEach(function (inv) { if (!have[inv] && FEES_TEST_IDS.indexOf(known[inv].id) < 0) lines.push(inv + ' (' + known[inv].id + ') is missing and will be added.'); });
  return { lines: lines, unmatched: noInv };
}

function syncFinancePayments_(ss, rows, log) {
  var tz = ss.getSpreadsheetTimeZone(), sh = ss.getSheetByName('Payments');
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  var c = { date: col_(head, /^Date$/i), id: col_(head, /^Enrollment ID$/i), no: col_(head, /^Installment/i), amt: col_(head, /^Amount$/i), meth: col_(head, /^Method$/i), inv: col_(head, /^Invoice No/i), proof: col_(head, /^Proof$/i), notes: col_(head, /^Notes$/i) };
  if (Object.keys(c).some(function (k) { return c[k] < 0; })) throw new Error('Payments: a heading was renamed; not writing.');
  var n = Math.max(sh.getLastRow(), 2), rg = sh.getRange(1, 1, n, head.length), vals = rg.getValues(), forms = rg.getFormulas();
  var blocked = reconcile_(ss, rows).unmatched > 0;
  if (blocked) log.push('Payments: a manual row has no Invoice No, so no new payment rows are added (run reconcilePayments).');
  rows.forEach(function (f) {
    (f.payments || []).forEach(function (p) {
      if (!p.invoice_no) return;
      var r = -1;
      for (var i = 1; i < vals.length; i++) if (String(vals[i][c.inv]).trim() === p.invoice_no) { r = i; break; }
      if (r < 0) { if (blocked) return; r = freeRow_(vals, head); if (!forms[r]) forms[r] = head.map(function () { return ''; }); log.push('Payments: row ' + (r + 1) + ' used for ' + p.invoice_no); }
      var R = r + 1, note = p.voided ? 'VOID' : (p.label || '') + (p.revision ? ' · Revised receipt' : '');
      [[c.date, pkDate_(p.date, tz), 'Date'], [c.id, f.student_id, 'Enrollment ID'], [c.no, p.installment_no, 'Installment #'], [c.amt, p.amount, 'Amount'], [c.meth, PAY_METHODS[p.method] || '', 'Method'], [c.inv, p.invoice_no, 'Invoice No']].forEach(function (w) {
        if (w[0] === c.meth && !w[1]) return; // never blank out a method someone typed in
        if (put_(sh, R, w[0], vals[r][w[0]], w[1], log, w[2], tz, forms[r][w[0]])) vals[r][w[0]] = w[1];
      });
      // Notes: only written when empty, or to mark a void, so your own notes stay
      var oldNote = String(vals[r][c.notes] || '');
      if (!oldNote && note) put_(sh, R, c.notes, '', note, log, 'Notes', tz, forms[r][c.notes]);
      else if (p.voided && oldNote.indexOf('VOID') !== 0) put_(sh, R, c.notes, oldNote, 'VOID · ' + oldNote, log, 'Notes', tz, forms[r][c.notes]);
      if (p.proof_url && /^https:\/\//.test(p.proof_url) && !forms[r][c.proof] && !String(vals[r][c.proof]).trim()) { putLink_(sh, R, c.proof, p.proof_url, log, 'Proof'); vals[r][c.proof] = 'View proof'; }
    });
  });
}
