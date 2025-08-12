// CGM Sensor Group Order Management System

class CGMOrderManager {
    constructor() {
        this.orders = this.loadOrders();
        this.sensorPrices = CONFIG.SENSORS;
        this.ordersEnabled = true;
        
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.updateSummary();
        this.renderOrders();
        this.applyDeliveryCycleLabel();
    }

    setupEventListeners() {
        console.log('Setting up event listeners...');
        
        const form = document.getElementById('orderForm');
        const modal = document.getElementById('successModal');
        const closeModal = document.getElementById('closeModal');
        const orderToggle = document.getElementById('orderToggle');
        const adminLoginBtn = document.getElementById('adminLoginBtn');

        console.log('Form element found:', !!form);
        console.log('Modal element found:', !!modal);
        console.log('Close modal element found:', !!closeModal);
        console.log('Order toggle element found:', !!orderToggle);
        console.log('Admin login button found:', !!adminLoginBtn);

        if (form) {
            // Remove any existing submit listeners
            const newForm = form.cloneNode(true);
            form.parentNode.replaceChild(newForm, form);
            
            // Get the new form reference
            const updatedForm = document.getElementById('orderForm');
            
            updatedForm.addEventListener('submit', (e) => {
                console.log('Form submit event triggered');
                e.preventDefault(); // Prevent default form submission
                e.stopPropagation(); // Stop event bubbling
                this.handleFormSubmit(e);
                return false; // Extra prevention
            });
            console.log('Form submit listener attached');
        } else {
            console.error('Form element not found!');
        }

        if (closeModal) {
            closeModal.addEventListener('click', () => this.closeModal());
        }
        
        // Admin login functionality
        if (adminLoginBtn) {
            adminLoginBtn.addEventListener('click', () => this.showAdminLogin());
        }
        
        // Order toggle functionality
        if (orderToggle) {
            orderToggle.addEventListener('change', async (e) => {
                const desiredEnabled = e.target.checked;
                const previousEnabled = this.ordersEnabled;
                const password = prompt('Enter admin password to confirm');
                if (!password) {
                    // Revert UI if cancelled/empty
                    e.target.checked = previousEnabled;
                    return;
                }
                try {
                    const resp = await this.postToScript({ action: 'toggleOrders', enabled: desiredEnabled, password });
                    if (resp && resp.success) {
                        this.ordersEnabled = !!resp.ordersEnabled;
                        e.target.checked = this.ordersEnabled;
                        this.updateOrderFormState();
                    } else {
                        alert(resp && resp.error ? resp.error : 'Failed to update order status');
                        e.target.checked = previousEnabled;
                    }
                } catch (err) {
                    alert('Network error updating order status');
                    e.target.checked = previousEnabled;
                }
            });
        }
        
        // Close modal when clicking outside
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.closeModal();
                }
            });
        }

        // Add some interactive feedback
        this.addFormValidation();
        this.updateOrderFormState();
        // Fetch current status from server
        this.fetchOrderStatus();
        
        // Populate dynamic options
        this.populateSensorOptions();
        this.populatePickupLocations();
        
        // Add submit button click test
        const submitBtn = form.querySelector('.submit-btn');
        if (submitBtn) {
            console.log('Submit button found, adding click listener');
            submitBtn.addEventListener('click', (e) => {
                console.log('Submit button clicked!');
                e.preventDefault();
                e.stopPropagation();
                console.log('Preventing default button behavior');
                this.handleFormSubmit(e);
            });
            console.log('Submit button click listener attached');
        } else {
            console.error('Submit button not found!');
        }
        
        console.log('Event listeners setup completed');
    }

    addFormValidation() {
        const inputs = document.querySelectorAll('input, select, textarea');
        
        inputs.forEach(input => {
            input.addEventListener('blur', () => {
                this.validateField(input);
            });
            
            input.addEventListener('input', () => {
                if (input.classList.contains('error')) {
                    this.clearFieldError(input);
                }
            });
        });

        // Add quantity change listener for payment calculation
        const quantityInput = document.getElementById('quantity');
        const sensorSelect = document.getElementById('sensorType');
        
        if (quantityInput) {
            quantityInput.addEventListener('input', () => {
                this.updatePaymentSection();
            });
        }
        
        if (sensorSelect) {
            sensorSelect.addEventListener('change', () => {
                this.updatePaymentSection();
            });
        }
    }

    applyDeliveryCycleLabel() {
        const el = document.getElementById('deliveryCycle');
        const inlineEls = document.querySelectorAll('.deliveryCycleInline');
        if (!el && (!inlineEls || inlineEls.length === 0)) return;
        // Read from optional CONFIG.DELIVERY_CYCLE or fallback to current month name + year
        const configured = (typeof CONFIG !== 'undefined' && CONFIG.DELIVERY_CYCLE) ? String(CONFIG.DELIVERY_CYCLE).trim() : '';
        const nextRunDate = (typeof CONFIG !== 'undefined' && CONFIG.NEXT_RUN_DATE) ? String(CONFIG.NEXT_RUN_DATE).trim() : '';
        let label = configured;
        if (!label) {
            const now = new Date();
            const month = now.toLocaleString('en-US', { month: 'long' });
            const year = now.getFullYear();
            label = `(${month} ${year})`;
        }
        if (el) el.textContent = ` ${label}`;
        const dateText = nextRunDate ? `${nextRunDate} ${label} (tentative)` : `${label}`;
        inlineEls.forEach(n => { n.textContent = dateText; });
    }

    async fetchOrderStatus() {
        try {
            const resp = await this.postToScript({ action: 'getStatus' });
            if (resp && resp.success) {
                this.ordersEnabled = !!resp.ordersEnabled;
                const orderToggle = document.getElementById('orderToggle');
                if (orderToggle) orderToggle.checked = this.ordersEnabled;
                this.updateOrderFormState();
            }
        } catch (_) {
            // Ignore; default to enabled state
        }
    }

    async postToScript(payload) {
        const url = CONFIG.GOOGLE_SCRIPT_URL;
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain;charset=utf-8',
                'Accept': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
    }

    validateField(field) {
        console.log('Validating field:', field.name, field.type, field.value);
        
        const value = field.value.trim();
        
        if (field.hasAttribute('required') && !value) {
            console.log('Field validation failed: required field empty');
            this.showFieldError(field, 'This field is required');
            return false;
        }
        
        if (field.type === 'tel' && value) {
            const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/;
            if (!phoneRegex.test(value.replace(/\s/g, ''))) {
                console.log('Field validation failed: invalid phone number');
                this.showFieldError(field, 'Please enter a valid phone number');
                return false;
            }
        }
        
        if (field.type === 'number' && value) {
            const num = parseInt(value);
            if (num < 1 || num > 10) {
                console.log('Field validation failed: quantity out of range');
                this.showFieldError(field, 'Quantity must be between 1 and 10');
                return false;
            }
        }
        
        if (field.type === 'file') {
            console.log('File field validation:', field.files.length, 'files');
            if (field.hasAttribute('required') && field.files.length === 0) {
                console.log('Field validation failed: no file uploaded');
                this.showFieldError(field, 'Payment screenshot is required');
                return false;
            }
        }
        
        console.log('Field validation passed:', field.name);
        return true;
    }

    showFieldError(field, message) {
        field.classList.add('error');
        let errorDiv = field.parentNode.querySelector('.error-message');
        if (!errorDiv) {
            errorDiv = document.createElement('div');
            errorDiv.className = 'error-message';
            field.parentNode.appendChild(errorDiv);
        }
        errorDiv.textContent = message;
        errorDiv.style.color = '#e53e3e';
        errorDiv.style.fontSize = '0.8rem';
        errorDiv.style.marginTop = '0.25rem';
    }

    clearFieldError(field) {
        field.classList.remove('error');
        const errorDiv = field.parentNode.querySelector('.error-message');
        if (errorDiv) {
            errorDiv.remove();
        }
    }

    updateOrderFormState() {
        const form = document.getElementById('orderForm');
        const submitBtn = form.querySelector('.submit-btn');
        const formContainer = document.querySelector('.order-form-section');
        
        if (!this.ordersEnabled) {
            form.style.opacity = '0.6';
            form.style.pointerEvents = 'none';
            submitBtn.textContent = 'Orders Disabled';
            submitBtn.style.background = '#e53e3e';
            formContainer.style.position = 'relative';
            
            // Add disabled overlay
            let overlay = formContainer.querySelector('.disabled-overlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.className = 'disabled-overlay';
                overlay.innerHTML = '<div class="disabled-message"><i class="fas fa-pause-circle"></i><br>Currently not accepting orders</div>';
                formContainer.appendChild(overlay);
            }
        } else {
            form.style.opacity = '1';
            form.style.pointerEvents = 'auto';
            submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit Order';
            submitBtn.style.background = '';
            formContainer.style.position = '';
            
            // Remove disabled overlay
            const overlay = formContainer.querySelector('.disabled-overlay');
            if (overlay) {
                overlay.remove();
            }
        }
    }

    updatePaymentSection() {
        const quantityInput = document.getElementById('quantity');
        const paymentSection = document.getElementById('paymentSection');
        const totalAmountElement = document.getElementById('totalAmount');
        const savingsLine = document.getElementById('savingsLine');
        const savingsValue = document.getElementById('savingsValue');
        
        if (quantityInput && paymentSection && totalAmountElement) {
            const quantity = parseInt(quantityInput.value) || 0;
            
                    if (quantity > 0) {
            const selectedSensor = document.getElementById('sensorType').value;
            const sensorCfg = CONFIG.SENSORS[selectedSensor] || CONFIG.SENSORS[CONFIG.DEFAULT_SENSOR];
            const sensorPrice = sensorCfg.price;
            const perSensorSavings = sensorCfg.savings || 0;
            const totalAmount = quantity * sensorPrice;
            totalAmountElement.textContent = `₹${totalAmount.toLocaleString()}`;
            if (perSensorSavings > 0 && savingsLine && savingsValue) {
                const totalSavings = perSensorSavings * quantity;
                savingsValue.textContent = `₹${totalSavings.toLocaleString()}`;
                savingsLine.style.display = 'block';
            } else if (savingsLine) {
                savingsLine.style.display = 'none';
            }
                paymentSection.style.display = 'block';
                
                // Smooth scroll to payment section
                setTimeout(() => {
                    paymentSection.scrollIntoView({ 
                        behavior: 'smooth', 
                        block: 'start' 
                    });
                }, 300);
            } else {
                paymentSection.style.display = 'none';
            }
        }
    }

    showAdminLogin() {
        // Reveal controls without storing password client-side
        this.showAdminControls();
    }

    showAdminControls() {
        const toggleContainer = document.getElementById('orderToggleContainer');
        const adminLoginBtn = document.getElementById('adminLoginBtn');
        
        toggleContainer.style.display = 'block';
        adminLoginBtn.style.display = 'none';
        
        // Add logout functionality
        const logoutBtn = document.createElement('button');
        logoutBtn.className = 'admin-btn';
        logoutBtn.innerHTML = '<i class="fas fa-sign-out-alt"></i> Logout';
        logoutBtn.addEventListener('click', () => this.hideAdminControls());
        
        const adminLogin = document.querySelector('.admin-login');
        adminLogin.appendChild(logoutBtn);
    }

    hideAdminControls() {
        const toggleContainer = document.getElementById('orderToggleContainer');
        const adminLoginBtn = document.getElementById('adminLoginBtn');
        const logoutBtn = document.querySelector('.admin-btn:last-child');
        
        toggleContainer.style.display = 'none';
        adminLoginBtn.style.display = 'flex';
        
        if (logoutBtn) {
            logoutBtn.remove();
        }
    }

    populateSensorOptions() {
        const sensorSelect = document.getElementById('sensorType');
        if (!sensorSelect) return;

        // Clear existing options except the first one
        sensorSelect.innerHTML = '<option value="">Select sensor type</option>';
        
        // Add options from config
        Object.entries(CONFIG.SENSORS).forEach(([key, sensor]) => {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = `${sensor.name} (₹${sensor.price.toLocaleString()}/-)`;
            sensorSelect.appendChild(option);
        });
        
        console.log('Sensor options populated:', Object.keys(CONFIG.SENSORS).length, 'sensors');
    }

    populatePickupLocations() {
        const locationSelect = document.getElementById('pickupLocation');
        if (!locationSelect) return;

        // Clear existing options except the first one
        locationSelect.innerHTML = '<option value="">Select pickup location</option>';
        
        // Add options from config
        Object.entries(CONFIG.PICKUP_LOCATIONS).forEach(([key, location]) => {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = location;
            locationSelect.appendChild(option);
        });
        
        console.log('Pickup locations populated:', Object.keys(CONFIG.PICKUP_LOCATIONS).length, 'locations');
    }

    async uploadToGoogleDrive(file, orderData) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async () => {
                try {
                    // Convert file to base64
                    const base64Data = reader.result.split(',')[1];
                    
                    // Prepare data for Google Apps Script
                    const uploadData = {
                        action: 'submitOrder',
                        screenshot: base64Data,
                        filename: file && file.name ? file.name : `order_${orderData.name}_${Date.now()}.png`,
                        mimeType: file && file.type ? file.type : 'image/png',
                        orderDetails: orderData
                    };

                    // Use Google Apps Script URL from config
                    const scriptUrl = CONFIG.GOOGLE_SCRIPT_URL;
                    
                    const isProd = window.location.hostname.endsWith('github.io');
                    const fetchOptions = {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'text/plain;charset=utf-8',
                            'Accept': 'application/json'
                        },
                        body: JSON.stringify(uploadData),
                        mode: isProd ? 'no-cors' : 'cors'
                    };

                    const response = await fetch(scriptUrl, fetchOptions);

                    // In production (GitHub Pages), we use no-cors which returns an opaque response
                    // We cannot read status or body, but the request is sent and processed server-side
                    if (isProd) {
                        resolve({ success: true });
                        return;
                    }

                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }

                    const result = await response.json();
                    if (result.success) {
                        resolve(result);
                    } else {
                        reject(new Error(result.error || 'Upload failed'));
                    }
                } catch (error) {
                    console.error('Upload error:', error);
                    reject(error);
                }
            };
            reader.onerror = (error) => {
                console.error('File reading error:', error);
                reject(new Error('File reading failed'));
            };
            reader.readAsDataURL(file);
        });
    }

    async handleFormSubmit(e) {
        e.preventDefault();
        
        if (!this.ordersEnabled) {
            alert('Orders are currently disabled. Please try again later.');
            return;
        }
        
        // Get the form element
        const form = document.getElementById('orderForm');
        const formData = new FormData(form);
        const orderData = Object.fromEntries(formData.entries());
        
        // Validate all fields
        let isValid = true;
        const requiredFields = form.querySelectorAll('[required]');
        
        requiredFields.forEach(field => {
            if (!this.validateField(field)) {
                isValid = false;
            }
        });
        
        // Validate payment screenshot (mandatory)
        const paymentScreenshot = document.getElementById('paymentScreenshot');
        if (!paymentScreenshot || paymentScreenshot.files.length === 0) {
            this.showFieldError(paymentScreenshot, 'Payment screenshot is required');
            return;
        }

        if (!isValid) {
            return;
        }

        // Upload screenshot to Google Drive (mandatory)
        if (paymentScreenshot && paymentScreenshot.files.length > 0) {
            try {
                const uploadResult = await this.uploadToGoogleDrive(paymentScreenshot.files[0], orderData);
                // Support both plain upload and submitOrder response shapes
                if (uploadResult) {
                    const directUrl = uploadResult.fileUrl;
                    const nestedUrl = uploadResult.upload && uploadResult.upload.fileUrl;
                    orderData.paymentProofUrl = directUrl || nestedUrl || '';
                    // Optional: warn if sheet append failed
                    if (uploadResult.sheet && uploadResult.sheet.ok === false) {
                        console.warn('Sheets append failed:', uploadResult.sheet.error);
                    }
                }
                console.log('Upload successful:', uploadResult);
            } catch (error) {
                console.error('Upload failed:', error);
                alert('Screenshot upload failed. Please retry.');
                return;
            }
        }
        
        // Calculate total amount
        const quantity = parseInt(orderData.quantity) || 0;
        const sensorPrice = CONFIG.SENSORS[orderData.sensorType]?.price || CONFIG.SENSORS[CONFIG.DEFAULT_SENSOR].price;
        orderData.totalAmount = quantity * sensorPrice;
        
        // Add timestamp and ID
        orderData.id = Date.now();
        orderData.timestamp = new Date().toISOString();
        orderData.formattedTime = new Date().toLocaleString();
        
        // Save order
        this.addOrder(orderData);
        
        // Show success modal
        this.showSuccessModal(orderData);
        
        // Reset form and hide payment section
        form.reset();
        this.updatePaymentSection();
    }

    addOrder(orderData) {
        this.orders.unshift(orderData);
        this.saveOrders();
        this.updateSummary();
        this.renderOrders();
    }

    showSuccessModal(orderData) {
        const modal = document.getElementById('successModal');
        const orderDetails = document.getElementById('orderDetails');
        
        const sensorType = this.getSensorTypeName(orderData.sensorType);
        const pickupLocation = this.getPickupLocationName(orderData.pickupLocation);
        const sensorCfg = CONFIG.SENSORS[orderData.sensorType] || CONFIG.SENSORS[CONFIG.DEFAULT_SENSOR];
        const perSensorSavings = sensorCfg && sensorCfg.savings ? Number(sensorCfg.savings) : 0;
        const totalSavings = perSensorSavings * (parseInt(orderData.quantity) || 0);
        
        orderDetails.innerHTML = `
            <strong>Order Details:</strong><br>
            <strong>Name:</strong> ${orderData.name}<br>
            ${orderData.guardianName ? `<strong>Parent/Guardian:</strong> ${orderData.guardianName}<br>` : ''}
            <strong>Phone:</strong> ${orderData.phone}<br>
            <strong>Sensor:</strong> ${sensorType}<br>
            <strong>Quantity:</strong> ${orderData.quantity}<br>
            <strong>Total Amount:</strong> ₹${orderData.totalAmount.toLocaleString()}<br>
            ${perSensorSavings > 0 ? `<strong>You save:</strong> ₹${totalSavings.toLocaleString()} (₹${perSensorSavings.toLocaleString()} × ${orderData.quantity})<br>` : ''}
            <strong>Pickup:</strong> ${pickupLocation}<br>
            ${orderData.notes ? `<strong>Notes:</strong> ${orderData.notes}<br>` : ''}
        `;
        
        modal.style.display = 'block';
        document.body.style.overflow = 'hidden';
    }

    closeModal() {
        const modal = document.getElementById('successModal');
        modal.style.display = 'none';
        document.body.style.overflow = 'auto';
    }

    getSensorTypeName(type) {
        const sensor = CONFIG.SENSORS[type];
        if (sensor) {
            return `${sensor.name} (₹${sensor.price.toLocaleString()}/-)`;
        }
        return type;
    }

    getPickupLocationName(location) {
        return CONFIG.PICKUP_LOCATIONS[location] || location;
    }

    updateSummary() {
        const totalOrders = this.orders.length;
        const totalSensors = this.orders.reduce((sum, order) => sum + parseInt(order.quantity), 0);
        
        document.getElementById('totalOrders').textContent = totalOrders;
        document.getElementById('totalSensors').textContent = totalSensors;
        
        // Update last order time
        const lastOrderTimeElement = document.getElementById('lastOrderTime');
        if (this.orders.length > 0) {
            const lastOrder = this.orders[0]; // Most recent order is first in the array
            const lastOrderDate = new Date(lastOrder.timestamp);
            const timeAgo = this.getTimeAgo(lastOrderDate);
            lastOrderTimeElement.textContent = timeAgo;
        } else {
            lastOrderTimeElement.textContent = '-';
        }
    }

    calculateTotalSavings() {
        return this.orders.reduce((total, order) => {
            const sensorInfo = this.sensorPrices[order.sensorType];
            if (sensorInfo) {
                return total + (sensorInfo.savings * parseInt(order.quantity));
            }
            return total;
        }, 0);
    }

    renderOrders() {
        const ordersContainer = document.getElementById('ordersList');
        
        if (this.orders.length === 0) {
            ordersContainer.innerHTML = '<div class="no-orders">No orders yet. Be the first to order!</div>';
            return;
        }
        
        const ordersHTML = this.orders.slice(0, 10).map(order => {
            const sensorType = this.getSensorTypeName(order.sensorType);
            const pickupLocation = this.getPickupLocationName(order.pickupLocation);
            const timeAgo = this.getTimeAgo(new Date(order.timestamp));
            const placedAt = order.formattedTime || (order.timestamp ? new Date(order.timestamp).toLocaleString() : '');
            
            return `
                <div class="order-item">
                    <div class="order-item-header">
                        <span class="order-name">${order.name}</span>
                        <span class="order-time">${timeAgo}${placedAt ? ` · ${placedAt}` : ''}</span>
                    </div>
                    <div class="order-details">
                        ${sensorType} - ${order.quantity} quantity<br>
                        ${order.guardianName ? `Parent/Guardian: ${order.guardianName}<br>` : ''}
                        Amount: ₹${(order.totalAmount || (order.quantity * CONFIG.SENSORS[order.sensorType]?.price || CONFIG.SENSORS[CONFIG.DEFAULT_SENSOR].price)).toLocaleString()}<br>
                        ${placedAt ? `Placed: ${placedAt}<br>` : ''}
                        Pickup: ${pickupLocation}
                        ${order.notes ? `<br>Notes: ${order.notes}` : ''}
                    </div>
                </div>
            `;
        }).join('');
        
        ordersContainer.innerHTML = ordersHTML;
    }

    getTimeAgo(date) {
        const now = new Date();
        const diffInSeconds = Math.floor((now - date) / 1000);
        
        if (diffInSeconds < 60) return 'Just now';
        if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
        if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
        return `${Math.floor(diffInSeconds / 86400)}d ago`;
    }

    loadOrders() {
        const saved = localStorage.getItem('cgmOrders');
        return saved ? JSON.parse(saved) : [];
    }

    saveOrders() {
        localStorage.setItem('cgmOrders', JSON.stringify(this.orders));
    }

    // Export orders for admin use
    exportOrders() {
        const csvContent = this.generateCSV();
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `cgm-orders-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
    }

    generateCSV() {
        const headers = ['Name', 'Phone', 'Sensor Type', 'Quantity', 'Pickup Location', 'Notes', 'Emergency Contact', 'Order Date'];
        const rows = this.orders.map(order => [
            order.name,
            order.phone,
            this.getSensorTypeName(order.sensorType),
            order.quantity,
            this.getPickupLocationName(order.pickupLocation),
            order.notes || '',
            order.emergencyContact || '',
            new Date(order.timestamp).toLocaleDateString()
        ]);
        
        return [headers, ...rows]
            .map(row => row.map(cell => `"${cell}"`).join(','))
            .join('\n');
    }
}

// Copy UPI ID function
function copyUPI() {
    navigator.clipboard.writeText(CONFIG.UPI_ID).then(() => {
        const copyBtn = document.querySelector('.copy-btn');
        const originalText = copyBtn.innerHTML;
        copyBtn.innerHTML = '<i class="fas fa-check"></i>';
        copyBtn.style.background = '#48bb78';
        
        setTimeout(() => {
            copyBtn.innerHTML = originalText;
            copyBtn.style.background = '#4299e1';
        }, 2000);
    }).catch(err => {
        console.error('Failed to copy UPI ID:', err);
        alert(`UPI ID: ${CONFIG.UPI_ID}\n\nPlease copy manually.`);
    });
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing application...');
    
    try {
        window.cgmOrderManager = new CGMOrderManager();
        console.log('CGMOrderManager initialized successfully');
        
        // Add keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                window.cgmOrderManager.closeModal();
            }
        });
        
        // Add some helpful tooltips and animations
        addHelpfulFeatures();
        console.log('Application setup completed');
    } catch (error) {
        console.error('Error initializing application:', error);
    }
});

function addHelpfulFeatures() {
    // Add loading animation to submit button
    const submitBtn = document.querySelector('.submit-btn');
    submitBtn.addEventListener('click', function() {
        this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting...';
        this.disabled = true;
        
        setTimeout(() => {
            this.innerHTML = '<i class="fas fa-paper-plane"></i> Submit Order';
            this.disabled = false;
        }, 2000);
    });
    
    // Add hover effects to stat cards
    const statCards = document.querySelectorAll('.stat-card');
    statCards.forEach(card => {
        card.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-5px) scale(1.02)';
        });
        
        card.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(0) scale(1)';
        });
    });
    
    // Add form field focus effects
    const formFields = document.querySelectorAll('input, select, textarea');
    formFields.forEach(field => {
        field.addEventListener('focus', function() {
            this.parentNode.style.transform = 'translateX(5px)';
        });
        
        field.addEventListener('blur', function() {
            this.parentNode.style.transform = 'translateX(0)';
        });
    });
} 