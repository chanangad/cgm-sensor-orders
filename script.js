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
        this.maybeFetchServerOrders();
        this.maybeFetchServerSummary();
        this.applyDeliveryCycleLabel();
    }

    setupEventListeners() {
        console.log('Setting up event listeners...');

        const form = document.getElementById('orderForm');
        const modal = document.getElementById('successModal');
        const closeModal = document.getElementById('closeModal');
        const orderToggle = document.getElementById('orderToggle');
        const adminLoginBtn = document.getElementById('adminLoginBtn');

        if (form) {
            form.addEventListener('submit', (e) => {
                console.log('Form submit event triggered');
                e.preventDefault();
                this.handleFormSubmit(e);
            });
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

        // Product picker listeners are set up in populateSensorOptions()
    }

    applyDeliveryCycleLabel() {
        const el = document.getElementById('deliveryCycle');
        const inlineEls = document.querySelectorAll('.deliveryCycleInline');
        const infoEls = document.querySelectorAll('.deliveryCycleInlineInfo');
        const ordersCloseEl = document.getElementById('ordersCloseInline');
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
        // Header uses NEXT_RUN_DATE + DELIVERY_CYCLE; info section should only show DELIVERY_CYCLE
        inlineEls.forEach(n => { n.textContent = dateText; });
        infoEls.forEach(n => { n.textContent = label; });
        if (ordersCloseEl) {
            const closeLabel = (typeof CONFIG !== 'undefined' && CONFIG.ORDER_CLOSES_DATE && String(CONFIG.ORDER_CLOSES_DATE).trim()) ? String(CONFIG.ORDER_CLOSES_DATE).trim() : '';
            ordersCloseEl.textContent = closeLabel || 'TBA';
        }
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
            this.showFieldError(field, 'This field is required');
            return false;
        }

        if (field.type === 'tel' && value) {
            const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/;
            if (!phoneRegex.test(value.replace(/\s/g, ''))) {
                this.showFieldError(field, 'Please enter a valid phone number');
                return false;
            }
        }

        if (field.type === 'number' && value) {
            const num = parseInt(value);
            if (num < 1 || num > 10) {
                this.showFieldError(field, 'Quantity must be between 1 and 10');
                return false;
            }
        }

        if (field.type === 'file') {
            if (field.hasAttribute('required') && field.files.length === 0) {
                this.showFieldError(field, 'Payment screenshot is required');
                return false;
            }
        }

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
                overlay.innerHTML = '<div class="disabled-message"><i class="ph-fill ph-pause-circle" style="font-size: 3rem; margin-bottom: 1rem; display:block;"></i><br>Currently not accepting orders</div>';
                formContainer.appendChild(overlay);
            }
        } else {
            form.style.opacity = '1';
            form.style.pointerEvents = 'auto';
            submitBtn.innerHTML = '<i class="ph-bold ph-paper-plane-right"></i> Submit Order';
            submitBtn.style.background = '';
            formContainer.style.position = '';

            // Remove disabled overlay
            const overlay = formContainer.querySelector('.disabled-overlay');
            if (overlay) {
                overlay.remove();
            }
        }
    }

    getCartItems() {
        const items = [];
        Object.entries(CONFIG.SENSORS).forEach(([key, sensor]) => {
            const input = document.getElementById(`qty-${key}`);
            const qty = input ? (parseInt(input.value) || 0) : 0;
            if (qty > 0) {
                items.push({ key, name: sensor.name, qty, price: sensor.price, subtotal: qty * sensor.price, isSensor: sensor.isSensor !== false, savings: (sensor.savings || 0) * qty });
            }
        });
        return items;
    }

    updatePaymentSection() {
        const paymentSection = document.getElementById('paymentSection');
        const totalAmountElement = document.getElementById('totalAmount');
        const savingsLine = document.getElementById('savingsLine');
        const savingsValue = document.getElementById('savingsValue');

        if (paymentSection && totalAmountElement) {
            const items = this.getCartItems();
            const totalAmount = items.reduce((sum, i) => sum + i.subtotal, 0);
            const totalSavings = items.reduce((sum, i) => sum + i.savings, 0);

            if (totalAmount > 0) {
                totalAmountElement.textContent = `₹${totalAmount.toLocaleString()}`;
                if (totalSavings > 0 && savingsLine && savingsValue) {
                    savingsValue.textContent = `₹${totalSavings.toLocaleString()}`;
                    savingsLine.style.display = 'block';
                } else if (savingsLine) {
                    savingsLine.style.display = 'none';
                }

                // Check for max order limit
                const limitWarning = document.getElementById('limitWarning');
                const submitBtn = document.querySelector('.submit-btn');

                if (CONFIG.MAX_ORDER_AMOUNT && totalAmount > CONFIG.MAX_ORDER_AMOUNT) {
                    if (!limitWarning) {
                        const warning = document.createElement('div');
                        warning.id = 'limitWarning';
                        warning.className = 'limit-warning';
                        warning.style.color = '#ef4444';
                        warning.style.background = '#fee2e2';
                        warning.style.padding = '0.75rem';
                        warning.style.borderRadius = '8px';
                        warning.style.marginTop = '1rem';
                        warning.style.fontWeight = '700';
                        warning.style.border = '1px solid #fecaca';
                        warning.textContent = `Maximum order amount is ₹${CONFIG.MAX_ORDER_AMOUNT.toLocaleString()}. Please reduce quantity.`;
                        totalAmountElement.parentNode.parentNode.appendChild(warning);
                    } else {
                        limitWarning.style.display = 'block';
                    }

                    // Hide payment details so they don't pay!
                    const upiDetails = document.querySelector('.upi-details');
                    const paymentInstructions = document.querySelector('.payment-instructions');
                    const screenshotGroup = document.getElementById('paymentScreenshot')?.closest('.form-group');

                    if (upiDetails) upiDetails.style.display = 'none';
                    if (paymentInstructions) paymentInstructions.style.display = 'none';
                    if (screenshotGroup) screenshotGroup.style.display = 'none';
                    totalAmountElement.style.color = '#ef4444';

                    if (submitBtn) {
                        submitBtn.disabled = true;
                        submitBtn.style.opacity = '0.5';
                        submitBtn.style.cursor = 'not-allowed';
                    }
                } else {
                    if (limitWarning) limitWarning.style.display = 'none';

                    // Show payment details back
                    const upiDetails = document.querySelector('.upi-details');
                    const paymentInstructions = document.querySelector('.payment-instructions');
                    const screenshotGroup = document.getElementById('paymentScreenshot')?.closest('.form-group');

                    if (upiDetails) upiDetails.style.display = 'flex';
                    if (paymentInstructions) paymentInstructions.style.display = 'block';
                    if (screenshotGroup) screenshotGroup.style.display = 'block';
                    totalAmountElement.style.color = '';

                    if (submitBtn) {
                        submitBtn.disabled = false;
                        submitBtn.style.opacity = '1';
                        submitBtn.style.cursor = 'pointer';
                    }
                }

                paymentSection.style.display = 'block';
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
        logoutBtn.innerHTML = '<i class="ph-bold ph-sign-out"></i> Logout';
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
        const picker = document.getElementById('productPicker');
        if (!picker) return;

        picker.innerHTML = '';

        Object.entries(CONFIG.SENSORS).forEach(([key, sensor]) => {
            const row = document.createElement('div');
            row.className = 'product-row';
            row.innerHTML = `
                <div class="product-info">
                    <span class="product-name">${sensor.name}</span>
                    <span class="product-price">₹${sensor.price.toLocaleString()}/-</span>
                </div>
                <div class="qty-stepper">
                    <button type="button" class="qty-btn qty-minus" data-key="${key}">−</button>
                    <input type="number" id="qty-${key}" class="qty-input" value="0" min="0" max="99" data-key="${key}">
                    <button type="button" class="qty-btn qty-plus" data-key="${key}">+</button>
                </div>
            `;
            picker.appendChild(row);
        });

        // Attach stepper listeners
        picker.querySelectorAll('.qty-minus').forEach(btn => {
            btn.addEventListener('click', () => {
                const input = document.getElementById(`qty-${btn.dataset.key}`);
                const cur = parseInt(input.value) || 0;
                if (cur > 0) input.value = cur - 1;
                this.updatePaymentSection();
            });
        });

        picker.querySelectorAll('.qty-plus').forEach(btn => {
            btn.addEventListener('click', () => {
                const input = document.getElementById(`qty-${btn.dataset.key}`);
                const cur = parseInt(input.value) || 0;
                input.value = cur + 1;
                this.updatePaymentSection();
            });
        });

        picker.querySelectorAll('.qty-input').forEach(input => {
            input.addEventListener('input', () => {
                this.updatePaymentSection();
            });
        });
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

        // Collect cart items
        const items = this.getCartItems();
        if (items.length === 0) {
            alert('Please select at least one item.');
            return;
        }
        orderData.items = items;
        orderData.totalAmount = items.reduce((s, i) => s + i.subtotal, 0);

        // Check for max order limit
        if (CONFIG.MAX_ORDER_AMOUNT && orderData.totalAmount > CONFIG.MAX_ORDER_AMOUNT) {
            alert(`Order value cannot exceed ₹${CONFIG.MAX_ORDER_AMOUNT.toLocaleString()}. Please reduce the quantity.`);
            return;
        }

        // Build a legacy-friendly sensorType + quantity for backend compatibility
        orderData.sensorType = items.map(i => i.name).join(', ');
        orderData.quantity = items.reduce((s, i) => s + i.qty, 0);

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
        if (!paymentScreenshot || (paymentScreenshot.files && paymentScreenshot.files.length === 0)) {
            const paymentSection = document.getElementById('paymentSection');
            if (paymentSection && paymentSection.style.display !== 'none') {
                this.showFieldError(paymentScreenshot, 'Payment screenshot is required');
                return;
            }
        }

        if (!isValid) {
            return;
        }

        // Update button state to loading
        const submitBtn = form.querySelector('.submit-btn');
        const originalBtnText = submitBtn.innerHTML;
        if (submitBtn) {
            submitBtn.innerHTML = '<i class="ph-bold ph-spinner ph-spin"></i> Submitting...';
            submitBtn.disabled = true;
        }

        // Upload screenshot to Google Drive (mandatory)
        if (paymentScreenshot && paymentScreenshot.files && paymentScreenshot.files.length > 0) {
            try {
                const uploadResult = await this.uploadToGoogleDrive(paymentScreenshot.files[0], orderData);
                if (uploadResult) {
                    const directUrl = uploadResult.fileUrl;
                    const nestedUrl = uploadResult.upload && uploadResult.upload.fileUrl;
                    orderData.paymentProofUrl = directUrl || nestedUrl || '';
                    if (uploadResult.sheet && uploadResult.sheet.ok === false) {
                        console.warn('Sheets append failed:', uploadResult.sheet.error);
                    }
                }
            } catch (error) {
                console.error('Upload failed:', error);
                alert('Screenshot upload failed. Please retry.');
                if (submitBtn) {
                    submitBtn.innerHTML = originalBtnText;
                    submitBtn.disabled = false;
                }
                return;
            }
        }

        // Add timestamp and ID
        orderData.id = Date.now();
        orderData.timestamp = new Date().toISOString();
        orderData.formattedTime = new Date().toLocaleString();

        // Save order
        this.addOrder(orderData);

        // Show success modal
        this.showSuccessModal(orderData);

        // Reset form and product picker quantities
        form.reset();
        document.querySelectorAll('.qty-input').forEach(input => input.value = '0');
        this.updatePaymentSection();

        // Reset button state after success
        if (submitBtn) {
            submitBtn.innerHTML = originalBtnText;
            submitBtn.disabled = false;
        }
    }

    addOrder(orderData) {
        this.orders.unshift(orderData);
        this.saveOrders();
        this.updateSummary();
        this.renderOrders();
    }

    closeModal() {
        const modal = document.getElementById('successModal');
        if (modal) {
            modal.style.display = 'none';
            // Clean up modal content
            const details = document.getElementById('orderDetails');
            if (details) details.innerHTML = '';
        }
    }

    showSuccessModal(orderData) {
        const modal = document.getElementById('successModal');
        const details = document.getElementById('orderDetails');

        if (modal && details) {
            const locationName = this.getPickupLocationName(orderData.pickupLocation);
            const items = orderData.items || [];
            const itemsHtml = items.map(i => `<li>${i.name} × ${i.qty} — ₹${i.subtotal.toLocaleString()}</li>`).join('');

            details.innerHTML = `
                <p><strong>Name:</strong> ${orderData.name}</p>
                <p><strong>Items:</strong></p>
                <ul style="margin: 0.5rem 0 0.5rem 1.25rem; list-style: disc;">${itemsHtml}</ul>
                <p><strong>Amount Paid:</strong> ₹${orderData.totalAmount.toLocaleString()}</p>
                <p><strong>Pickup:</strong> ${locationName}</p>
                <hr style="margin: 1rem 0; border: 0; border-top: 1px solid #e2e8f0;">
                <p style="font-size: 0.85rem; color: #64748b;">
                    Please keep this screenshot/ID for your reference.
                </p>
            `;

            modal.style.display = 'block';
        }
    }

    getSensorTypeName(type) {
        if (!type) return '';
        const sensor = CONFIG.SENSORS[type];
        return sensor ? sensor.name : type;
    }

    getPickupLocationName(location) {
        if (!location) return '';
        return CONFIG.PICKUP_LOCATIONS[location] || location;
    }

    updateSummary() {
        const totalOrders = this.orders.length;
        // Count only sensors (isSensor: true), not patches
        const totalSensors = this.orders.reduce((sum, order) => {
            if (order.items && Array.isArray(order.items)) {
                return sum + order.items.filter(i => i.isSensor !== false).reduce((s, i) => s + i.qty, 0);
            }
            return sum + (parseInt(order.quantity) || 0);
        }, 0);

        const totalOrdersEl = document.getElementById('totalOrders');
        const totalSensorsEl = document.getElementById('totalSensors');
        const lastOrderTimeEl = document.getElementById('lastOrderTime');

        if (totalOrdersEl) totalOrdersEl.textContent = totalOrders;
        if (totalSensorsEl) totalSensorsEl.textContent = totalSensors;

        if (lastOrderTimeEl && this.orders.length > 0) {
            const lastOrder = this.orders[0];
            const lastOrderDate = new Date(lastOrder.timestamp);
            lastOrderTimeEl.textContent = this.getTimeAgo(lastOrderDate);
        } else if (lastOrderTimeEl) {
            lastOrderTimeEl.textContent = '-';
        }
    }

    renderOrders() {
        // If using server orders, we might skip rendering local orders to main list
        // unless we want to show them before server fetch returns
        const container = document.getElementById('ordersList');
        if (!container) return;

        if (this.orders.length === 0) {
            container.innerHTML = '<div class="no-orders">No orders yet. Be the first to order!</div>';
            return;
        }

        const html = this.orders.slice(0, 10).map(order => {
            const itemsSummary = (order.items && Array.isArray(order.items))
                ? order.items.map(i => `${i.name} ×${i.qty}`).join(', ')
                : `${this.getSensorTypeName(order.sensorType)} (x${order.quantity})`;
            return `
                <div class="order-item">
                    <div class="order-info">
                        <div class="order-name">${order.name}</div>
                        <div class="order-time">${this.getTimeAgo(new Date(order.timestamp))}</div>
                    </div>
                    <div class="order-details-text">
                        ${itemsSummary}
                    </div>
                </div>
            `;
        }).join('');

        container.innerHTML = html;
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

    async maybeFetchServerOrders() {
        if (!CONFIG.USE_SERVER_ORDERS) return;
        const isProd = window.location.hostname.endsWith('github.io');
        if (isProd) {
            this.fetchRecentOrdersJsonp(CONFIG.ORDERS_FETCH_LIMIT || 10);
            return;
        }
        try {
            const resp = await this.postToScript({ action: 'getRecentOrders', limit: CONFIG.ORDERS_FETCH_LIMIT || 10 });
            if (resp && resp.success && Array.isArray(resp.orders)) {
                const mapped = resp.orders.map(o => ({
                    name: o.name,
                    guardianName: o.guardianName || '',
                    phone: o.phone || '',
                    sensorType: o.sensorType || CONFIG.DEFAULT_SENSOR,
                    quantity: Number(o.quantity || 0),
                    pickupLocation: o.pickupLocation || 'cubbon-park',
                    totalAmount: Number(o.totalAmount || 0),
                    timestamp: o.timestamp ? new Date(o.timestamp).toISOString() : new Date().toISOString(),
                }));
                this.renderServerOrders(mapped);
            }
        } catch (_) { }
    }

    renderServerOrders(serverOrders) {
        const ordersContainer = document.getElementById('ordersList');
        if (!ordersContainer) return;
        if (!serverOrders || serverOrders.length === 0) return;
        const html = serverOrders.slice(0, CONFIG.ORDERS_FETCH_LIMIT || 10).map(order => {
            const sensorType = this.getSensorTypeName(order.sensorType);
            // Format date to be shorter: "Nov 27, 9:26 AM"
            let placedAt = '';
            try {
                placedAt = new Date(order.timestamp).toLocaleString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: 'numeric',
                    hour12: true
                });
            } catch (e) {
                placedAt = new Date(order.timestamp).toLocaleString();
            }

            const itemsSummary = (order.items && Array.isArray(order.items))
                ? order.items.map(i => `${i.name} ×${i.qty}`).join(', ')
                : `${sensorType} (x${order.quantity})`;

            return `
                <div class="order-item">
                    <div class="order-info">
                        <div class="order-name">${order.name}</div>
                        <div class="order-time">${placedAt}</div>
                    </div>
                    <div class="order-details-text">
                        ${itemsSummary}
                    </div>
                </div>
            `;
        }).join('');
        ordersContainer.innerHTML = html;
    }

    fetchRecentOrdersJsonp(limit) {
        const cbName = `__orders_cb_${Date.now()}`;
        const cleanup = () => {
            try { delete window[cbName]; } catch (_) { }
            if (script && script.parentNode) script.parentNode.removeChild(script);
        };
        window[cbName] = (data) => {
            try {
                if (data && data.success && Array.isArray(data.orders)) {
                    const mapped = data.orders.map(o => ({
                        name: o.name,
                        guardianName: o.guardianName || '',
                        phone: o.phone || '',
                        sensorType: o.sensorType || CONFIG.DEFAULT_SENSOR,
                        quantity: Number(o.quantity || 0),
                        pickupLocation: o.pickupLocation || 'cubbon-park',
                        totalAmount: Number(o.totalAmount || 0),
                        timestamp: o.timestamp ? new Date(o.timestamp).toISOString() : new Date().toISOString(),
                    }));
                    this.renderServerOrders(mapped);
                }
            } finally {
                cleanup();
            }
        };
        const script = document.createElement('script');
        const url = `${CONFIG.GOOGLE_SCRIPT_URL}?action=getRecentOrders&limit=${encodeURIComponent(limit)}&callback=${encodeURIComponent(cbName)}`;
        script.src = url;
        script.onerror = cleanup;
        document.body.appendChild(script);
        setTimeout(cleanup, 8000);
    }

    async maybeFetchServerSummary() {
        if (!CONFIG.USE_SERVER_ORDERS) return;
        const isProd = window.location.hostname.endsWith('github.io');
        if (isProd) {
            this.fetchSummaryJsonp();
            return;
        }
        try {
            const resp = await this.postToScript({ action: 'getSummary' });
            if (resp && resp.success) this.applyServerSummary(resp);
        } catch (_) { }
    }

    applyServerSummary(summary) {
        const totalOrdersEl = document.getElementById('totalOrders');
        const totalSensorsEl = document.getElementById('totalSensors');
        const lastOrderTimeEl = document.getElementById('lastOrderTime');
        if (typeof summary.totalOrders === 'number' && totalOrdersEl) totalOrdersEl.textContent = summary.totalOrders;
        if (typeof summary.totalSensors === 'number' && totalSensorsEl) totalSensorsEl.textContent = summary.totalSensors;
        if (summary.lastOrderTimestamp && lastOrderTimeEl) {
            const d = new Date(summary.lastOrderTimestamp);
            lastOrderTimeEl.textContent = this.getTimeAgo(d);
        }
    }

    fetchSummaryJsonp() {
        const cbName = `__summary_cb_${Date.now()}`;
        const cleanup = () => {
            try { delete window[cbName]; } catch (_) { }
            if (script && script.parentNode) script.parentNode.removeChild(script);
        };
        window[cbName] = (data) => {
            try {
                if (data && data.success) this.applyServerSummary(data);
            } finally {
                cleanup();
            }
        };
        const script = document.createElement('script');
        const url = `${CONFIG.GOOGLE_SCRIPT_URL}?action=getSummary&callback=${encodeURIComponent(cbName)}`;
        script.src = url;
        script.onerror = cleanup;
        document.body.appendChild(script);
        setTimeout(cleanup, 8000);
    }
}

// Copy UPI ID function
function copyUPI() {
    navigator.clipboard.writeText(CONFIG.UPI_ID).then(() => {
        const copyBtn = document.querySelector('.copy-btn');
        const originalText = copyBtn.innerHTML;
        copyBtn.innerHTML = '<i class="ph-bold ph-check"></i>';
        copyBtn.style.background = '#10b981';

        setTimeout(() => {
            copyBtn.innerHTML = originalText;
            copyBtn.style.background = '';
        }, 2000);
    }).catch(err => {
        console.error('Failed to copy UPI ID:', err);
        alert(`UPI ID: ${CONFIG.UPI_ID}\n\nPlease copy manually.`);
    });
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Scroll indicator logic - Independent
    const handleScroll = () => {
        if (window.scrollY > 50) {
            document.body.classList.add('scrolled');
        } else {
            document.body.classList.remove('scrolled');
        }
    };

    window.addEventListener('scroll', handleScroll);
    // Trigger immediately in case page is already scrolled
    handleScroll();

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
    // Add loading animation logic handled by handleFormSubmit
    // Removed the timeout-based reset that was here previously to prevent early reset

    // Add hover effects to stat cards
    const statCards = document.querySelectorAll('.stat-card');
    statCards.forEach(card => {
        card.addEventListener('mouseenter', function () {
            this.style.transform = 'translateY(-5px) scale(1.02)';
        });

        card.addEventListener('mouseleave', function () {
            this.style.transform = 'translateY(0) scale(1)';
        });
    });

    // Add form field focus effects
    const formFields = document.querySelectorAll('input, select, textarea');
    formFields.forEach(field => {
        field.addEventListener('focus', function () {
            this.parentNode.style.transform = 'translateX(5px)';
        });

        field.addEventListener('blur', function () {
            this.parentNode.style.transform = 'translateX(0)';
        });
    });
}