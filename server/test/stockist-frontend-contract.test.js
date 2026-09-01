'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function readFrontend(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', relativePath), 'utf8');
}

function frontendPublicAsset(relativePath) {
  return path.join(__dirname, '..', '..', 'frontend', 'public', relativePath);
}

test('Stockist login, loading transition, and header use the approved RedBox brand assets', () => {
  const login = readFrontend('app/admin/stockist/login/page.tsx');
  const layout = readFrontend('app/admin/stockist/layout.tsx');
  const transition = readFrontend('components/auth/PremiumLoginTransition.tsx');

  assert.ok(fs.existsSync(frontendPublicAsset('Brand_assets/logo_hitam_trnsparan.png')));
  assert.ok(fs.existsSync(frontendPublicAsset('Brand_assets/wordmark_hitam.png')));
  assert.match(login, /logo_hitam_trnsparan\.png/);
  assert.match(login, /wordmark_hitam\.png/);
  assert.match(transition, /logo_hitam_trnsparan\.png/);
  assert.match(transition, /wordmark_hitam\.png/);
  assert.match(layout, /wordmark_hitam\.png/);
});

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

test('Stok Saya dashboard replaces the catalog-first layout with summary cards', () => {
  const source = readFrontend('app/admin/stockist/branch-stock/page.tsx');
  assert.match(source, /Stok Habis/);
  assert.match(source, /Stok Menipis/);
  assert.match(source, /Barang Masuk/);
  assert.match(source, /Barang Pemakaian/);
  assert.match(source, /Semua Stok/);
  assert.match(source, /Mulai Pakai/);
  assert.doesNotMatch(source, /Buka Barang/);
  assert.doesNotMatch(source, /Cari produk atau SKU/);
});

test('Semua Stok page has search, bottom-sheet filter, and a Perlengkapan (CONSUMABLE) option', () => {
  const source = readFrontend('app/admin/stockist/branch-stock/all/page.tsx');
  assert.match(source, /Cari produk atau SKU/);
  assert.match(source, /Perlengkapan/);
  assert.match(source, /CONSUMABLE/);
  assert.match(source, /Terapkan Filter/);
  assert.match(source, /from ['"]@\/components\/stockist\/BottomSheet['"]/);
});

test('Riwayat page renders scoped ledger entries without a branch selector', () => {
  const source = readFrontend('app/admin/stockist/ledger/page.tsx');
  assert.match(source, /getInventoryLedger/);
  assert.doesNotMatch(source, /Pilih Cabang/);
});

test('Semua Stok supports Category and Brand hierarchy grouping and dedicated category views', () => {
  const source = readFrontend('app/admin/stockist/branch-stock/all/page.tsx');
  assert.match(source, /groupProductsByCategoryAndBrand/);
  assert.match(source, /CATEGORIES_LIST/);
  assert.match(source, /categoryGroups/);
  assert.match(source, /selectedCategory/);
});

