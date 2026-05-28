'use strict';
// ============================================================
// MOKA POS  —  REST API Client
// Wraps all Moka API calls with auth, retry, and error enrichment.
// Base URL: https://api.mokapos.com  (override via MOKA_API_BASE)
// ============================================================

const { getAccessToken } = require('./oauth');

const MOKA_API_BASE = process.env.MOKA_API_BASE || 'https://api.mokapos.com';
const MAX_RETRIES   = 3;
const RETRY_DELAYS  = [500, 2000, 8000]; // ms — exponential-ish backoff
const FETCH_TIMEOUT = 30000; // 30 seconds timeout for Moka API calls

class MokaClient {
  /**
   * @param {import('@supabase/supabase-js').SupabaseClient} supabase
   * @param {string} outletId   - our DB outlet UUID
   * @param {string} mokaOutletId - Moka's own outlet identifier
   */
  constructor(supabase, outletId, mokaOutletId) {
    this._supabase     = supabase;
    this._outletId     = outletId;
    this._mokaOutletId = mokaOutletId || process.env.MOKA_OUTLET_ID || '';
  }

  // ── ORDERS ────────────────────────────────────────────────

  /**
   * Fetch orders since a given timestamp (used by cron sync).
   * @param {object} opts
   * @param {string}  [opts.updatedSince] - ISO8601 timestamp
   * @param {number}  [opts.limit=100]
   * @param {number}  [opts.page=1]
   */
  async getOrders({ updatedSince, limit = 100 } = {}) {
    // Uses Report API (v3) to pull completed transactions for Moka → Web sync.
    // Docs: GET /v3/outlets/{outlet_id}/reports/get_latest_transactions
    // Spec params: per_page (not limit), since (float Epoch, not ISO string), no page param
    const qs = new URLSearchParams({ per_page: String(limit) });
    if (updatedSince) {
      // BUG FIX: spec param name is 'since' (not 'updated_since'), type is float Unix Epoch seconds
      const epoch = Math.floor(new Date(updatedSince).getTime() / 1000);
      qs.set('since', String(epoch));
    }
    return this._req('GET', `/v3/outlets/${this._mokaOutletId}/reports/get_latest_transactions?${qs}`);
  }

  /**
   * Create an order in Moka via Advanced Ordering API (Flow A: web → Moka).
   * Docs: POST /v1/outlets/{outlet_id}/advanced_orderings/orders
   * Payload shape: see _buildMokaOrderPayload() in sync.js
   * @param {object} payload
   */
  async createOrder(payload) {
    return this._req('POST', `/v1/outlets/${this._mokaOutletId}/advanced_orderings/orders`, payload);
  }

  /**
   * Fetch a single Advanced Order by Moka's internal order ID.
   * Docs: GET /v1/outlets/{outlet_id}/advanced_orderings/orders/{order_id}
   * @param {string} mokaOrderId
   */
  async getOrder(mokaOrderId) {
    return this._req('GET', `/v1/outlets/${this._mokaOutletId}/advanced_orderings/orders/${mokaOrderId}`);
  }

  /**
   * BUG FIX: GET /v1/advanced_orderings/orders does NOT exist in Moka API spec
   * (only POST exists for that path). Walk-in pending slots are covered by
   * getOpenBills() via sync_bills API. This method is a no-op stub.
   */
  async getPendingOrders() {
    return { data: [] };
  }

  /**
   * Fetch open (PENDING) walk-in bills from Moka POS for a date range.
   * Used to block slots when a cashier creates a GoShow bill directly in the POS.
   * Docs: GET /v1/outlets/{outlet_id}/sync_bills/?statuses=PENDING&start=DD/MM/YYYY&end=DD/MM/YYYY
   *
   * IMPORTANT: `start`/`end` filter by bill *creation date* (not appointment date).
   * Advance bills (e.g. created Friday for Saturday) require a wider lookback window.
   *
   * @param {string} startDateStr - 'YYYY-MM-DD'
   * @param {string} [endDateStr] - 'YYYY-MM-DD', defaults to startDateStr
   */
  async getOpenBills(startDateStr, endDateStr = null) {
    const toFmt = (s) => { const [y, m, d] = (s || '').split('-'); return `${d}/${m}/${y}`; };
    const startFmt = toFmt(startDateStr || new Date().toISOString().slice(0, 10));
    const endFmt   = toFmt(endDateStr   || startDateStr || new Date().toISOString().slice(0, 10));
    const qs = new URLSearchParams({ statuses: 'PENDING', start: startFmt, end: endFmt, per_page: '200', deep: 'true' });
    return this._req('GET', `/v1/outlets/${this._mokaOutletId}/sync_bills?${qs}`);
  }

  /**
   * Cancel an Advanced Order (cashier hasn't accepted yet).
   * Docs: POST /v1/outlets/{outlet_id}/advanced_orderings/orders/{order_id}/cancel
   * @param {string} mokaOrderId
   * @param {string} reason  - e.g. "CUSTOMER#Customer requested cancellation"
   */
  async cancelOrder(mokaOrderId, reason = 'CUSTOMER#Cancelled by customer') {
    return this._req('POST',
      `/v1/outlets/${this._mokaOutletId}/advanced_orderings/orders/${mokaOrderId}/cancel`,
      { cancel_reason: reason });
  }

  /**
   * @deprecated Use cancelOrder() directly. PATCH endpoint not in Moka API spec.
   */
  async updateOrder(mokaOrderId, patch) {
    if (patch?.status === 'CANCELLED') {
      return this.cancelOrder(mokaOrderId);
    }
    // BUG FIX: PATCH /advanced_orderings/orders/{id} is not in Moka API spec — skip silently
    console.warn(`[MokaClient] updateOrder() with non-cancel patch ignored (PATCH not in API spec)`);
    return null;
  }

  // ── CUSTOMERS ─────────────────────────────────────────────

  /**
   * Fetch one page of customers from Moka business API.
   * NOTE: This endpoint returns 404 for client_credentials tokens.
   * Use getTransactionPage() + extract customer fields instead.
   * @param {{ page?: number, perPage?: number }} opts
   */
  async getCustomers({ page = 1, perPage = 100 } = {}) {
    const businessId = process.env.MOKA_BUSINESS_ID || this._mokaOutletId;
    const qs = new URLSearchParams({ page: String(page), per_page: String(perPage) });
    return this._req('GET', `/v1/businesses/${businessId}/customers?${qs}`);
  }

  /**
   * Fetch one page of transactions from v3 report API.
   * Customer data (customer_id, customer_name, customer_phone, customer_email)
   * is embedded in each payment — use this to build the customer list.
   * @param {{ sinceEpoch?: number|null, limit?: number }} opts
   */
  async getTransactionPage({ sinceEpoch = null, limit = 100 } = {}) {
    const qs = new URLSearchParams({ per_page: String(limit) });
    if (sinceEpoch !== null) qs.set('since', String(sinceEpoch));
    return this._req('GET', `/v3/outlets/${this._mokaOutletId}/reports/get_latest_transactions?${qs}`);
  }

  /**
   * Discover the correct Moka business/outlet ID by probing multiple endpoints.
   * Returns raw responses from each probe so caller can extract the correct ID.
   */
  async discoverBusinessId() {
    const results = {};
    const envOutletId = process.env.MOKA_OUTLET_ID || null;
    const ids = [...new Set([this._mokaOutletId, envOutletId].filter(Boolean))];

    const probes = [];
    for (const id of ids) {
      // v3 report — this is the endpoint used by order sync (most likely to work)
      probes.push({ key: `v3_report_${id}`, path: `/v3/outlets/${id}/reports/get_latest_transactions?per_page=1` });
      // v1 customer endpoints
      probes.push({ key: `v1_customers_${id}`,   path: `/v1/outlets/${id}/customers?page=1&per_page=5` });
      probes.push({ key: `v1_businesses_${id}`,  path: `/v1/businesses/${id}/customers?page=1&per_page=5` });
      // v3 customer variants
      probes.push({ key: `v3_customers_${id}`,   path: `/v3/outlets/${id}/customers?page=1&per_page=5` });
    }
    // generic profile probes
    probes.push({ key: 'v1_profile', path: '/v1/profile' });
    probes.push({ key: 'v2_profile', path: '/v2/profile' });

    for (const { key, path } of probes) {
      try {
        results[key] = await this._req('GET', path);
      } catch (err) {
        results[key] = { error: err.message, status: err.status };
      }
    }
    return results;
  }

  /**
   * BUG FIX: POST /v2/outlets/{id}/customers does NOT exist in Moka API spec.
   * Customer identity is conveyed via customer_name + customer_phone_number in
   * the order payload — no separate customer creation step needed.
   */
  async upsertCustomer(_payload) {
    return null;
  }

  /**
   * BUG FIX: GET /v2/outlets/{id}/customers does NOT exist in Moka API spec.
   * @deprecated — use getCustomers() for business-level customer list
   */
  async findCustomerByPhone(_phoneE164) {
    return null;
  }

  // ── PRODUCTS / ITEMS ──────────────────────────────────────

  /**
   * Fetch the outlet's item list (for service→Moka item mapping).
   */
  async getItems() {
    // BUG FIX: include_variants is not a valid param per spec; item_variants are returned by default
    return this._req('GET', `/v1/outlets/${this._mokaOutletId}/items`);
  }

  /**
   * Create a POS checkout so the transaction appears in Moka Produk Terjual.
   * Docs: POST /v1/outlets/{outlet_id}/checkouts
   * Scope required: checkout_api (included in ALL_SCOPES for client credentials)
   * @param {object} payload - CheckoutApi payload
   */
  async createCheckout(payload) {
    return this._req('POST', `/v1/outlets/${this._mokaOutletId}/checkouts`, payload);
  }

  // ── FEEDBACK / REVIEW ──────────────────────────────────────

  /**
   * Submit customer feedback/review to Moka CRM Feedback system.
   * This allows reviews submitted on RedBox website to also appear in Moka dashboard.
   * 
   * Endpoint: POST /v1/outlets/{outlet_id}/feedback (undocumented, using common pattern)
   * Alternative: POST /v1/feedback
   * 
   * @param {object} feedbackData
   * @param {string} feedbackData.customer_name - Customer name
   * @param {string} feedbackData.customer_phone - Phone number (normalized +62)
   * @param {number} feedbackData.rating - Rating 1-5 (Good: 4-5, Bad: 1-3)
   * @param {string} feedbackData.comment - Review comment
   * @param {string} [feedbackData.order_id] - Optional Moka order ID to link review
   * @param {string} [feedbackData.source] - Source of review (default: 'website')
   */
  async submitFeedback(feedbackData) {
    const payload = {
      outlet_id: this._mokaOutletId,
      customer_name: feedbackData.customer_name,
      customer_phone: feedbackData.customer_phone,
      rating: feedbackData.rating >= 4 ? 'GOOD' : 'BAD', // Moka uses GOOD/BAD
      comment: feedbackData.comment,
      order_id: feedbackData.order_id || null,
      source: feedbackData.source || 'website',
      created_at: new Date().toISOString(),
    };

    // Try multiple endpoint patterns (Moka API documentation is limited)
    const endpoints = [
      `/v1/outlets/${this._mokaOutletId}/feedback`,
      `/v1/outlets/${this._mokaOutletId}/reviews`,
      `/v1/feedback`,
    ];

    for (const endpoint of endpoints) {
      try {
        const result = await this._req('POST', endpoint, payload);
        return { success: true, endpoint, data: result };
      } catch (err) {
        // 404 means endpoint doesn't exist, try next
        if (err.status === 404 || err.status === 405) {
          console.warn(`[MokaClient] Feedback endpoint ${endpoint} not available: ${err.message}`);
          continue;
        }
        // 403 means insufficient scope, try next
        if (err.status === 403) {
          console.warn(`[MokaClient] Feedback endpoint ${endpoint} forbidden: ${err.message}`);
          continue;
        }
        // Other errors - return the error
        return { success: false, endpoint, error: err.message, status: err.status };
      }
    }

    // All endpoints failed
    return { 
      success: false, 
      error: 'Moka feedback API not available - all endpoints returned 404/403',
      attempted: endpoints 
    };
  }

  // ── PRIVATE ───────────────────────────────────────────────

  async _req(method, path, body = null, attempt = 0) {
    const token = await getAccessToken(this._supabase, this._outletId);
    const url   = `${MOKA_API_BASE}${path}`;

    let res;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
      
      res = await fetch(url, {
        method,
        headers: {
          Authorization:  `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept:         'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
    } catch (networkErr) {
      if (networkErr.name === 'AbortError') {
        return this._handleRetry(method, path, body, attempt, new Error('Request timeout'));
      }
      return this._handleRetry(method, path, body, attempt, networkErr);
    }

    // Parse response body
    const text = await res.text().catch(() => '');
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

    // 401 → token may have been revoked; do NOT retry (caller should re-auth)
    if (res.status === 401) {
      throw Object.assign(
        new Error(`Moka 401 — re-authorize the outlet`),
        { status: 401, code: 'MOKA_UNAUTHORIZED', details: data }
      );
    }

    // 429 / 5xx → retry with backoff
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES - 1) {
      return this._handleRetry(method, path, body, attempt, null, res.status);
    }

    if (!res.ok) {
      throw Object.assign(
        new Error(`Moka API ${method} ${path} → ${res.status}`),
        { status: res.status, code: 'MOKA_API_ERROR', details: data }
      );
    }

    return data;
  }

  // ── Business Methods ─────────────────────────────────────

  /**
   * BUG FIX: GET /v2/outlets/{id}/customers does not exist in Moka API spec.
   * Returns passthrough so callers still get customer_name/phone for the order payload.
   */
  async createCustomer(customerData) {
    return { customer_name: customerData.customer_name, phone: customerData.phone };
  }

  async _handleRetry(method, path, body, attempt, networkErr, httpStatus) {
    const delay = RETRY_DELAYS[attempt] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
    const reason = networkErr ? networkErr.message : `HTTP ${httpStatus}`;
    console.warn(`[MokaClient] Retry ${attempt + 1}/${MAX_RETRIES} for ${method} ${path} (${reason}) in ${delay}ms`);
    await _sleep(delay);
    return this._req(method, path, body, attempt + 1);
  }
}

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = MokaClient;
