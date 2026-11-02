/**
 * DFA Mock Exam Leads – fast sync (Google Apps Script, bound to the sheet "DFA Mock Exam Leads").
 * Replaces the slow IMPORTDATA formula (Google refreshes it ~hourly) with a 1-minute timer.
 *
 * One-time install (owner account):
 *   Sheet > Extensions > Apps Script > paste this file > Save > choose function "setup" > Run > Allow.
 * setup() reads the private CSV link from the IMPORTDATA formula in Leads!A2, stores it in
 * Script Properties (not in code), writes the data once, and adds a trigger that syncs every minute.
 * Each sync rewrites rows 2+ from the database, so columns stay the same and rows never duplicate.
 * Menu "DFA Leads > Sync now" forces an immediate refresh.
 */
var TAB = 'Leads';

function setup() {
  var sh = SpreadsheetApp.getActive().getSheetByName(TAB);
  var f = sh.getRange('A2').getFormula();
  var m = f && f.match(/IMPORTDATA\("([^"]+)"\)/i);
  var props = PropertiesService.getScriptProperties();
  if (m) props.setProperty('CSV_URL', m[1]);
  if (!props.getProperty('CSV_URL')) throw new Error('No IMPORTDATA link found in Leads!A2 and none saved before.');
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'syncLeads') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('syncLeads').timeBased().everyMinutes(1).create();
  syncLeads();
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('DFA Leads').addItem('Sync now', 'syncLeads').addToUi();
}

function syncLeads() {
  var url = PropertiesService.getScriptProperties().getProperty('CSV_URL');
  if (!url) return;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return; // keep the old rows on any error
    var rows = Utilities.parseCsv(res.getContentText('UTF-8')).filter(function (r) { return r.join('') !== ''; });
    var sh = SpreadsheetApp.getActive().getSheetByName(TAB);
    var w = rows.reduce(function (a, r) { return Math.max(a, r.length); }, 1);
    rows = rows.map(function (r) { while (r.length < w) r.push(''); return r; });
    var oldLast = sh.getLastRow();
    if (rows.length) {
      if (sh.getMaxColumns() < w) sh.insertColumnsAfter(sh.getMaxColumns(), w - sh.getMaxColumns());
      if (sh.getMaxRows() < rows.length + 1) sh.insertRowsAfter(sh.getMaxRows(), rows.length + 1 - sh.getMaxRows());
      sh.getRange(2, 1, rows.length, w).setNumberFormat('@').setValues(rows); // plain text: phones/IDs keep leading +/0
    }
    var lastCol = Math.max(sh.getLastColumn(), w);
    if (oldLast > rows.length + 1) sh.getRange(rows.length + 2, 1, oldLast - rows.length - 1, lastCol).clearContent();
  } finally { lock.releaseLock(); }
}
