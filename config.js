// Configuration file for CGM Sensor Order System
// Update these values as needed

const CONFIG = {
    // Optional delivery cycle label shown next to title, e.g., 'September 2025'
    // Leave empty to auto-use current Month Year
    DELIVERY_CYCLE: 'September \'25',
    // Optional specific date for the next run (used only in the header meta)
    // Example: '14th'
    NEXT_RUN_DATE: '14th',

    // Optional: show an "orders close" date under the header meta
    // Example: '7th September 2025'
    ORDER_CLOSES_DATE: '27th August \'25',

    // Show recent orders from Google Sheets instead of local browser cache
    USE_SERVER_ORDERS: true,
    // How many recent orders to fetch when USE_SERVER_ORDERS is true
    ORDERS_FETCH_LIMIT: 10,
    
    // Google Apps Script URL - update this when you set up Google Drive
    GOOGLE_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbznvJRP-LkLH1FnY_bH0k-7YA2WepkfBhb5yGMMKWxBvQs3K-adMZE1EuOMcQiLcARC/exec',
    
    // UPI ID
    UPI_ID: 'chanangad-1@okicici',
    
    // Sensor configuration - customize these as needed
    SENSORS: {
        'linx': {
            name: 'Linx',
            price: 3900,
            savings: 600
        }
    },
    
    // Pickup locations - customize these as needed
    PICKUP_LOCATIONS: {
        'cubbon-park': 'Cubbon Park',
    },
    
    // Default sensor (first one in the list)
    DEFAULT_SENSOR: 'linx'
};

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
} 