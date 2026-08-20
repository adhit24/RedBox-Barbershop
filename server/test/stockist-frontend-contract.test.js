'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function readFrontend(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', relativePath), 'utf8');
}

test('BottomNavBar is a reusable, route-aware component with the expected API', () => {
  const source = readFrontend('components/ui/bottom-nav-bar.tsx');
  assert.match(source, /usePathname/);
  assert.match(source, /from ['"]next\/link['"]/);
  assert.match(source, /from ['"]lucide-react['"]/);
  assert.match(source, /from ['"]framer-motion['"]/);
  assert.match(source, /export function BottomNavBar/);
  assert.match(source, /items:\s*BottomNavItem\[\]/);
});

test('Stockist layout wires BottomNavBar with 5 branch-admin tabs including Permintaan and Riwayat', () => {
  const source = readFrontend('app/admin/stockist/layout.tsx');
  assert.match(source, /from ['"]@\/components\/ui\/bottom-nav-bar['"]/);
  assert.match(source, /<BottomNavBar/);
  assert.match(source, /href:\s*['"]\/admin\/stockist['"]/);
  assert.match(source, /href:\s*['"]\/admin\/stockist\/branch-stock['"]/);
  assert.match(source, /href:\s*['"]\/admin\/stockist\/transfers['"]/);
  assert.match(source, /href:\s*['"]\/admin\/stockist\/requests['"]/);
  assert.match(source, /href:\s*['"]\/admin\/stockist\/ledger['"]/);
  const branchAdminTabsBlock = source.slice(source.indexOf('branchAdminTabs'), source.indexOf('branchAdminTabs') + 500);
  const hrefCount = (branchAdminTabsBlock.match(/href:/g) || []).length;
  assert.equal(hrefCount, 5);
});
