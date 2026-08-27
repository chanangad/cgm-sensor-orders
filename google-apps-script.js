function initAuth() {
    // Run once to grant Drive/Sheets permissions
    SpreadsheetApp.openById('1DumLqeIDx8mEy8WbTYar6QPvyIcQy0a-GN3A8T4DUfs');
}

// IDs
var FOLDER_ID = '1xTm7zsVuf6mUCeE5eReJ67SrGeBrtNs6';
var SHEET_ID = '1DumLqeIDx8mEy8WbTYar6QPvyIcQy0a-GN3A8T4DUfs';
var SHEET_NAME = 'Orders';

// Columns of the Orders sheet, in order. Existing sheets are extended in place
// by ensureHeaders_(), so adding a column here is safe.
var HEADERS = [
    'Timestamp', 'Name', 'Parent/Guardian', 'Phone', 'Email',
    'Items Summary', 'Linx Qty', 'VitaTok Qty', 'Patch Qty',
    'Total Sensors', 'Pickup', 'Total Amount', 'Payment Proof URL',
    'Transaction ID', 'Order ID', 'Flags', 'Screenshot Hash', 'Verification', 'Payee'
];
// Columns 7-9 hold per-item quantities. Names match CONFIG.SENSORS in config.js
// so the page can shorten them for display.
var ITEM_COLUMNS = [
    { index: 6, name: 'Linx' },
    { index: 7, name: 'VitaTok' },
    { index: 8, name: 'Linx/VitaTok Patch' }
];
var COL_TRANSACTION_ID = 14;   // 1-based indexes into HEADERS
var COL_ORDER_ID = 15;
var COL_SCREENSHOT_HASH = 17;
var COL_VERIFICATION = 18;
var COL_PAYEE = 19;

// Keep in sync with CONFIG.SENSORS in config.js. Used only to sanity-check the
// amount the browser reports; items with an unknown key are skipped.
var PRICES = { linx: 3025, vitatok: 2925, patch: 30 };

// Guard rails for a public endpoint
var MAX_SUBMISSIONS_PER_MINUTE = 20;
var MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;

// ---- Payment screenshot verification ---------------------------------------
// Reads the uploaded screenshot with Drive's built-in OCR and compares it with
// the order. Findings are written to the 'Verification' column for a human to
// look at — an order is NEVER rejected on the strength of OCR, because someone
// has already paid by the time it runs.
//
// Requires the Advanced Drive Service: in the Apps Script editor, Services ->
// add 'Drive API'. Without it, orders still work and the column reads
// 'OCR UNAVAILABLE'.
var VERIFY_SCREENSHOTS = true;
// The coordinators who may collect payments, keyed exactly as in CONFIG.PAYEES
// in config.js. Each order says which one it was paid to; the name below is what
// must appear on the screenshot. Switching coordinators is a config.js-only
// change — this list only needs editing when the set of volunteers changes.
var PAYEES = {
    anirudh: 'Anirudh Talakanti',
    angad: 'Angad Chandhok',
    beenu: 'Beenu Singh',
    nithin: 'Nithin Somasundar'
};
// Used only for orders that name no payee at all (a browser on a cached copy of
// the old script). Keep it equal to CONFIG.ACTIVE_PAYEE in config.js.
var DEFAULT_PAYEE_KEY = 'anirudh';
// A screenshot dated more than this many days ago is worth a second look.
var SCREENSHOT_MAX_AGE_DAYS = 10;

// Email (display) and cross‑script config (set in Script Properties)
var FROM_NAME = 'Diabuddies of Karnataka';
var REPLY_TO = 'diabuddiesofkarnataka@gmail.com';
var EMAIL_WEBAPP_URL = PropertiesService.getScriptProperties().getProperty('EMAIL_WEBAPP_URL') || 'YOUR_EMAIL_WEBAPP_URL_HERE'; // must be the /exec URL
var EMAIL_TOKEN = PropertiesService.getScriptProperties().getProperty('EMAIL_TOKEN') || ''; // optional shared secret

function doPost(e) {
    try {
        var data = JSON.parse((e && e.postData && e.postData.contents) || '{}');

        if (!data.action && data.orderDetails) data.action = 'submitOrder';

        if (data.action === 'getStatus' || data.action === 'toggleOrders') return handleAdminAction_(data);
        if (data.action === 'getRecentOrders') return getRecentOrders_(data.limit || 10);
        if (data.action === 'getSummary') return getSummary_();
        if (data.action === 'checkOrder') return checkOrder_(data.orderId);
        if (data.action === 'submitOrder') return handleSubmitOrder_(data);

        return handleUpload_(data);
    } catch (err) {
        return json_({ success: false, error: String(err) });
    } finally {
        flushDebugLog_();
    }
}

function handleSubmitOrder_(data) {
    var order = (data && data.orderDetails) || {};
    debugLog_('SUBMIT orderId=' + (order.orderId || 'N/A') +
        ' amount=' + (order.totalAmount || 'N/A') +
        ' screenshot=' + !!(data && data.screenshot));

    if (!ordersEnabled_()) {
        return json_({ success: false, error: 'Orders are currently closed.' });
    }

    // Reject oversized payloads before doing any Drive work (base64 is ~4/3 of bytes)
    if (data && data.screenshot && (String(data.screenshot).length * 3 / 4) > MAX_SCREENSHOT_BYTES) {
        return json_({ success: false, error: 'Payment screenshot is too large.' });
    }

    var lock = LockService.getScriptLock();
    try {
        lock.waitLock(25000);
    } catch (e) {
        return json_({ success: false, error: 'Server is busy — please try again in a moment.' });
    }

    var uploadResult = null;
    var sheetResult = null;
    var earlyResponse = null;
    var sheet = null;
    var screenshotHash = '';
    var duplicateHashRow = 0;

    try {
        sheet = openOrdersSheet_();

        // The same order can arrive twice (retry, or a cross-origin POST that the
        // browser could not read). Record it only once.
        if (sheet && order.orderId && findOrderRow_(sheet, order.orderId)) {
            debugLog_('Duplicate submission ignored: ' + order.orderId);
            earlyResponse = json_({ success: true, duplicate: true, orderId: order.orderId, sheet: { ok: true } });
        } else if (!throttleOk_()) {
            earlyResponse = json_({ success: false, error: 'Too many orders are being placed right now. Please retry in a minute.' });
        } else {
            // Fingerprint the image before it is stored, so the same screenshot
            // being submitted for two orders is obvious. Exact match, no OCR.
            if (data && data.screenshot) {
                screenshotHash = md5Hex_(data.screenshot);
                if (sheet) duplicateHashRow = findValueRow_(sheet, COL_SCREENSHOT_HASH, screenshotHash);
            }
            uploadResult = (data && data.screenshot) ? upl_(data) : null;
            sheetResult = sheet ? appendToSheet_(sheet, order, uploadResult, screenshotHash) : null;
        }
    } catch (e) {
        debugLog_('Submit failed: ' + e);
        earlyResponse = json_({ success: false, error: String(e) });
    } finally {
        lock.releaseLock();
    }

    if (earlyResponse) return earlyResponse;

    // Screenshot verification runs outside the lock: it is slow, it is advisory,
    // and a failure here must never affect an order that is already recorded.
    if (VERIFY_SCREENSHOTS && sheet && sheetResult && sheetResult.row && data && data.screenshot) {
        try {
            verifyScreenshotForRow_(sheet, sheetResult.row, data, order, duplicateHashRow);
        } catch (e) {
            debugLog_('Verification failed: ' + e);
            try { setCell_(sheet, sheetResult.row, COL_VERIFICATION, 'CHECK FAILED (' + e + ')'); } catch (_) { }
        }
    }

    // Confirmation email is best-effort and runs outside the lock
    try {
        if (order.email) sendConfirmationEmail_(order, uploadResult);
    } catch (_) {
        // do not fail the request on email error
    }

    return json_({ success: true, orderId: order.orderId || '', upload: uploadResult, sheet: sheetResult });
}

function ordersEnabled_() {
    // Anything other than an explicit 'true' means closed. Order windows are
    // opened deliberately, so an unset property must never open the form by
    // itself — deploying this script has to be incapable of reopening orders.
    return PropertiesService.getScriptProperties().getProperty('ORDERS_ENABLED') === 'true';
}

function throttleOk_() {
    try {
        var cache = CacheService.getScriptCache();
        var key = 'submits_' + Math.floor(new Date().getTime() / 60000);
        var count = Number(cache.get(key) || 0) + 1;
        cache.put(key, String(count), 120);
        return count <= MAX_SUBMISSIONS_PER_MINUTE;
    } catch (e) {
        return true; // never block real orders because the cache misbehaved
    }
}

function openOrdersSheet_() {
    if (!SHEET_ID || SHEET_ID === 'YOUR_SHEET_ID_HERE') return null;
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
    ensureHeaders_(sheet);
    return sheet;
}

// Adds any missing trailing header cells without touching existing ones.
function ensureHeaders_(sheet) {
    if (sheet.getLastRow() === 0) {
        sheet.appendRow(HEADERS);
        return;
    }
    var width = sheet.getLastColumn();
    if (width < HEADERS.length) {
        sheet.getRange(1, width + 1, 1, HEADERS.length - width).setValues([HEADERS.slice(width)]);
    }
}

function findOrderRow_(sheet, orderId) {
    return findValueRow_(sheet, COL_ORDER_ID, orderId);
}

// Row number of the first data row whose `col` holds `value`, or 0.
function findValueRow_(sheet, col, value) {
    if (!value) return 0;
    var last = sheet.getLastRow();
    if (last < 2) return 0;
    var values = sheet.getRange(2, col, last - 1, 1).getValues();
    for (var i = 0; i < values.length; i++) {
        if (String(values[i][0]) === String(value)) return i + 2;
    }
    return 0;
}

function setCell_(sheet, row, col, value) {
    sheet.getRange(row, col, 1, 1).setValues([[value]]);
}

// What goes in the Payee column: the resolved name, or the raw claim marked up
// so an odd one stands out when scanning the sheet.
function payeeLabel_(order) {
    var payee = resolvePayee_(order);
    if (payee.known) return payee.name;
    return payee.claimed ? 'UNKNOWN (' + payee.claimed + ')' : '';
}

function md5Hex_(base64Data) {
    try {
        var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, Utilities.base64Decode(base64Data));
        var hex = '';
        for (var i = 0; i < digest.length; i++) {
            var b = (digest[i] + 256) % 256;
            hex += (b < 16 ? '0' : '') + b.toString(16);
        }
        return hex;
    } catch (e) {
        // Fingerprinting is a convenience; never let it fail a paid order.
        debugLog_('Hashing failed: ' + e);
        return '';
    }
}

function appendToSheet_(sheet, order, uploadResult, screenshotHash) {
    try {
        var ts = new Date();
        var paymentUrl = (uploadResult && uploadResult.fileUrl) ? uploadResult.fileUrl : '';

        // Extract per-item quantities from the items array
        var linxQty = 0, vitaTokQty = 0, patchQty = 0;
        var itemsSummary = order && order.sensorType || '';
        var expectedTotal = 0;
        var pricesKnown = true;

        if (order && order.items && Array.isArray(order.items)) {
            order.items.forEach(function (item) {
                if (item.key === 'linx') linxQty = item.qty || 0;
                else if (item.key === 'vitatok') vitaTokQty = item.qty || 0;
                else if (item.key === 'patch') patchQty = item.qty || 0;

                if (PRICES[item.key] === undefined) pricesKnown = false;
                else expectedTotal += PRICES[item.key] * Number(item.qty || 0);
            });
            itemsSummary = order.items.map(function (i) {
                return i.name + ' ×' + i.qty;
            }).join(', ');
        }

        // Total sensors = only Linx + VitaTok (not patches)
        var totalSensors = linxQty + vitaTokQty;

        // The browser sends the amount, so flag anything that does not match the
        // quantities recorded above rather than trusting it silently.
        var flags = '';
        var claimedTotal = Number(order && order.totalAmount || 0);
        if (pricesKnown && order && order.items && order.items.length && claimedTotal !== expectedTotal) {
            flags = 'AMOUNT_MISMATCH (expected ' + expectedTotal + ')';
            debugLog_('Amount mismatch for ' + (order.orderId || '') + ': claimed ' + claimedTotal + ', expected ' + expectedTotal);
        }

        sheet.appendRow([
            ts,
            order && order.name || '',
            order && order.guardianName || '',
            order && order.phone || '',
            order && order.email || '',
            itemsSummary,
            linxQty,
            vitaTokQty,
            patchQty,
            totalSensors,
            order && order.pickupLocation || '',
            order && order.totalAmount || '',
            paymentUrl,
            order && order.transactionId || '',
            order && order.orderId || '',
            flags,
            screenshotHash || '',
            '',
            payeeLabel_(order)
        ]);

        return { ok: true, row: sheet.getLastRow() };
    } catch (e) {
        return { ok: false, error: String(e) };
    }
}

// Public read endpoint: name, time and what was ordered only. Phone numbers,
// emails, amounts and payment-proof links must never leave the sheet.
function getRecentOrders_(limit) {
    try {
        var sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
        if (!sh) return json_({ success: true, orders: [] });

        var last = sh.getLastRow();
        if (last <= 1) return json_({ success: true, orders: [] });

        var n = Math.max(1, Math.min(Number(limit) || 10, 50));
        var start = Math.max(2, last - n + 1);
        var rows = sh.getRange(start, 1, last - start + 1, 10).getValues().reverse();

        var orders = rows.filter(notBlankRow_).map(function (r) {
            return {
                timestamp: r[0],
                name: r[1],
                // Older rows never had an Items Summary; rebuild one from the
                // quantity columns so they do not show up as a bare count.
                sensorType: r[5] || itemsSummaryFromColumns_(r),
                totalSensors: Number(r[9] || 0),
                // Legacy compatibility: quantity = total items
                quantity: Number(r[6] || 0) + Number(r[7] || 0) + Number(r[8] || 0)
            };
        });

        return json_({ success: true, orders: orders });
    } catch (e) {
        return json_({ success: false, error: String(e), orders: [] });
    }
}

// A row counts as an order if it names someone or records any quantity.
function notBlankRow_(r) {
    if (String(r[1] || '').trim()) return true;
    for (var i = 0; i < ITEM_COLUMNS.length; i++) {
        if (Number(r[ITEM_COLUMNS[i].index] || 0) > 0) return true;
    }
    return false;
}

function itemsSummaryFromColumns_(r) {
    var parts = [];
    ITEM_COLUMNS.forEach(function (c) {
        var qty = Number(r[c.index] || 0);
        if (qty > 0) parts.push(c.name + ' ×' + qty);
    });
    return parts.join(', ');
}

function getSummary_() {
    try {
        var sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
        if (!sh) return json_({ success: true, totalOrders: 0, totalSensors: 0, lastOrderTimestamp: null });

        var last = sh.getLastRow();
        if (last <= 1) return json_({ success: true, totalOrders: 0, totalSensors: 0, lastOrderTimestamp: null });

        // Blank rows left behind in the sheet must not count as orders, and must
        // not become the "last order" timestamp.
        var rows = sh.getRange(2, 1, last - 1, 10).getValues().filter(notBlankRow_);
        if (!rows.length) return json_({ success: true, totalOrders: 0, totalSensors: 0, lastOrderTimestamp: null });

        var totalOrders = rows.length;
        // Column index 9 = "Total Sensors" (Linx + VitaTok only, no patches)
        var totalSensors = rows.reduce(function (acc, r) { return acc + Number(r[9] || 0); }, 0);
        var lastTs = null;
        for (var i = rows.length - 1; i >= 0; i--) {
            if (rows[i][0]) { lastTs = rows[i][0]; break; }
        }

        return json_({ success: true, totalOrders: totalOrders, totalSensors: totalSensors, lastOrderTimestamp: lastTs });
    } catch (e) {
        return json_({ success: false, error: String(e), totalOrders: 0, totalSensors: 0, lastOrderTimestamp: null });
    }
}

// Lets the browser confirm an order landed when it could not read the POST
// response. Order IDs are unguessable, and only a boolean is returned.
function checkOrder_(orderId) {
    try {
        if (!orderId) return json_({ success: false, error: 'Missing orderId', found: false });
        var sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
        if (!sh) return json_({ success: true, found: false });
        return json_({ success: true, found: !!findOrderRow_(sh, orderId) });
    } catch (e) {
        return json_({ success: false, error: String(e), found: false });
    }
}

// ===== PAYMENT SCREENSHOT VERIFICATION =====
// Advisory only. Every finding lands in the 'Verification' column for a
// coordinator to look at; nothing here can reject an order.

var MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

function verifyScreenshotForRow_(sheet, row, data, order, duplicateHashRow) {
    var text = ocrImageText_(data);

    if (text === null) {
        setCell_(sheet, row, COL_VERIFICATION, duplicateHashRow
            ? 'REVIEW: same screenshot as row ' + duplicateHashRow + ' (OCR unavailable)'
            : 'OCR UNAVAILABLE');
        return;
    }

    // Only a name from PAYEES is ever trusted as the expected payee; an order
    // naming anything else is flagged rather than checked against what it claims.
    var payee = resolvePayee_(order);
    var result = analysePaymentText_(text, expectedAmountFor_(order), payee.known ? payee.name : '', new Date());
    var problems = result.problems.slice();
    if (!payee.known) problems.unshift('order named an unrecognised payee (' + (payee.claimed || 'none') + ')');
    if (duplicateHashRow) problems.unshift('same screenshot as row ' + duplicateHashRow);

    setCell_(sheet, row, COL_VERIFICATION, problems.length ? 'REVIEW: ' + problems.join('; ') : 'OK');

    // The Transaction ID column has never been filled by the form — the payment
    // reference read off the screenshot is exactly what belongs there.
    if (result.reference && !(order && order.transactionId)) {
        setCell_(sheet, row, COL_TRANSACTION_ID, result.reference);
    }

    debugLog_('Row ' + row + ' verification: ' + (problems.length ? problems.join('; ') : 'OK'));
}

// Which coordinator an order says it was paid to. `known` is false unless the
// key is one of ours, in which case no payee name check is possible.
function resolvePayee_(order) {
    var claimed = String(order && order.payee || '').toLowerCase().trim();
    // An order from a browser still running a cached copy of the old script names
    // no payee; it also showed the cached config's payee, which is this default.
    var key = claimed || DEFAULT_PAYEE_KEY;
    if (PAYEES[key] && !/fill in/i.test(PAYEES[key])) {
        return { key: key, name: PAYEES[key], known: true, claimed: claimed };
    }
    return { key: '', name: '', known: false, claimed: claimed };
}

// What the payer should have transferred: recomputed from quantities where the
// prices are known, otherwise whatever the browser reported.
function expectedAmountFor_(order) {
    var total = 0, known = true;
    if (order && order.items && order.items.length) {
        order.items.forEach(function (i) {
            if (PRICES[i.key] === undefined) known = false;
            else total += PRICES[i.key] * Number(i.qty || 0);
        });
        if (known) return total;
    }
    return Number(order && order.totalAmount || 0);
}

// Imports the image as a Google Doc so Drive OCRs it, reads the text back, then
// throws the temporary doc away. Returns null when OCR is unavailable.
function ocrImageText_(data) {
    if (typeof Drive === 'undefined' || !Drive.Files) {
        debugLog_('Advanced Drive Service not enabled — skipping OCR');
        return null;
    }
    var docId = '';
    try {
        var bytes = Utilities.base64Decode(data.screenshot);
        var blob = Utilities.newBlob(bytes, data.mimeType || 'image/png', data.filename || 'screenshot.png');
        var created = Drive.Files.create(
            { name: 'ocr-temp-' + new Date().getTime(), mimeType: 'application/vnd.google-apps.document' },
            blob,
            { ocrLanguage: 'en' }
        );
        docId = created.id || (created.getId && created.getId());
        return DocumentApp.openById(docId).getBody().getText();
    } catch (e) {
        debugLog_('OCR failed: ' + e);
        return null;
    } finally {
        if (docId) {
            try { Drive.Files.remove(docId); }
            catch (_) { try { DriveApp.getFileById(docId).setTrashed(true); } catch (__) { } }
        }
    }
}

// Pure text analysis, so it can be reasoned about (and tested) on its own.
function analysePaymentText_(text, expectedAmount, payeeName, now) {
    var problems = [];
    var flat = String(text || '').replace(/\s+/g, ' ').trim();
    var lower = flat.toLowerCase();

    if (!flat) {
        return { problems: ['screenshot text could not be read'], reference: '', text: '' };
    }

    // --- amount ---
    if (expectedAmount > 0) {
        var amounts = extractAmounts_(flat);
        var candidates = amounts.currency.concat(amounts.loose);
        var matched = false;
        for (var i = 0; i < candidates.length; i++) {
            if (Math.abs(candidates[i] - expectedAmount) < 0.5) { matched = true; break; }
        }
        if (!matched) {
            problems.push(amounts.currency.length
                ? 'amount mismatch (expected ' + expectedAmount + ', screenshot shows ' + amounts.currency.slice(0, 3).join(' / ') + ')'
                : 'amount ' + expectedAmount + ' not found on screenshot');
        }
    }

    // --- payee: the crucial check is that they paid the right person ---
    var tokens = String(payeeName || '').toLowerCase().match(/[a-z]{3,}/g) || [];
    if (tokens.length) {
        var letters = lower.replace(/[^a-z]+/g, ' ');
        var hits = 0;
        tokens.forEach(function (t) { if (letters.indexOf(t) !== -1) hits++; });
        if (hits === 0) problems.push('payee "' + payeeName + '" not found');
        else if (hits < tokens.length) problems.push('payee name only partly matched');
    }

    // --- date: catches an old screenshot being reused ---
    var when = extractDate_(lower, now);
    if (when) {
        var ageDays = Math.floor((now.getTime() - when.getTime()) / 86400000);
        if (ageDays > SCREENSHOT_MAX_AGE_DAYS) problems.push('screenshot dated ' + ageDays + ' days ago');
        else if (ageDays < -1) problems.push('screenshot dated in the future');
    }

    return { problems: problems, reference: extractReference_(flat), text: flat };
}

function extractAmounts_(text) {
    var currency = [], loose = [], m;

    var reCurrency = /(?:₹|rs\.?|inr)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi;
    while ((m = reCurrency.exec(text)) !== null) {
        var c = Number(String(m[1]).replace(/,/g, ''));
        if (isFinite(c) && c > 0) currency.push(c);
    }

    // OCR often loses the ₹ glyph, so bare numbers count as candidates too.
    var reNumber = /\b([0-9]{1,3}(?:,[0-9]{2,3})+(?:\.[0-9]{1,2})?|[0-9]{2,6}(?:\.[0-9]{1,2})?)\b/g;
    while ((m = reNumber.exec(text)) !== null) {
        var n = Number(String(m[1]).replace(/,/g, ''));
        if (isFinite(n) && n > 0) loose.push(n);
    }

    return { currency: currency, loose: loose };
}

function extractDate_(lower, now) {
    if (/\b(today|just now|moments ago|\d+\s*(?:minute|min|hour|hr)s?\s*ago)\b/.test(lower)) return new Date(now.getTime());
    if (/\byesterday\b/.test(lower)) return new Date(now.getTime() - 86400000);

    var m = lower.match(/\b(\d{1,2})\s*(?:st|nd|rd|th)?\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s*(\d{4}|\d{2})?/);
    if (m) return buildDate_(Number(m[1]), MONTHS[m[2]], m[3], now);

    m = lower.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*(\d{1,2})\s*(?:st|nd|rd|th)?,?\s*(\d{4}|\d{2})?/);
    if (m) return buildDate_(Number(m[2]), MONTHS[m[1]], m[3], now);

    // dd/mm/yyyy — Indian apps do not use the American order
    m = lower.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/);
    if (m) return buildDate_(Number(m[1]), Number(m[2]) - 1, m[3], now);

    return null;
}

function buildDate_(day, month, yearRaw, now) {
    if (!(day >= 1 && day <= 31) || !(month >= 0 && month <= 11)) return null;
    var year;
    if (yearRaw) {
        year = Number(yearRaw);
        if (year < 100) year += 2000;
    } else {
        year = now.getFullYear();
    }
    var d = new Date(year, month, day);
    // A year-less date that lands in the future must belong to last year
    if (!yearRaw && d.getTime() > now.getTime() + 86400000) d = new Date(year - 1, month, day);
    return d;
}

function extractReference_(text) {
    var m = text.match(/(?:utr|upi\s*(?:transaction|ref(?:erence)?)\s*(?:id|no\.?|number)?|transaction\s*id)\s*[:\-]?\s*([A-Za-z0-9]{8,25})/i);
    if (m) return m[1];
    m = text.match(/\b(\d{12})\b/);   // bare 12-digit UTR
    return m ? m[1] : '';
}

function handleUpload_(data) {
    if (!data || !data.screenshot) return json_({ success: false, error: 'Missing screenshot' });
    if (!FOLDER_ID || FOLDER_ID === 'YOUR_FOLDER_ID_HERE') return json_({ success: false, error: 'Folder ID not set in script' });
    return json_(upl_(data));
}

function upl_(data) {
    var filename = data.filename || ('order_' + Date.now() + '.png');
    var mimeType = data.mimeType || 'image/png';
    var bytes = Utilities.base64Decode(data.screenshot);
    var blob = Utilities.newBlob(bytes, mimeType, filename);
    var file = DriveApp.getFolderById(FOLDER_ID).createFile(blob);
    // Deliberately NOT shared with anyone-with-the-link: these are payment
    // screenshots and the file URLs used to be readable from a public endpoint.
    if (data.orderDetails) {
        try { file.setDescription('Order: ' + (data.orderDetails.name || '') + ' | Phone: ' + (data.orderDetails.phone || '')); } catch (_) { }
    }
    var fileId = file.getId();
    return { success: true, fileId: fileId, fileUrl: file.getUrl(), name: file.getName(), mimeType: file.getMimeType() };
}

function sendConfirmationEmail_(order, uploadResult) {
    var to = String(order.email || '').trim();
    if (!to) return;
    if (!EMAIL_WEBAPP_URL || EMAIL_WEBAPP_URL === 'YOUR_EMAIL_WEBAPP_URL_HERE') return;

    var name = order.name || 'Friend';
    var pickup = order.pickupLocation || '';
    var total = order.totalAmount || '';
    var txnId = order.transactionId || '';
    var gotProof = !!(uploadResult && uploadResult.fileId);

    // Build itemized list for email
    var itemsHtml = '';
    if (order.items && Array.isArray(order.items)) {
        itemsHtml = order.items.map(function (i) {
            return '<li>' + escapeHtml_(i.name) + ' × ' + escapeHtml_(i.qty) + ' — ₹' + escapeHtml_(Number(i.subtotal || 0)) + '</li>';
        }).join('');
    } else {
        // Fallback for old-format orders
        var sensor = order.sensorType || '';
        var qty = order.quantity || '';
        itemsHtml = '<li>' + escapeHtml_(sensor) + ' × ' + escapeHtml_(qty) + '</li>';
    }

    // Build schedule line from values sent by the client (config.js)
    var runDate = (order.nextRunDate || '').toString().trim();
    var cycle = (order.deliveryCycle || '').toString().trim();
    var scheduleLine = (runDate || cycle)
        ? '<p>The sensors can be collected during the next scheduled Type One Run/Group Meetup on ' +
        (runDate ? (escapeHtml_(runDate) + ' ') : '') + escapeHtml_(cycle) + '.</p>'
        : '';

    var subject = 'Your CGM pre‑order has been received';

    // HTML email body
    var body =
        '<p>Hi ' + escapeHtml_(name) + ',</p>' +
        '<p>Thank you for placing your CGM sensor pre-order with Diabuddies of Karnataka.</p>' +
        scheduleLine +
        '<p><strong>Order details:</strong></p>' +
        '<ul>' + itemsHtml + '</ul>' +
        (total ? '<p><strong>Total Amount:</strong> ₹' + escapeHtml_(total) + '</p>' : '') +
        (txnId ? '<p><strong>Transaction ID:</strong> ' + escapeHtml_(txnId) + '</p>' : '') +
        (pickup ? '<p><strong>Pickup:</strong> ' + escapeHtml_(pickup) + '</p>' : '') +
        (gotProof ? '<p>Your payment screenshot has been received and recorded with this order. Please keep your own copy for reference.</p>' : '') +
        '<p>We would like to remind you that this is a community service run by volunteers of \'Diabuddies of Karnataka\' so that our T1D community can benefit from slightly better prices. We do not make any profit from this.</p>' +
        '<p>Regards,<br>Diabuddies of Karnataka</p>';

    var payload = {
        to: to,
        subject: subject,
        body: body,
        html: true,  // Signal to email sender to use HTML
        name: FROM_NAME,
        replyTo: REPLY_TO,
        token: EMAIL_TOKEN
    };

    try {
        UrlFetchApp.fetch(EMAIL_WEBAPP_URL, {
            method: 'post',
            contentType: 'application/json',
            payload: JSON.stringify(payload),
            muteHttpExceptions: true
        });
    } catch (_) {
        // ignore email errors
    }
}

// Order details are typed by submitters, so escape before building HTML email.
function escapeHtml_(value) {
    return String(value === null || value === undefined ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function handleAdminAction_(data) {
    var props = PropertiesService.getScriptProperties();
    if (data.action === 'getStatus') {
        return json_({ success: true, ordersEnabled: ordersEnabled_() });
    }
    if (data.action === 'toggleOrders') {
        var pass = String(data.password || '');
        var correct = String(props.getProperty('ADMIN_PASSWORD') || '');
        if (!correct || pass !== correct) return json_({ success: false, error: 'Unauthorized' });
        var newEnabled = data.enabled === true;
        props.setProperty('ORDERS_ENABLED', String(newEnabled));
        return json_({ success: true, ordersEnabled: newEnabled });
    }
    return json_({ success: false, error: 'Unknown action' });
}

// doGet with optional JSONP (for static sites) for the read-only actions
function doGet(e) {
    try {
        var p = e && e.parameter || {};
        var callback = safeCallbackName_(p.callback);

        if (p.action === 'getRecentOrders') {
            return respond_(getRecentOrders_(p.limit ? Number(p.limit) : 10), callback);
        }
        if (p.action === 'getSummary') {
            return respond_(getSummary_(), callback);
        }
        if (p.action === 'getStatus') {
            return respond_(json_({ success: true, ordersEnabled: ordersEnabled_() }), callback);
        }
        if (p.action === 'checkOrder') {
            return respond_(checkOrder_(p.orderId), callback);
        }
        return respond_(json_({ success: true, message: 'OK', timestamp: new Date().toISOString() }), callback);
    } finally {
        flushDebugLog_();
    }
}

// Only allow a plain identifier as the JSONP callback so the parameter cannot
// be used to inject script into the response.
function safeCallbackName_(name) {
    var s = String(name || '');
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s) ? s : '';
}

function respond_(output, callback) {
    if (!callback) return output;
    return ContentService
        .createTextOutput(callback + '(' + output.getContent() + ');')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function json_(obj) {
    return ContentService.createTextOutput(JSON.stringify(obj))
        .setMimeType(ContentService.MimeType.JSON);
}

// ===== HELPER FUNCTIONS =====

/**
 * Test function to check if logs are being written
 */
function testLogging() {
    Logger.log('=== TEST LOGGING ===');
    Logger.log('Current time: ' + new Date().toISOString());
    Logger.log('Script ID: ' + ScriptApp.getScriptId());
    Logger.log('Test completed successfully');

    // Writes to the Debug sheet — never to the Orders sheet.
    debugLog_('TEST LOG ENTRY — logging is working');
    flushDebugLog_();
    Logger.log('Check the Debug tab of your Google Sheet');
}

/**
 * Debug logs are buffered and written once per request, so a submission does
 * not pay for several extra Sheets round-trips.
 */
var DEBUG_BUFFER = [];

function debugLog_(message) {
    DEBUG_BUFFER.push([new Date(), String(message)]);
}

function flushDebugLog_() {
    if (!DEBUG_BUFFER.length) return;
    var rows = DEBUG_BUFFER;
    DEBUG_BUFFER = [];
    try {
        var ss = SpreadsheetApp.openById(SHEET_ID);
        var debugSheet = ss.getSheetByName('Debug');

        if (!debugSheet) {
            debugSheet = ss.insertSheet('Debug');
            debugSheet.appendRow(['Timestamp', 'Message']);
        }

        debugSheet.getRange(debugSheet.getLastRow() + 1, 1, rows.length, 2).setValues(rows);

        if (debugSheet.getLastRow() > 101) {
            debugSheet.deleteRows(2, debugSheet.getLastRow() - 101);
        }
    } catch (e) {
        Logger.log('Debug logging failed: ' + e);
    }
}

/**
 * Test the debug logging - run this manually
 */
function testDebugLog() {
    debugLog_('=== TEST DEBUG LOG ===');
    debugLog_('This is a test message');
    debugLog_('Debug logging is working!');
    flushDebugLog_();
    Logger.log('Check your Google Sheet for a new Debug tab');
}
