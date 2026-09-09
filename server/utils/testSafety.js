'use strict';

/**
 * Production Mutation Guard for Tests and Automated Runs
 *
 * Prevents automated test suites or uncontrolled scripts from inadvertently
 * mutating production databases (Supabase, Moka POS, Fonnte, etc.).
 */

const KNOWN_PROD_PROJECT_REFS = [
  'zXzyWRuSjJbXYomkJ1ws8w', // example known ref if any
];

function isProductionUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return false;
  const lower = urlStr.toLowerCase();
  
  // Local or test mock URLs are safe
  if (lower.includes('localhost') || lower.includes('127.0.0.1') || lower.includes('supabase.test') || lower.includes('example.test')) {
    return false;
  }

  // Moka production API
  if (lower.includes('api.mokapos.com')) {
    return true;
  }

  // Known production project refs or hosted domain
  if (lower.includes('redboxbarbershop.com')) {
    return true;
  }

  // Remote Supabase instance in cloud
  if (lower.includes('supabase.co')) {
    return true;
  }

  return false;
}

function isProductionEnvironment() {
  if (process.env.VERCEL_ENV === 'production') return true;
  if (process.env.ENVIRONMENT === 'production') return true;
  if (process.env.IS_PRODUCTION === 'true') return true;
  return false;
}

function shouldRunLiveIntegrationTests() {
  return process.env.RUN_LIVE_INTEGRATION_TESTS === 'true';
}

function assertSafeTestEnvironment(options = {}) {
  const {
    operation = 'MUTATION',
    targetUrl = process.env.SUPABASE_URL || '',
    allowOverride = false,
  } = options;

  const isTest = process.env.NODE_ENV === 'test' || Boolean(process.env.NODE_TEST_CONTEXT);
  const targetIsProd = isProductionUrl(targetUrl) || isProductionEnvironment();
  const explicitAllowed = process.env.ALLOW_PRODUCTION_MUTATION === 'true' || (allowOverride && shouldRunLiveIntegrationTests());

  if (isTest && targetIsProd && !explicitAllowed) {
    throw new Error(
      `[CRITICAL TEST SAFETY GUARD] Blocked attempt to perform ${operation} against production environment (${targetUrl || 'production'}). ` +
      `Automated tests must mock external calls, use local fixtures, or run with isolated test environments. ` +
      `To explicitly bypass this safety check for live integration runs, set ALLOW_PRODUCTION_MUTATION=true and RUN_LIVE_INTEGRATION_TESTS=true.`
    );
  }
}

module.exports = {
  isProductionUrl,
  isProductionEnvironment,
  shouldRunLiveIntegrationTests,
  assertSafeTestEnvironment,
};
