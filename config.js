// Configuration file for CGM Sensor Order System
// Update these values as needed

const CONFIG = {
    // Optional delivery cycle label shown next to title, e.g., 'September 2025'
    // Leave empty to auto-use current Month Year
    DELIVERY_CYCLE: 'March 2026',
    // Optional specific date for the next run (used only in the header meta)
    // Example: '14th'
    NEXT_RUN_DATE: '15th',

    // Optional: show an "orders close" date under the header meta
    // Example: '7th September 2025'
    ORDER_CLOSES_DATE: '1st March \'26',

    // Show recent orders from Google Sheets instead of local browser cache
    USE_SERVER_ORDERS: true,
    // How many recent orders to fetch when USE_SERVER_ORDERS is true
    ORDERS_FETCH_LIMIT: 10,

    // Google Apps Script URL - update this when you set up Google Drive
    GOOGLE_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbwXtTeXLz_8O-ZfraWmgCRgfkjxC1Yk2jBDj-vaCsee4VYxjc0ZIVb97ObzJbhch0FC/exec',

    // UPI ID for payment
    UPI_ID: 'singh.beenu@ptyes',

    // UPI Recipient Name (for verification - used in backend)
    UPI_RECIPIENT_NAME: 'Angad Chandhok',

    // Sensor configuration - customize these as needed
    // Products available for ordering
    SENSORS: {
        'linx': {
            name: 'Linx',
            price: 3325,
            savings: 975,
            isSensor: true
        },
        'vitatok': {
            name: 'VitaTok',
            price: 3225,
            savings: 1075,
            isSensor: true
        },
        'patch': {
            name: 'Linx/VitaTok Patch',
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

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
} 
