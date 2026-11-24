/**
 * FIX for the date-of-birth shift (paste over detailRow_ in the website automation Apps Script).
 *
 * Why: getValues() returns a Date at midnight in the SPREADSHEET's time zone. The old code formatted it with a
 * hard-coded 'Asia/Karachi', so whenever the spreadsheet zone differs, midnight lands on the previous day:
 * 11 Feb 1995 was sent to the website as 10 February 1995 (all 100 synced dates were one day early).
 * Now the date is formatted in the spreadsheet's own time zone and sent as an unambiguous ISO date (1995-02-11).
 * The website prints it as "11 February 1995".
 */
function detailRow_(head, row) {
  var data = {}, tz = SpreadsheetApp.openById(RESPONSES_SHEET_ID).getSpreadsheetTimeZone();
  head.forEach(function (h, i) {
    if (!DETAIL_FIELDS.some(function (re) { return re.test(String(h).trim()); })) return;
    var v = row[i];
    if (v instanceof Date) v = Utilities.formatDate(v, tz, 'yyyy-MM-dd');
    data[String(h).trim()] = String(v === null || v === undefined ? '' : v).trim();
  });
  return data;
}
