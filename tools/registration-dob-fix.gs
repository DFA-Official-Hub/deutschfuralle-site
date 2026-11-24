/**
 * FIX for the date-of-birth shift. Replace the whole old detailRow_ function in the website automation
 * Apps Script ("DFA Website Data" sheet > Extensions > Apps Script) with the code below. If detailRow_ exists in
 * more than one file of that project (for example Code.gs and addDocs.gs), replace it in every file.
 *
 * Why: getValues() returns a Date at midnight in the SPREADSHEET's time zone. The old code formatted it with a
 * hard-coded 'Asia/Karachi', so when the zones differ midnight lands on the previous day:
 * 11 Feb 1995 was sent to the website as 10 February 1995 (all 100 synced dates were one day early).
 * Now the date is formatted in the spreadsheet's own time zone and sent as an unambiguous ISO date (1995-02-11).
 * The website prints it as "11 February 1995".
 *
 * The spreadsheet time zone is read once per run (not once per row) and cached in DFA_SHEET_TZ_.
 */
var DFA_SHEET_TZ_ = null;
function sheetTz_() {
  if (!DFA_SHEET_TZ_) DFA_SHEET_TZ_ = SpreadsheetApp.openById(RESPONSES_SHEET_ID).getSpreadsheetTimeZone();
  return DFA_SHEET_TZ_;
}
function detailRow_(head, row) {
  var data = {}, tz = sheetTz_();
  head.forEach(function (h, i) {
    if (!DETAIL_FIELDS.some(function (re) { return re.test(String(h).trim()); })) return;
    var v = row[i];
    if (v instanceof Date) v = Utilities.formatDate(v, tz, 'yyyy-MM-dd');
    data[String(h).trim()] = String(v === null || v === undefined ? '' : v).trim();
  });
  return data;
}
