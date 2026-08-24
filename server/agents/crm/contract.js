'use strict';

/**
 * Redbox CRM Agent v0.1 Contract & Capability Schema
 */

const CONTRACT_VERSION = 'customer360.v0.1';

const CRM_TOOLS = [
  'get_customer_profile',
  'get_customer_history',
  'get_points',
  'get_membership',
  'get_customer_preferences',
  'get_visit_summary',
  'get_transaction_summary',
];

const PROJECTION_TYPES = {
  CUSTOMER_SELF: 'CUSTOMER_SELF',
  INTERNAL: 'INTERNAL',
};

module.exports = {
  CONTRACT_VERSION,
  CRM_TOOLS,
  PROJECTION_TYPES,
};
