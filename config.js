// Configuration file for CGM Sensor Order System
// Update these values as needed

const CONFIG = {
    // Optional delivery cycle label shown next to title, e.g., 'September 2025'
    // Leave empty to auto-use current Month Year
    DELIVERY_CYCLE: 'July 2026',
    // Optional specific date for the next run (used only in the header meta)
    // Example: '14th'
    NEXT_RUN_DATE: '12th',

    // Optional: show an "orders close" date under the header meta
    // Example: '7th September 2025'
    ORDER_CLOSES_DATE: '4th July \'26',

    // Maximum order amount allowed in INR
    MAX_ORDER_AMOUNT: 25000,

    // Show recent orders from Google Sheets instead of local browser cache
    USE_SERVER_ORDERS: true,
    // How many recent orders to fetch when USE_SERVER_ORDERS is true
    ORDERS_FETCH_LIMIT: 10,

    // Google Apps Script URL - update this when you set up Google Drive
    GOOGLE_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbwXtTeXLz_8O-ZfraWmgCRgfkjxC1Yk2jBDj-vaCsee4VYxjc0ZIVb97ObzJbhch0FC/exec',

    // ---- Who collects the payments for this run ----------------------------
    // Change ACTIVE_PAYEE to one of the keys in PAYEES below. The UPI ID shown
    // on the page, the ID the copy button copies, the QR code displayed, and the
    // payee name checked against payment screenshots all follow from it.
    // Nothing else needs editing to switch coordinators.
    ACTIVE_PAYEE: 'anirudh',

    PAYEES: {
        'anirudh': {
            name: 'Anirudh Talakanti',
            upiId: 'anirudh.talakanti-2@okaxis',
            qrImage: 'ani.png'
        },
        'angad': {
            name: 'Angad Chandhok',
            upiId: 'chanangad-1@okicici',
            qrImage: 'angad.png'
        },
        // A payee needs a name plus at least one way to pay them. With only a QR
        // the page shows the QR alone; with only a UPI ID it shows the ID alone.
        'beenu': {
            name: 'Beenu Singh',
            upiId: '',              // TODO: add Beenu's UPI ID to show it as text too
            qrImage: 'beenu.png'
        },
        'nithin': {
            name: 'Nithin Somasundar',
            upiId: '',              // TODO: add Nithin's UPI ID
            qrImage: ''             // TODO: add Nithin's QR image to the repo
            // Not selectable until one of the two above is filled in.
        }
    },
    // Sensor configuration - customize these as needed
    // Products available for ordering
    // NOTE: when prices change here, also update PRICES in google-apps-script.js
    // (used only to flag mismatched order totals) and bump the ?v= number on the
    // config.js <script> tag in index.html so browsers don't serve a cached copy.
    // `shortName` is optional and only affects the Recent Orders list, where a
    // long product name reads badly. It falls back to `name`.
    SENSORS: {
        'linx': {
            name: 'Linx',
            price: 3025,
            savings: 1075,
            isSensor: true
        },
        'vitatok': {
            name: 'VitaTok',
            price: 2925,
            savings: 1175,
            isSensor: true
        },
        'patch': {
            name: 'Linx/VitaTok Patch',
            shortName: 'Patch',
            price: 30,
            savings: 20,
            isSensor: false
        },
    },

    // Pickup locations - customize these as needed
    PICKUP_LOCATIONS: {
        'cubbon-park': 'Cubbon Park',
        // 'KIER, Indiranagar': 'KIER, Indiranagar',
    }
};

// Derived from ACTIVE_PAYEE for the rest of the app to read. Do not edit these
// directly — change ACTIVE_PAYEE / PAYEES above instead.
(function resolveActivePayee() {
    var payee = CONFIG.PAYEES && CONFIG.PAYEES[CONFIG.ACTIVE_PAYEE];
    if (!payee) {
        if (typeof console !== 'undefined') {
            console.error('CONFIG.ACTIVE_PAYEE "' + CONFIG.ACTIVE_PAYEE + '" is not a key of CONFIG.PAYEES');
        }
        return;
    }
    CONFIG.UPI_ID = payee.upiId;
    CONFIG.UPI_RECIPIENT_NAME = payee.name;
    CONFIG.UPI_QR_IMAGE = payee.qrImage;
})();

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
} 
