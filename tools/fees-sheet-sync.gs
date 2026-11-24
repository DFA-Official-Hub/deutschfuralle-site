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
 *      is never written; Proof (H) is only filled when empty. A voided payment gets Amount 0 and "VOID: reason" in Notes.
 *
 * Setup (once): paste this file, Save, choose installFeesSync and Run (Allow). Optional instant updates:
 * Deploy > New deployment > Web app (Execute as: me, Who has access: Anyone), copy the /exec URL and
 * save it in Supabase as the secret FEES_SYNC_URL. The web app only starts a sync; it reads nothing from the request.
 * Runs as the owner of this script (no service account, no sharing changes).
 */
var FINANCE_ID = '1ZIRuuIGrRlBw4Qa24LYWcCGlpnNoPmSdD7PL6jEFFDw';
var FEES_TEST_IDS = ['DFA-2026-0001', 'DFA-2026-0002']; // test entries, never written to the sheets
var REG_FEE_COLS = ['Course (website)', 'Total Fee (PKR)', 'Paid (PKR)', 'Balance (PKR)', 'Installments', 'Next Due Date', 'Next Due Amount (PKR)', 'Payment Status', 'Last Updated (website)'];

function installFeesSync() {
  var have = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  if (have.indexOf('syncFees') < 0) ScriptApp.newTrigger('syncFees').timeBased().everyMinutes(10).create();
  syncFees();
}
function doPost() { syncFees(); return ContentService.createTextOutput('ok'); }

function syncFees() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    var feed = call_({ action: 'fees_feed' });
    var rows = (feed.rows || []).filter(function (r) { return r.student_id && FEES_TEST_IDS.indexOf(r.student_id) < 0; });
    var log = [];
    syncRegistration_(rows, log);
    syncFinanceStudents_(rows, log);
    syncFinancePayments_(rows, log);
    if (log.length) console.log(log.join('\n'));
  } finally { lock.releaseLock(); }
}

function pkDate_(iso) { if (!iso) return ''; var p = String(iso).slice(0, 10).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
function same_(a, b) {
  if (a instanceof Date && b instanceof Date) return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  return String(a === null || a === undefined ? '' : a) === String(b === null || b === undefined ? '' : b);
}
function col_(head, re) { for (var i = 0; i < head.length; i++) if (re.test(String(head[i]).trim())) return i; return -1; }
/** Writes one cell only when the value changed; records old -> new. */
function put_(sh, r, c, oldV, newV, log, what) {
  if (same_(oldV, newV)) return false;
  sh.getRange(r, c + 1).setValue(newV);
  log.push(sh.getName() + '!' + sh.getRange(r, c + 1).getA1Notation() + ' (' + what + '): ' + (oldV instanceof Date ? Utilities.formatDate(oldV, 'Asia/Karachi', 'yyyy-MM-dd') : oldV) + ' -> ' + (newV instanceof Date ? Utilities.formatDate(newV, 'Asia/Karachi', 'yyyy-MM-dd') : newV));
  return true;
}

function syncRegistration_(rows, log) {
  var sh = SpreadsheetApp.openById(RESPONSES_SHEET_ID).getSheetByName('Form Responses 1');
  var lastCol = sh.getLastColumn(), head = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  // add any missing website column at the far right (never between form columns)
  REG_FEE_COLS.forEach(function (h) { if (head.indexOf(h) < 0) { sh.getRange(1, head.length + 1).setValue(h); head.push(h); } });
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
      'Installments': f.installments, 'Next Due Date': pkDate_(f.next_due_date), 'Next Due Amount (PKR)': f.next_due_amount || '', 'Payment Status': f.payment_status };
    Object.keys(want).forEach(function (h) { if (put_(sh, R, C[h], v[C[h]], want[h], log, h)) ch = true; });
    if (cInv >= 0 && f.invoice_no && !String(v[cInv]).trim()) ch = put_(sh, R, cInv, '', f.invoice_no, log, 'Invoice No') || ch;
    if (ch) sh.getRange(R, C['Last Updated (website)'] + 1).setValue(new Date());
  });
}

function syncFinanceStudents_(rows, log) {
  var sh = SpreadsheetApp.openById(FINANCE_ID).getSheetByName('Students & Fees');
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  var c = { id: col_(head, /^Enrollment ID$/i), name: col_(head, /^Student$/i), course: col_(head, /^Course$/i), reg: col_(head, /^Registered$/i), status: col_(head, /^Status$/i), fee: col_(head, /^Total Fee$/i), due: col_(head, /^Next Due Date$/i) };
  if (Object.keys(c).some(function (k) { return c[k] < 0; })) throw new Error('Students & Fees: a heading was renamed; not writing.');
  var n = Math.max(sh.getLastRow(), 2), vals = sh.getRange(1, 1, n, head.length).getValues(), forms = sh.getRange(1, 1, n, head.length).getFormulas();
  rows.forEach(function (f) {
    var r = -1;
    for (var i = 1; i < vals.length; i++) if (String(vals[i][c.id]).trim() === f.student_id) { r = i; break; }
    if (r < 0) { for (var j = 1; j < vals.length; j++) if (!String(vals[j][c.id]).trim() && !forms[j][c.id]) { r = j; break; } if (r < 0) { r = vals.length; vals.push(head.map(function () { return ''; })); forms.push(head.map(function () { return ''; })); } }
    var R = r + 1, st = f.status ? f.status.charAt(0).toUpperCase() + f.status.slice(1) : '';
    var want = [[c.id, f.student_id, 'Enrollment ID'], [c.name, f.name, 'Student'], [c.course, f.course, 'Course'], [c.reg, pkDate_(f.registered), 'Registered'], [c.status, st, 'Status'], [c.fee, f.fee_total === null ? '' : f.fee_total, 'Total Fee'], [c.due, pkDate_(f.next_due_date), 'Next Due Date']];
    want.forEach(function (w) { if (forms[r] && forms[r][w[0]]) return; /* never overwrite a formula */ put_(sh, R, w[0], vals[r][w[0]], w[1], log, w[2]); vals[r][w[0]] = w[1]; });
  });
}

function syncFinancePayments_(rows, log) {
  var sh = SpreadsheetApp.openById(FINANCE_ID).getSheetByName('Payments');
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  var c = { date: col_(head, /^Date$/i), id: col_(head, /^Enrollment ID$/i), no: col_(head, /^Installment/i), amt: col_(head, /^Amount$/i), meth: col_(head, /^Method$/i), inv: col_(head, /^Invoice No/i), proof: col_(head, /^Proof$/i), notes: col_(head, /^Notes$/i) };
  if (Object.keys(c).some(function (k) { return c[k] < 0; })) throw new Error('Payments: a heading was renamed; not writing.');
  var n = Math.max(sh.getLastRow(), 2), vals = sh.getRange(1, 1, n, head.length).getValues(), forms = sh.getRange(1, 1, n, head.length).getFormulas();
  var METHODS = { cash: 'Cash', bank: 'Bank transfer', jazzcash: 'JazzCash', easypaisa: 'Easypaisa', other: 'Other' };
  rows.forEach(function (f) {
    (f.payments || []).forEach(function (p) {
      if (!p.invoice_no) return;
      var r = -1;
      for (var i = 1; i < vals.length; i++) if (String(vals[i][c.inv]).trim() === p.invoice_no) { r = i; break; }
      if (r < 0) { for (var j = 1; j < vals.length; j++) if (!String(vals[j][c.id]).trim() && !String(vals[j][c.inv]).trim()) { r = j; break; } if (r < 0) { r = vals.length; vals.push(head.map(function () { return ''; })); forms.push(head.map(function () { return ''; })); } }
      var R = r + 1, note = p.voided ? 'VOID' : (p.label || '') + (p.revision ? ' · Revised receipt' : '');
      var want = [[c.date, pkDate_(p.date), 'Date'], [c.id, f.student_id, 'Enrollment ID'], [c.no, p.installment_no, 'Installment #'], [c.amt, p.amount, 'Amount'], [c.meth, METHODS[p.method] || '', 'Method'], [c.inv, p.invoice_no, 'Invoice No']];
      want.forEach(function (w) { if (forms[r] && forms[r][w[0]]) return; put_(sh, R, w[0], vals[r][w[0]], w[1], log, w[2]); vals[r][w[0]] = w[1]; });
      // Notes: only written on new rows or for voids, so your own notes stay
      var oldNote = String(vals[r][c.notes] || '');
      if (!oldNote || (p.voided && oldNote.indexOf('VOID') !== 0)) put_(sh, R, c.notes, oldNote, p.voided ? ('VOID' + (oldNote ? ' · ' + oldNote : '')) : note, log, 'Notes');
      if (p.proof_url && /^https:\/\//.test(p.proof_url) && !forms[r][c.proof] && !String(vals[r][c.proof]).trim()) put_(sh, R, c.proof, '', '=HYPERLINK("' + p.proof_url.replace(/"/g, '') + '","View proof")', log, 'Proof');
    });
  });
}
