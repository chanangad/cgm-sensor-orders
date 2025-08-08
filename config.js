// Configuration file for CGM Sensor Order System
// Update these values as needed

const CONFIG = {
    
    // Google Apps Script URL - update this when you set up Google Drive
    GOOGLE_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbyM5x177G4ux7La1VUMkRj8ypXXCePYs5Pxrk7-3Ln0-iDSFaYObNGftIUG1hg8KSNu/exec',
    
    // UPI ID
    UPI_ID: 'chanangad-1@okicici',
    
    // Sensor configuration - customize these as needed
    SENSORS: {
        'linx': {
            name: 'Linx',
            price: 3900,
            savings: 500
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