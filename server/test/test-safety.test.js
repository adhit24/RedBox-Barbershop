'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  isProductionUrl,
  assertSafeTestEnvironment,
} = require('../utils/testSafety');

test('testSafety: identifies production and non-production URLs accurately', () => {
  assert.equal(isProductionUrl('http://127.0.0.1:54321'), false);
  assert.equal(isProductionUrl('http://localhost:3000'), false);
  assert.equal(isProductionUrl('https://example.test/api'), false);

  assert.equal(isProductionUrl('https://api.mokapos.com/v1/orders'), true);
  assert.equal(isProductionUrl('https://xyz.supabase.co'), true);
  assert.equal(isProductionUrl('https://www.redboxbarbershop.com/api'), true);
});

test('testSafety: assertSafeTestEnvironment blocks production mutation during NODE_ENV=test', () => {
  const origEnv = process.env.NODE_ENV;
  const origAllow = process.env.ALLOW_PRODUCTION_MUTATION;

  try {
    process.env.NODE_ENV = 'test';
    delete process.env.ALLOW_PRODUCTION_MUTATION;

    // Local target should not throw
    assert.doesNotThrow(() => {
      assertSafeTestEnvironment({
        operation: 'INSERT',
        targetUrl: 'http://127.0.0.1:54321',
      });
    });

    // Production target should throw
    assert.throws(
      () => {
        assertSafeTestEnvironment({
          operation: 'INSERT',
          targetUrl: 'https://xyz.supabase.co',
        });
      },
      /CRITICAL TEST SAFETY GUARD/
    );

    // Allowing mutation with flag should not throw
    process.env.ALLOW_PRODUCTION_MUTATION = 'true';
    assert.doesNotThrow(() => {
      assertSafeTestEnvironment({
        operation: 'INSERT',
        targetUrl: 'https://xyz.supabase.co',
      });
    });
  } finally {
    process.env.NODE_ENV = origEnv;
    if (origAllow !== undefined) {
      process.env.ALLOW_PRODUCTION_MUTATION = origAllow;
    } else {
      delete process.env.ALLOW_PRODUCTION_MUTATION;
    }
  }
});
