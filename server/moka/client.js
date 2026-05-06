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
  async getOrders({ updatedSince, limit = 100, page = 1 } = {}) {
    // Uses Report API (v3) to pull completed transactions for Moka → Web sync.
    // Docs: GET /v3/outlets/{outlet_id}/reports/get_latest_transactions
    const qs = new URLSearchParams({ limit: String(limit), page: String(page) });
    if (updatedSince) qs.set('updated_since', updatedSince);
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
   * @deprecated Use cancelOrder() instead — kept for backward compat
   */
  async updateOrder(mokaOrderId, patch) {
    if (patch?.status === 'CANCELLED') {
      return this.cancelOrder(mokaOrderId);
    }
    return this._req('PATCH', `/v1/outlets/${this._mokaOutletId}/advanced_orderings/orders/${mokaOrderId}`, patch);
  }

  // ── CUSTOMERS ─────────────────────────────────────────────

  /**
   * Upsert a customer in Moka. Returns Moka customer object.
   * @param {{ name:string, phone:string, email?:string }} payload
   */
  async upsertCustomer(payload) {
    return this._req('POST', `/v2/outlets/${this._mokaOutletId}/customers`, payload);
  }

  /**
   * Find a Moka customer by phone number.
   * @param {string} phoneE164
   */
  async findCustomerByPhone(phoneE164) {
    const qs = new URLSearchParams({ phone: phoneE164 });
    return this._req('GET', `/v2/outlets/${this._mokaOutletId}/customers?${qs}`);
  }

  // ── PRODUCTS / ITEMS ──────────────────────────────────────

  /**
   * Fetch the outlet's item list (for service→Moka item mapping).
   */
  async getItems() {
    return this._req('GET', `/v1/outlets/${this._mokaOutletId}/items`);
  }

  // ── PRIVATE ───────────────────────────────────────────────

  async _req(method, path, body = null, attempt = 0) {
    const token = await getAccessToken(this._supabase, this._outletId);
    const url   = `${MOKA_API_BASE}${path}`;

    let res;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization:  `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept:         'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (networkErr) {
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
   * Create or update customer in Moka
   */
  async createCustomer(customerData) {
    // Try to find existing customer by phone first
    if (customerData.phone) {
      try {
        const existing = await this._req('GET', `/v2/customers?phone=${encodeURIComponent(customerData.phone)}`);
        if (existing.data && existing.data.length > 0) {
          // Update existing customer
          const customerId = existing.data[0].id;
          return await this._req('PUT', `/v2/customers/${customerId}`, customerData);
        }
      } catch (e) {
        // Customer not found, continue to create new
      }
    }
    
    // Create new customer
    return await this._req('POST', '/v2/customers', customerData);
  }
  
  /**
   * Create order/transaction in Moka
   */
  async createOrder(orderData) {
    // Try different endpoints based on API version
    try {
      // First try v2 orders
      return await this._req('POST', `/v2/outlets/${this._mokaOutletId}/orders`, orderData);
    } catch (e) {
      try {
        // Fallback to v1 advanced_orderings
        return await this._req('POST', `/v1/outlets/${this._mokaOutletId}/advanced_orderings/orders`, orderData);
      } catch (e2) {
        try {
          // Last fallback to v1 transactions
          return await this._req('POST', `/v1/outlets/${this._mokaOutletId}/transactions`, orderData);
        } catch (e3) {
          throw new Error(`Failed to create order with all endpoints: ${e3.message}`);
        }
      }
    }
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
