function initAuth() {
    // Run once to grant Drive/Sheets permissions
    SpreadsheetApp.openById('1DumLqeIDx8mEy8WbTYar6QPvyIcQy0a-GN3A8T4DUfs');
}

// IDs
var FOLDER_ID = '1xTm7zsVuf6mUCeE5eReJ67SrGeBrtNs6';
var SHEET_ID = '1DumLqeIDx8mEy8WbTYar6QPvyIcQy0a-GN3A8T4DUfs';
var SHEET_NAME = 'Orders';

// Email (display) and cross‑script config (set in Script Properties)
var FROM_NAME = 'Diabuddies of Karnataka';
var REPLY_TO = 'diabuddiesofkarnataka@gmail.com';
var EMAIL_WEBAPP_URL = PropertiesService.getScriptProperties().getProperty('EMAIL_WEBAPP_URL') || 'YOUR_EMAIL_WEBAPP_URL_HERE'; // must be the /exec URL
var EMAIL_TOKEN = PropertiesService.getScriptProperties().getProperty('EMAIL_TOKEN') || ''; // optional shared secret

function doPost(e) {
    try {
        Logger.log('RAW: ' + (e && e.postData && e.postData.contents));
        var data = JSON.parse((e && e.postData && e.postData.contents) || '{}');

        if (!data.action && data.orderDetails) data.action = 'submitOrder';

        if (data.action === 'getStatus' || data.action === 'toggleOrders') return handleAdminAction_(data);
        if (data.action === 'getRecentOrders') return getRecentOrders_(data.limit || 10);
        if (data.action === 'getSummary') return getSummary_();
        if (data.action === 'submitOrder') return handleSubmitOrder_(data);

        return handleUpload_(data);
    } catch (err) {
        return json_({ success: false, error: String(err) });
    }
}

function handleSubmitOrder_(data) {
    debugLog_('=== SUBMIT ORDER STARTED ===');
    debugLog_('Has screenshot: ' + !!(data && data.screenshot));
    debugLog_('Has orderDetails: ' + !!(data && data.orderDetails));
    debugLog_('Transaction ID: ' + (data && data.orderDetails ? data.orderDetails.transactionId : 'N/A'));
    debugLog_('Total Amount: ' + (data && data.orderDetails ? data.orderDetails.totalAmount : 'N/A'));

    // 1) Upload screenshot to Drive (if provided)
    var uploadResult = data && data.screenshot ? upl_(data) : null;

    // 2) Append to Google Sheet
    var sheetResult = (SHEET_ID && SHEET_ID !== 'YOUR_SHEET_ID_HERE')
        ? appendToSheet_(data.orderDetails, uploadResult)
        : null;

    // 3) Send confirmation email through external email-sender Web App (other Google account)
    try {
        if (data && data.orderDetails && data.orderDetails.email) {
            sendConfirmationEmail_(data.orderDetails, uploadResult);
        }
    } catch (_) {
        // do not fail the request on email error
    }

    return json_({ success: true, upload: uploadResult, sheet: sheetResult });
}

function appendToSheet_(order, uploadResult) {
    try {
        var ss = SpreadsheetApp.openById(SHEET_ID);
        var sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);

        // Add header if empty
        if (sheet.getLastRow() === 0) {
            sheet.appendRow([
                'Timestamp', 'Name', 'Parent/Guardian', 'Phone', 'Email',
                'Items Summary', 'Linx Qty', 'VitaTok Qty', 'Patch Qty',
                'Total Sensors', 'Pickup', 'Total Amount', 'Payment Proof URL',
                'Transaction ID'
            ]);
        }

        var ts = new Date();
        var paymentUrl = (uploadResult && uploadResult.fileUrl) ? uploadResult.fileUrl : '';

        // Extract per-item quantities from the items array
        var linxQty = 0, vitaTokQty = 0, patchQty = 0;
        var itemsSummary = order && order.sensorType || '';

        if (order && order.items && Array.isArray(order.items)) {
            order.items.forEach(function (item) {
                if (item.key === 'linx') linxQty = item.qty || 0;
                else if (item.key === 'vitatok') vitaTokQty = item.qty || 0;
                else if (item.key === 'patch') patchQty = item.qty || 0;
            });
            itemsSummary = order.items.map(function (i) {
                return i.name + ' ×' + i.qty;
            }).join(', ');
        }

        // Total sensors = only Linx + VitaTok (not patches)
        var totalSensors = linxQty + vitaTokQty;

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
            order && order.transactionId || ''
        ]);

        return { ok: true };
    } catch (e) {
        return { ok: false, error: String(e) };
    }
}

function getRecentOrders_(limit) {
    try {
        var sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
        if (!sh) return json_({ success: true, orders: [] });

        var last = sh.getLastRow();
        if (last <= 1) return json_({ success: true, orders: [] });

        var numCols = 14;
        var start = Math.max(2, last - limit + 1);
        var rows = sh.getRange(start, 1, last - start + 1, numCols).getValues().reverse();

        var orders = rows.map(function (r) {
            return {
                timestamp: r[0],
                name: r[1],
                guardianName: r[2],
                phone: r[3],
                email: r[4],
                sensorType: r[5],       // Items Summary column
                linxQty: r[6],
                vitaTokQty: r[7],
                patchQty: r[8],
                totalSensors: r[9],
                pickupLocation: r[10],
                totalAmount: r[11],
                paymentProofUrl: r[12],
                transactionId: r[13],
                // Legacy compatibility: quantity = total items
                quantity: Number(r[6] || 0) + Number(r[7] || 0) + Number(r[8] || 0)
            };
        });

        return json_({ success: true, orders: orders });
    } catch (e) {
        return json_({ success: false, error: String(e), orders: [] });
    }
}

function getSummary_() {
    try {
        var sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
        if (!sh) return json_({ success: true, totalOrders: 0, totalSensors: 0, lastOrderTimestamp: null });

        var last = sh.getLastRow();
        if (last <= 1) return json_({ success: true, totalOrders: 0, totalSensors: 0, lastOrderTimestamp: null });

        var rows = sh.getRange(2, 1, last - 1, 14).getValues();
        var totalOrders = rows.length;
        // Column index 9 = "Total Sensors" (Linx + VitaTok only, no patches)
        var totalSensors = rows.reduce(function (acc, r) { return acc + Number(r[9] || 0); }, 0);
        var lastTs = rows[rows.length - 1][0];

        return json_({ success: true, totalOrders: totalOrders, totalSensors: totalSensors, lastOrderTimestamp: lastTs });
    } catch (e) {
        return json_({ success: false, error: String(e), totalOrders: 0, totalSensors: 0, lastOrderTimestamp: null });
    }
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
    // Make viewable by anyone with the link so it can be embedded in emails
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    if (data.orderDetails) {
        try { file.setDescription('Order: ' + (data.orderDetails.name || '') + ' | Phone: ' + (data.orderDetails.phone || '')); } catch (_) { }
    }
    var fileId = file.getId();
    return { success: true, fileId: fileId, fileUrl: file.getUrl(), directImageUrl: 'https://drive.google.com/uc?export=view&id=' + fileId, name: file.getName(), mimeType: file.getMimeType() };
}

function sendConfirmationEmail_(order, uploadResult) {
    var to = String(order.email || '').trim();
    if (!to) return;
    if (!EMAIL_WEBAPP_URL || EMAIL_WEBAPP_URL === 'YOUR_EMAIL_WEBAPP_URL_HERE') return;

    var name = order.name || 'Friend';
    var pickup = order.pickupLocation || '';
    var total = order.totalAmount || '';
    var proofUrl = uploadResult && uploadResult.fileUrl ? uploadResult.fileUrl : '';
    var proofImageUrl = uploadResult && uploadResult.directImageUrl ? uploadResult.directImageUrl : '';
    var txnId = order.transactionId || '';

    // Build itemized list for email
    var itemsHtml = '';
    if (order.items && Array.isArray(order.items)) {
        itemsHtml = order.items.map(function (i) {
            return '<li>' + i.name + ' × ' + i.qty + ' — ₹' + Number(i.subtotal).toLocaleString() + '</li>';
        }).join('');
    } else {
        // Fallback for old-format orders
        var sensor = order.sensorType || '';
        var qty = order.quantity || '';
        itemsHtml = '<li>' + sensor + ' × ' + qty + '</li>';
    }

    // Build schedule line from values sent by the client (config.js)
    var runDate = (order.nextRunDate || '').toString().trim();
    var cycle = (order.deliveryCycle || '').toString().trim();
    var scheduleLine = (runDate || cycle)
        ? '<p>The sensors can be collected during the next scheduled Type One Run/Group Meetup on ' +
        (runDate ? (runDate + ' ') : '') + cycle + '.</p>'
        : '';

    var subject = 'Your CGM pre‑order has been received';

    // HTML email body
    var body =
        '<p>Hi ' + name + ',</p>' +
        '<p>Thank you for placing your CGM sensor pre-order with Diabuddies of Karnataka.</p>' +
        scheduleLine +
        '<p><strong>Order details:</strong></p>' +
        '<ul>' + itemsHtml + '</ul>' +
        (total ? '<p><strong>Total Amount:</strong> ₹' + total + '</p>' : '') +
        (txnId ? '<p><strong>Transaction ID:</strong> ' + txnId + '</p>' : '') +
        (pickup ? '<p><strong>Pickup:</strong> ' + pickup + '</p>' : '') +
        (proofImageUrl ? '<p><strong>Payment Proof:</strong></p><p><img src="' + proofImageUrl + '" alt="Payment Screenshot" style="max-width:400px; border:1px solid #ddd; border-radius:8px;"></p>' : '') +
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

function handleAdminAction_(data) {
    var props = PropertiesService.getScriptProperties();
    if (data.action === 'getStatus') {
        return json_({ success: true, ordersEnabled: props.getProperty('ORDERS_ENABLED') === 'true' });
    }
    if (data.action === 'toggleOrders') {
        var pass = String(data.password || '');
        var correct = String(props.getProperty('ADMIN_PASSWORD') || '');
        if (pass !== correct) return json_({ success: false, error: 'Unauthorized' });
        var newEnabled = data.enabled === true;
        props.setProperty('ORDERS_ENABLED', String(newEnabled));
        return json_({ success: true, ordersEnabled: newEnabled });
    }
    return json_({ success: false, error: 'Unknown action' });
}

// doGet with optional JSONP (for static sites) for getRecentOrders and getSummary
function doGet(e) {
    var p = e && e.parameter || {};
    if (p.action === 'getRecentOrders') {
        var limit = p.limit ? Number(p.limit) : 10;
        var content = getRecentOrders_(limit).getContent();
        return p.callback
            ? ContentService.createTextOutput(p.callback + '(' + content + ');').setMimeType(ContentService.MimeType.JAVASCRIPT)
            : ContentService.createTextOutput(content).setMimeType(ContentService.MimeType.JSON);
    }
    if (p.action === 'getSummary') {
        var content2 = getSummary_().getContent();
        return p.callback
            ? ContentService.createTextOutput(p.callback + '(' + content2 + ');').setMimeType(ContentService.MimeType.JAVASCRIPT)
            : ContentService.createTextOutput(content2).setMimeType(ContentService.MimeType.JSON);
    }
    return json_({ success: true, message: 'OK', timestamp: new Date().toISOString() });
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

    try {
        var ss = SpreadsheetApp.openById(SHEET_ID);
        var sheet = ss.getSheetByName(SHEET_NAME);
        var lastRow = sheet.getLastRow();
        sheet.getRange(lastRow + 1, 1, 1, 3).setValues([[
            new Date(),
            'TEST LOG ENTRY',
            'Logging is working'
        ]]);
        Logger.log('Successfully wrote test entry to sheet');
    } catch (e) {
        Logger.log('Error writing to sheet: ' + e);
    }
}

/**
 * Helper function to write debug logs to a sheet
 */
function debugLog_(message) {
    try {
        var ss = SpreadsheetApp.openById(SHEET_ID);
        var debugSheet = ss.getSheetByName('Debug');

        if (!debugSheet) {
            debugSheet = ss.insertSheet('Debug');
            debugSheet.appendRow(['Timestamp', 'Message']);
        }

        debugSheet.appendRow([new Date(), String(message)]);

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
    Logger.log('Check your Google Sheet for a new Debug tab');
}
