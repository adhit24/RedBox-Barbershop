'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const css = fs.readFileSync(path.join(__dirname, '..', '..', 'css', 'dashboard.css'), 'utf8');

test('activation modal provides its own mobile scroll area', () => {
  const modal = css.match(/\.activation-modal\{([^}]*)\}/)?.[1] || '';
  const box = css.match(/\.modal-box\{([^}]*)\}/)?.[1] || '';

  assert.match(modal, /overflow-y\s*:\s*auto/);
  assert.match(box, /max-height\s*:/);
  assert.match(box, /overflow-y\s*:\s*auto/);
});
