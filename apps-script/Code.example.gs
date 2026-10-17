// Rascal Co orders -> Google Sheet, with the PayNow screenshot saved to Google Drive.
// PUBLIC EXAMPLE COPY: fill in SPREADSHEET_ID and NOTIFY_EMAIL below before using it.
// Keep the real values only inside Apps Script, never in the repository.
// Paste this into Extensions > Apps Script inside the Google Sheet that holds your orders.

var VERSION = 'v6'; // shown on the web app page and at the bottom of each order email
// Which Google Sheet to write to. Leave '' when this script was opened from the Sheet itself
// (Extensions > Apps Script). Otherwise paste the Sheet's ID: the long part of its address
// between /d/ and /edit, e.g. https://docs.google.com/spreadsheets/d/THIS_PART/edit
var SPREADSHEET_ID = 'PASTE_YOUR_SHEET_ID_HERE';
var SHEET_NAME = 'Orders';
var FOLDER_NAME = 'Rascal Co Payment Screenshots';
var NOTIFY_EMAIL = 'you@example.com'; // leave '' to turn off the email for each new order
var PRICE = 26;
var DELIVERY_FEE = 15;
var FREE_DELIVERY_OVER = 90; // delivery is free when the boxes alone come to more than this
var MAX_BOXES = 20;
var MAX_SHOT_CHARS = 8000000; // roughly 6 MB of image data
var MAX_THUMB_CHARS = 400000; // the small preview the website sends for the in-cell picture
var HEADERS = ['Received', 'Reference', 'Name', 'Phone', 'Contact via', 'Telegram', 'Boxes',
  'Fulfilment', 'Date', 'Time slot', 'Address', 'Notes', 'Total (S$)', 'Paid', 'Done',
  'Payment screenshot', 'Screenshot preview'];
var PREVIEW_COL = 17;
var LINK_COL = 16;
var PREVIEW_ROW_HEIGHT = 120; // rows with a picture get this tall, in pixels
var PREVIEW_COL_WIDTH = 100;

function doPost(e) {
  var out = { ok: false };
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var d = JSON.parse(e.postData.contents);
    var problem = check_(d);
    if (problem) {
      out.error = problem;
      console.warn('Order refused: ' + problem);
    } else {
      var sh = getSheet_();
      // Find the last order by looking only at the Reference column, so checkboxes or
      // formatting further down the sheet never push new orders out of sight.
      var refs = sh.getRange(1, 2, sh.getMaxRows(), 1).getValues();
      var lastUsed = 1, seen = false;
      for (var i = 1; i < refs.length; i++) {
        if (refs[i][0] !== '') {
          lastUsed = i + 1;
          if (String(refs[i][0]) === d.ref) seen = true;
        }
      }
      if (!seen) {
        applyCutoff_(d);
        var total = orderTotal_(d);
        var shot = saveShot_(d);
        var row = [
          new Date(), d.ref, safe_(d.name), safe_('+65 ' + d.phone), d.contact, safe_(d.telegram),
          d.qty, d.fulfil === 'deliver' ? 'Delivery' : 'Self-collection', d.date, safe_(d.slot),
          safe_(d.address), safe_(d.notes), total, false, false,
          shot ? '=HYPERLINK("' + shot.url + '","View screenshot")' : ''
        ];
        var r = lastUsed + 1;
        if (r > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 20);
        sh.getRange(r, 1, 1, row.length).setValues([row]);
        sh.getRange(r, 1).setNumberFormat('d mmm yyyy, h:mm am/pm');
        sh.getRange(r, 14, 1, 2).insertCheckboxes();
        if (shot) placeImage_(sh, r, d.thumb || d.shot, d.thumb ? dataUrlBlob_(d.thumb, d.ref + '-preview') : shot.blob);
        notify_(d, total, shot);
        console.log('Saved ' + d.ref + ' to "' + sh.getParent().getName() + '" > tab "' + sh.getName() + '", row ' + r);
      }
      if (seen) console.log('Skipped ' + d.ref + ': already in the sheet');
      out.ok = true;
      out.date = d.date;
    }
  } catch (x) {
    out.error = String(x);
    console.error('Order failed: ' + (x && x.stack ? x.stack : x));
  } finally {
    try { lock.releaseLock(); } catch (y) {}
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

// Orders close on Friday at 6pm (Singapore time) for that Sunday. This uses Google's clock, so an
// order sent from a page left open past the cut-off is still saved (the customer may already have
// paid) but moved to the next open Sunday, with a note in the Notes column.
function applyCutoff_(d) {
  var CUTOFF_DAY = 5, CUTOFF_HOUR = 18; // Friday, 6pm
  var now = new Date();
  var ymd = Utilities.formatDate(now, 'Asia/Singapore', 'yyyy-MM-dd').split('-').map(Number);
  var hour = Number(Utilities.formatDate(now, 'Asia/Singapore', 'H'));
  var t = new Date(Date.UTC(ymd[0], ymd[1] - 1, ymd[2]));
  var dow = t.getUTCDay();
  var add = dow === 0 ? 7 : 7 - dow;
  if ((dow === CUTOFF_DAY && hour >= CUTOFF_HOUR) || dow === 6) add += 7;
  t.setUTCDate(t.getUTCDate() + add);
  var open = Utilities.formatDate(t, 'UTC', 'yyyy-MM-dd');
  var asked = /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? d.date : '';
  if (!asked || asked < open) {
    if (asked) {
      var p = asked.split('-').map(Number);
      var label = Utilities.formatDate(new Date(Date.UTC(p[0], p[1] - 1, p[2])), 'UTC', 'EEE d MMM');
      d.notes = ('[Moved from ' + label + ': ordered after the Friday 6pm cut-off] ' + (d.notes || '')).slice(0, 500);
    }
    d.date = open;
    console.log('Order ' + d.ref + ' moved to ' + open + ' (cut-off passed)');
  }
}

function orderTotal_(d) {
  var boxes = d.qty * PRICE;
  var fee = d.fulfil === 'deliver' && boxes <= FREE_DELIVERY_OVER ? DELIVERY_FEE : 0;
  return boxes + fee;
}

function doGet() {
  return ContentService.createTextOutput('Rascal Co order endpoint ' + VERSION + ' is running (screenshots, picture inside the cell, inline email image, free delivery over S$90).');
}

function check_(d) {
  if (!d || typeof d !== 'object') return 'Bad request';
  if (!/^RC-\d{4}-[A-Z0-9]{4}$/.test(String(d.ref))) return 'Bad reference';
  if (!d.name || String(d.name).length > 100) return 'Bad name';
  if (!/^[3689]\d{7}$/.test(String(d.phone))) return 'Bad phone';
  if (['WhatsApp', 'Telegram'].indexOf(d.contact) === -1) return 'Bad contact method';
  if (d.contact === 'Telegram' && !/^@?[A-Za-z][A-Za-z0-9_]{3,30}[A-Za-z0-9]$/.test(String(d.telegram || ''))) return 'Bad Telegram username';
  var q = Number(d.qty);
  if (!(q >= 1 && q <= MAX_BOXES && q === Math.floor(q))) return 'Bad quantity';
  d.qty = q;
  if (['collect', 'deliver'].indexOf(d.fulfil) === -1) return 'Bad fulfilment';
  if (d.fulfil === 'deliver' && !String(d.address || '').trim()) return 'Address needed';
  if (!d.slot) return 'Time slot needed';
  if (d.shot && (typeof d.shot !== 'string' || d.shot.length > MAX_SHOT_CHARS)) return 'Screenshot too large';
  if (d.thumb && (typeof d.thumb !== 'string' || d.thumb.length > MAX_THUMB_CHARS || !/^data:image\/(jpeg|png);base64,[A-Za-z0-9+\/=]+$/.test(d.thumb))) d.thumb = '';
  ['telegram', 'address', 'notes', 'slot', 'date'].forEach(function (k) {
    d[k] = String(d[k] || '').slice(0, 500);
  });
  return '';
}

// Saves the screenshot to a Drive folder that stays private to your account.
function saveShot_(d) {
  if (!d.shot) return null;
  var m = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+\/=]+)$/.exec(d.shot);
  if (!m) return null;
  var ext = m[1] === 'jpeg' ? 'jpg' : 'png';
  var blob = Utilities.newBlob(Utilities.base64Decode(m[2]), 'image/' + m[1], d.ref + '.' + ext);
  var file = getFolder_().createFile(blob);
  return { url: file.getUrl(), blob: blob };
}

function getFolder_() {
  var it = DriveApp.getFoldersByName(FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
}

// Stops text that starts with = + - @ from being treated as a formula.
function safe_(v) {
  var s = String(v == null ? '' : v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

// Accepts either the bare Sheet ID or the whole Sheet address pasted into SPREADSHEET_ID.
function sheetId_() {
  var s = String(SPREADSHEET_ID || '').trim();
  var m = /\/d\/([A-Za-z0-9_-]+)/.exec(s);
  return m ? m[1] : s.split(/[\/?#]/)[0];
}

function getSheet_() {
  var ss = sheetId_() ? SpreadsheetApp.openById(sheetId_()) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('This script is not attached to a Google Sheet. Paste the Sheet ID into SPREADSHEET_ID at the top.');
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) {
    sh.appendRow(HEADERS);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  } else {
    // An Orders tab from an earlier version: fill in any column headings it is missing.
    for (var c = 1; c <= HEADERS.length; c++) {
      if (!sh.getRange(1, c).getValue()) sh.getRange(1, c).setValue(HEADERS[c - 1]).setFontWeight('bold');
    }
  }
  return sh;
}

// Shows the screenshot in the order's row.
// First choice: a picture INSIDE the "Screenshot preview" cell, which moves with its row when you
// sort or filter. The script checks that Google really shows it. If not, it falls back to a
// picture placed over the cell (as in version 5). Either way the order, the "View screenshot"
// link and the email are kept, and Executions says which method was used.
function placeImage_(sh, row, dataUrl, blob) {
  var cell = sh.getRange(row, PREVIEW_COL);
  try {
    var img = SpreadsheetApp.newCellImage().setSourceUrl(dataUrl).setAltTextTitle('Payment screenshot').build();
    cell.setValue(img);
    SpreadsheetApp.flush();
    var back = cell.getValue();
    var shown = back && typeof back.getContentUrl === 'function' && back.getContentUrl();
    if (shown) {
      sh.setRowHeight(row, PREVIEW_ROW_HEIGHT);
      if (sh.getColumnWidth(PREVIEW_COL) < PREVIEW_COL_WIDTH) sh.setColumnWidth(PREVIEW_COL, PREVIEW_COL_WIDTH);
      console.log('Row ' + row + ': picture placed inside the cell');
      return 'cell';
    }
    cell.clearContent();
    console.warn('Row ' + row + ': Google did not show the in-cell picture, using a picture over the cell instead');
  } catch (err) {
    try { cell.clearContent(); } catch (e) {}
    console.warn('Row ' + row + ': in-cell picture refused (' + err + '), using a picture over the cell instead');
  }
  if (!blob) return '';
  try {
    var over = sh.insertImage(blob, PREVIEW_COL, row);
    var w = over.getWidth(), h = over.getHeight();
    var nw = 110, nh = Math.round(h * nw / w);
    if (nh > 240) { nh = 240; nw = Math.round(w * nh / h); }
    over.setWidth(nw).setHeight(nh);
    sh.setRowHeight(row, nh + 8);
    if (sh.getColumnWidth(PREVIEW_COL) < 140) sh.setColumnWidth(PREVIEW_COL, 140);
    console.log('Row ' + row + ': picture placed over the cell');
    return 'over';
  } catch (err2) {
    console.warn('Row ' + row + ': no preview picture (' + err2 + '). The "View screenshot" link still works.');
    return '';
  }
}

function dataUrlBlob_(dataUrl, name) {
  var m = /^data:(image\/(jpeg|png));base64,([A-Za-z0-9+\/=]+)$/.exec(dataUrl || '');
  return m ? Utilities.newBlob(Utilities.base64Decode(m[3]), m[1], name + (m[2] === 'png' ? '.png' : '.jpg')) : null;
}

function blobToDataUrl_(blob) {
  return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
}

// ONE-OFF TIDY-UP for orders saved by earlier versions.
// In the Apps Script editor, pick fixFloatingImages in the function list and press Run.
// For every order row it puts the screenshot inside its own cell (using the copy in Drive),
// then deletes the old floating pictures. Safe to run more than once.
function fixFloatingImages() {
  var sh = getSheet_();
  var last = sh.getLastRow();
  var placed = 0, skipped = 0;
  if (last >= 2) {
    var refs = sh.getRange(2, 2, last - 1, 1).getValues();
    var links = sh.getRange(2, LINK_COL, last - 1, 1).getFormulas();
    var current = sh.getRange(2, PREVIEW_COL, last - 1, 1).getValues();
    for (var i = 0; i < refs.length; i++) {
      var r = i + 2;
      if (!refs[i][0]) continue;
      if (current[i][0] && typeof current[i][0] === 'object') continue; // already inside the cell
      var m = /\/d\/([A-Za-z0-9_-]+)/.exec(links[i][0]) || /id=([A-Za-z0-9_-]+)/.exec(links[i][0]);
      if (!m) { skipped++; continue; }
      try {
        var file = DriveApp.getFileById(m[1]);
        var blob = file.getThumbnail() || file.getBlob(); // a small preview is lighter for the Sheet
        if (placeImage_(sh, r, blobToDataUrl_(blob), null) === 'cell') placed++; else skipped++;
      } catch (err) { skipped++; }
    }
  }
  var removed = 0;
  if (placed > 0) sh.getImages().forEach(function (im) { im.remove(); removed++; }); // only if in-cell pictures work here
  var msg = 'Pictures placed inside cells: ' + placed + '. Rows skipped: ' + skipped +
    ' (their "View screenshot" link still works). Old floating pictures removed: ' + removed + '.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

function esc_(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function notify_(d, total, shot) {
  if (!NOTIFY_EMAIL) return;
  var body = [
    'Reference: ' + d.ref,
    'Name: ' + d.name,
    'Phone: +65 ' + d.phone,
    'Contact via: ' + d.contact + (d.telegram ? ' (' + d.telegram + ')' : ''),
    'Boxes: ' + d.qty,
    (d.fulfil === 'deliver' ? 'Delivery' : 'Self-collection') + ': ' + d.date + ', ' + d.slot,
    d.fulfil === 'deliver' ? 'Address: ' + d.address : '',
    d.notes ? 'Notes: ' + d.notes : '',
    'Total to receive: S$' + total,
    shot ? 'Payment screenshot attached (also saved in Drive: ' + shot.url + ')' : 'No payment screenshot'
  ].filter(String).join('\n');
  var lines = [
    ['Reference', d.ref],
    ['Name', d.name],
    ['Phone', '+65 ' + d.phone],
    ['Contact via', d.contact + (d.telegram ? ' (' + d.telegram + ')' : '')],
    ['Boxes', d.qty],
    [d.fulfil === 'deliver' ? 'Delivery' : 'Self-collection', d.date + ', ' + d.slot],
    d.fulfil === 'deliver' ? ['Address', d.address] : null,
    d.notes ? ['Notes', d.notes] : null,
    ['Total to receive', 'S$' + total]
  ].filter(Boolean);
  var html = '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">' +
    lines.map(function (l) { return '<div><b>' + esc_(l[0]) + ':</b> ' + esc_(l[1]) + '</div>'; }).join('') +
    (shot
      ? '<p><b>Payment screenshot</b></p><img src="cid:shot" alt="Payment screenshot" style="max-width:420px;border:1px solid #ddd">' +
        '<p><a href="' + esc_(shot.url) + '">Open in Drive</a></p>'
      : '<p>No payment screenshot</p>') +
    '<p style="color:#999;font-size:11px">Order script ' + esc_(VERSION) + '</p></div>';
  var opts = { htmlBody: html };
  if (shot) {
    opts.inlineImages = { shot: shot.blob };
    opts.attachments = [shot.blob];
  }
  MailApp.sendEmail(NOTIFY_EMAIL, 'New Rascal Co order ' + d.ref + ' (S$' + total + ')', body, opts);
}

// TEST BUTTON: pick testOrder in the function list at the top of the editor and press Run.
// It sends a fake order through the same steps as the website and shows the result in the
// Execution log, including the reason if the order is refused. It adds a row with the
// reference RC-0000-TEST (delete it afterwards). Run it once more and it is skipped as a duplicate.
function testOrder() {
  var px = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  var fake = {
    ref: 'RC-0000-TEST', name: 'Test Order', phone: '81234567', contact: 'WhatsApp', telegram: '',
    qty: 1, fulfil: 'collect', date: '2026-10-18', slot: '10am to 12pm', address: '', notes: 'Test from the editor',
    total: 26, shot: px, thumb: px
  };
  var res = doPost({ postData: { contents: JSON.stringify(fake) } });
  var ss = sheetId_() ? SpreadsheetApp.openById(sheetId_()) : SpreadsheetApp.getActiveSpreadsheet();
  console.log('Result: ' + res.getContent());
  console.log('Writing to: ' + (ss ? ss.getName() + ' > tab "' + SHEET_NAME + '"' : 'NO SHEET (set SPREADSHEET_ID)'));
}
