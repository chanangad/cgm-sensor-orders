// CGM Sensor Group Order Management System

// Order names come from whatever a submitter typed, so anything interpolated
// into innerHTML has to be escaped first.
function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

class CGMOrderManager {
    constructor() {
        this.orders = this.loadOrders();
        this.sensorPrices = CONFIG.SENSORS;
        this.ordersEnabled = true;
        // Set from CONFIG.ACTIVE_PAYEE once the page is set up; while false no
        // order may be submitted, because there is nowhere valid to pay.
        this.payeeConfigured = true;

        this.init();
    }

    init() {
        this.setupEventListeners();
        this.updateSummary();
        this.renderOrders();
        this.maybeFetchServerOrders();
        this.maybeFetchServerSummary();
        this.applyDeliveryCycleLabel();
        this.applyConfiguredContent();
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
                    let resp = await this.postToScriptWithFallback({ action: 'toggleOrders', enabled: desiredEnabled, password });
                    if (resp && resp.opaque) {
                        // The response could not be read cross-origin, so confirm
                        // the change by reading the status back instead.
                        const status = await this.readFromScript({ action: 'getStatus' });
                        const applied = !!(status && status.success && !!status.ordersEnabled === desiredEnabled);
                        resp = applied
                            ? { success: true, ordersEnabled: desiredEnabled }
                            : { success: false, error: 'Could not confirm the change. Check the admin password and try again.' };
                    }
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

    // The coordinator collecting payments for this run, or null when
    // CONFIG.ACTIVE_PAYEE names nobody usable. A payee is usable with a name and
    // at least one way to pay them — a UPI ID, a QR image, or both.
    getActivePayee() {
        const key = CONFIG.ACTIVE_PAYEE;
        const payee = CONFIG.PAYEES && CONFIG.PAYEES[key];
        if (!payee) {
            console.error(`CONFIG.ACTIVE_PAYEE "${key}" is not a key of CONFIG.PAYEES`);
            return null;
        }
        const filled = (field) => !!payee[field] && !/fill in/i.test(payee[field]);
        if (!filled('name')) {
            console.error(`Payee "${key}" has no name`);
            return null;
        }
        if (!filled('upiId') && !filled('qrImage')) {
            console.error(`Payee "${key}" has neither a UPI ID nor a QR image — nobody can pay them`);
            return null;
        }
        return {
            key,
            name: payee.name,
            upiId: filled('upiId') ? payee.upiId : '',
            qrImage: filled('qrImage') ? payee.qrImage : ''
        };
    }

    applyConfiguredContent() {
        const yearEl = document.getElementById('footerYear');
        if (yearEl) yearEl.textContent = new Date().getFullYear();

        // Payee details live in config.js only, so the name shown, the ID
        // displayed, the ID the copy button copies and the QR code can never
        // drift apart.
        const payee = this.getActivePayee();
        this.payeeConfigured = !!payee;
        if (!payee) {
            this.showPayeeMisconfigured();
            return;
        }

        const nameEl = document.getElementById('upiPayeeName');
        if (nameEl) nameEl.textContent = payee.name;

        // Show only the payment methods this payee actually has.
        const upiValueEl = document.getElementById('upiValue');
        if (upiValueEl) upiValueEl.textContent = payee.upiId;
        const upiIdRow = document.getElementById('upiIdRow');
        if (upiIdRow) upiIdRow.style.display = payee.upiId ? '' : 'none';

        const qrSection = document.getElementById('qrSection');
        if (qrSection) qrSection.style.display = payee.qrImage ? '' : 'none';
        const qrEl = document.getElementById('upiQrImage');
        if (qrEl && payee.qrImage) {
            qrEl.src = payee.qrImage;
            qrEl.alt = `UPI QR code for ${payee.name}`;
        }
    }

    // Showing a placeholder UPI ID would send real money nowhere, so hide the
    // payment details entirely and stop the order instead.
    showPayeeMisconfigured() {
        const upiDetails = document.querySelector('.upi-details');
        if (upiDetails) {
            upiDetails.innerHTML = '<div class="limit-warning" style="flex:1;color:#ef4444;background:#fee2e2;padding:0.75rem;border-radius:8px;font-weight:700;border:1px solid #fecaca;">Payment details are not configured. Please contact the coordinators on the Diabuddies of Karnataka WhatsApp group before paying.</div>';
        }
        const submitBtn = document.querySelector('.submit-btn');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.style.opacity = '0.5';
            submitBtn.style.cursor = 'not-allowed';
        }
    }

    async fetchOrderStatus() {
        try {
            const resp = await this.readFromScript({ action: 'getStatus' });
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
        if (!res.ok) {
            const httpError = new Error('HTTP ' + res.status);
            httpError.httpError = true;
            throw httpError;
        }
        return res.json();
    }

    // POST that still delivers the request when the browser refuses to let us
    // read the response (GitHub Pages -> Apps Script). The caller must confirm
    // the outcome another way when `opaque` comes back true.
    async postToScriptWithFallback(payload) {
        try {
            return await this.postToScript(payload);
        } catch (err) {
            if (err && err.httpError) throw err;
            await fetch(CONFIG.GOOGLE_SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(payload),
                mode: 'no-cors'
            });
            return { success: true, opaque: true };
        }
    }

    // Read-only request over JSONP, for hosts where a readable POST is not possible.
    jsonp(params, timeoutMs = 10000) {
        return new Promise((resolve, reject) => {
            const cbName = `__cgm_cb_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
            let script = null;
            let timer = null;
            const cleanup = () => {
                if (timer) clearTimeout(timer);
                try { delete window[cbName]; } catch (_) { window[cbName] = undefined; }
                if (script && script.parentNode) script.parentNode.removeChild(script);
            };
            window[cbName] = (data) => { cleanup(); resolve(data); };
            const qs = Object.keys(params)
                .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
                .join('&');
            script = document.createElement('script');
            script.src = `${CONFIG.GOOGLE_SCRIPT_URL}?${qs}&callback=${encodeURIComponent(cbName)}`;
            script.onerror = () => { cleanup(); reject(new Error('Request failed')); };
            timer = setTimeout(() => { cleanup(); reject(new Error('Request timed out')); }, timeoutMs);
            (document.body || document.head).appendChild(script);
        });
    }

    // Apps Script answers a readable cross-origin POST, so prefer it everywhere.
    // JSONP stays as the fallback for hosts where that stops being true.
    async readFromScript(payload) {
        try { return await this.postToScript(payload); } catch (_) { return await this.jsonp(payload); }
    }

    generateOrderId() {
        return `ord_${Date.now()}_${Math.floor(Math.random() * 1e9).toString(36)}`;
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
            submitBtn.style.background = 'var(--danger)';
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
                    savingsLine.style.display = 'inline-block';
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

                    if (submitBtn && this.payeeConfigured) {
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

    readFileAsBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const result = String(reader.result || '');
                const comma = result.indexOf(',');
                resolve(comma >= 0 ? result.slice(comma + 1) : result);
            };
            reader.onerror = () => reject(new Error('Could not read the screenshot file. Please try again.'));
            reader.readAsDataURL(file);
        });
    }

    async submitOrderToServer(file, orderData) {
        const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;
        if (!file) throw new Error('Payment screenshot is required.');
        if (file.size > MAX_SCREENSHOT_BYTES) {
            throw new Error('Payment screenshot is too large (max 8 MB). Please upload a smaller image.');
        }

        const base64Data = await this.readFileAsBase64(file);
        const payload = {
            action: 'submitOrder',
            orderId: orderData.orderId,
            screenshot: base64Data,
            filename: (file && file.name) ? file.name : `order_${orderData.name}_${Date.now()}.png`,
            mimeType: (file && file.type) ? file.type : 'image/png',
            orderDetails: orderData
        };

        const resp = await this.postToScriptWithFallback(payload);

        if (resp && resp.opaque) {
            // The response was unreadable, so check the server actually recorded
            // the order before telling someone who has already paid that it worked.
            const confirmed = await this.verifyOrderRecorded(orderData.orderId);
            if (!confirmed) {
                throw new Error('We could not confirm your order was received. Please do NOT pay again — message the Diabuddies of Karnataka WhatsApp group with your payment screenshot.');
            }
            return { success: true, verified: true };
        }

        if (!resp || resp.success !== true) {
            throw new Error((resp && resp.error) || 'Order submission failed. Please retry.');
        }
        return resp;
    }

    async verifyOrderRecorded(orderId, attempts = 6, delayMs = 2000) {
        if (!orderId) return false;
        for (let i = 0; i < attempts; i++) {
            await new Promise(r => setTimeout(r, i === 0 ? 1500 : delayMs));
            try {
                const resp = await this.jsonp({ action: 'checkOrder', orderId });
                if (resp && resp.success && resp.found) return true;
            } catch (_) {
                // keep polling until we run out of attempts
            }
        }
        return false;
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

        const activePayee = this.getActivePayee();
        if (!activePayee) {
            alert('Payment details are not configured. Please contact the coordinators before paying.');
            return;
        }

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

        // Stamp the order before sending it so a retried or duplicated request
        // can be recognised and ignored by the server.
        orderData.id = Date.now();
        orderData.orderId = this.generateOrderId();
        orderData.timestamp = new Date().toISOString();
        orderData.formattedTime = new Date().toLocaleString();
        // Sent so the confirmation email can name the collection schedule
        orderData.deliveryCycle = (CONFIG.DELIVERY_CYCLE || '').toString().trim();
        orderData.nextRunDate = (CONFIG.NEXT_RUN_DATE || '').toString().trim();
        // Who this payment was meant for, so the server can check the screenshot
        // against the right name and record who collected it.
        orderData.payee = activePayee.key;
        orderData.payeeName = activePayee.name;

        const screenshotFile = (paymentScreenshot && paymentScreenshot.files) ? paymentScreenshot.files[0] : null;
        try {
            const result = await this.submitOrderToServer(screenshotFile, orderData);
            const uploaded = (result && result.upload) || null;
            orderData.paymentProofUrl = (uploaded && uploaded.fileUrl) || (result && result.fileUrl) || '';
            if (result && result.sheet && result.sheet.ok === false) {
                console.warn('Sheets append failed:', result.sheet.error);
            }
        } catch (error) {
            console.error('Order submission failed:', error);
            alert(error && error.message ? error.message : 'Order submission failed. Please retry.');
            if (submitBtn) {
                submitBtn.innerHTML = originalBtnText;
                submitBtn.disabled = false;
            }
            return;
        }

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
        if (CONFIG.USE_SERVER_ORDERS) {
            // The visible list belongs to the server; refresh it rather than
            // replacing it with this browser's local history.
            this.maybeFetchServerOrders();
            this.maybeFetchServerSummary();
        } else {
            this.updateSummary();
            this.renderOrders();
        }
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
            const itemsHtml = items.map(i => `<li>${escapeHtml(i.name)} × ${escapeHtml(i.qty)} — ₹${escapeHtml(Number(i.subtotal || 0).toLocaleString())}</li>`).join('');

            details.innerHTML = `
                <p><strong>Name:</strong> ${escapeHtml(orderData.name)}</p>
                <p><strong>Items:</strong></p>
                <ul style="margin: 0.5rem 0 0.5rem 1.25rem; list-style: disc;">${itemsHtml}</ul>
                <p><strong>Amount Paid:</strong> ₹${escapeHtml(Number(orderData.totalAmount || 0).toLocaleString())}</p>
                <p><strong>Pickup:</strong> ${escapeHtml(locationName)}</p>
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

    // The server stores what was ordered as one string ("Linx ×1, Patch ×2").
    // Split it back into items so each can be shown on its own.
    parseItemsSummary(summary) {
        return String(summary || '')
            .split(',')
            .map(part => part.trim())
            .filter(Boolean)
            .map(part => {
                const m = part.match(/^(.*?)\s*[×xX]\s*(\d+)$/);
                return m ? { name: m[1].trim(), qty: Number(m[2]) } : { name: part, qty: null };
            });
    }

    // Matches a product name from the sheet back to its config entry.
    findSensorByName(name) {
        const sensors = CONFIG.SENSORS || {};
        const key = Object.keys(sensors).find(k => sensors[k].name === name);
        return key ? sensors[key] : null;
    }

    // 'Linx/VitaTok Patch' is accurate but unreadable in a list; config.js can
    // give any product a shorter label for this one purpose.
    shortItemLabel(name) {
        const sensor = this.findSensorByName(name);
        return sensor ? (sensor.shortName || sensor.name) : name;
    }

    renderItemChips(items, fallbackQty) {
        if (!items || !items.length) return '';
        // A row saved before quantities were itemised carries its count separately.
        if (items.length === 1 && items[0].qty === null && fallbackQty) {
            items = [{ name: items[0].name, qty: Number(fallbackQty) }];
        }
        return items.map(i => {
            const sensor = this.findSensorByName(i.name);
            // Accessories (patches) are played down so the sensors read first.
            // An unrecognised product is treated as a sensor rather than hidden.
            const accessory = sensor ? sensor.isSensor === false : false;
            const cls = accessory ? 'order-chip order-chip--accessory' : 'order-chip';
            const label = escapeHtml(this.shortItemLabel(i.name));
            const qty = i.qty ? `<span class="order-chip-qty">×${escapeHtml(i.qty)}</span>` : '';
            return `<span class="${cls}">${label}${qty}</span>`;
        }).join('');
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
            const items = (order.items && Array.isArray(order.items))
                ? order.items.map(i => ({ name: i.name, qty: i.qty }))
                : this.parseItemsSummary(this.getSensorTypeName(order.sensorType));
            return `
                <div class="order-item">
                    <div class="order-info">
                        <div class="order-name">${escapeHtml(order.name)}</div>
                        <div class="order-time">${escapeHtml(this.getTimeAgo(new Date(order.timestamp)))}</div>
                    </div>
                    <div class="order-details-text">
                        ${this.renderItemChips(items, order.quantity)}
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

    // Returns '' rather than a guess when a row carries no usable date — showing
    // every old order as "just now" is worse than showing no time at all.
    toIsoOrEmpty(value) {
        if (!value) return '';
        const d = new Date(value);
        return isNaN(d.getTime()) ? '' : d.toISOString();
    }

    mapServerOrders(rawOrders) {
        return rawOrders.map(o => ({
            name: o.name,
            sensorType: o.sensorType || '',
            quantity: Number(o.quantity || 0),
            totalSensors: Number(o.totalSensors || 0),
            timestamp: this.toIsoOrEmpty(o.timestamp),
        }));
    }

    async maybeFetchServerOrders() {
        if (!CONFIG.USE_SERVER_ORDERS) return;
        try {
            const resp = await this.readFromScript({ action: 'getRecentOrders', limit: CONFIG.ORDERS_FETCH_LIMIT || 10 });
            if (resp && resp.success && Array.isArray(resp.orders)) {
                this.renderServerOrders(this.mapServerOrders(resp.orders));
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
            if (order.timestamp) {
                try {
                    placedAt = new Date(order.timestamp).toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: 'numeric',
                        hour12: true
                    });
                } catch (e) {
                    placedAt = '';
                }
            }

            const items = (order.items && Array.isArray(order.items))
                ? order.items.map(i => ({ name: i.name, qty: i.qty }))
                : this.parseItemsSummary(sensorType);

            return `
                <div class="order-item">
                    <div class="order-info">
                        <div class="order-name">${escapeHtml(order.name)}</div>
                        <div class="order-time">${escapeHtml(placedAt)}</div>
                    </div>
                    <div class="order-details-text">
                        ${this.renderItemChips(items, order.quantity)}
                    </div>
                </div>
            `;
        }).join('');
        ordersContainer.innerHTML = html;
    }

    async maybeFetchServerSummary() {
        if (!CONFIG.USE_SERVER_ORDERS) return;
        try {
            const resp = await this.readFromScript({ action: 'getSummary' });
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
            if (!isNaN(d.getTime())) lastOrderTimeEl.textContent = this.getTimeAgo(d);
        }
    }
}

// Copy UPI ID function
function copyUPI() {
    if (!CONFIG.UPI_ID) return;   // this payee is paid by QR only
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
    // Hover and focus treatments live in styles.css. They used to be applied
    // here as inline transforms, which shifted each field 5px sideways on
    // focus and fought the focus ring.
}