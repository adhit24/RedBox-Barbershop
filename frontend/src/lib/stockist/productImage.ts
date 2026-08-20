// A small set of RedBox's actual retail product photos, matched by name
// substring. This only covers the original handful of retail SKUs it was
// built for — everything else (barang pemakaian, perlengkapan, and any
// unmatched retail product) has no real photo available, and callers
// should fall back to a neutral icon placeholder rather than guess.
const KNOWN_PRODUCT_IMAGES: Array<{ match: (lowerName: string) => boolean; path: string }> = [
  { match: (n) => n.includes('clay') || n.includes('pomade'), path: '/api/stockist/product-image/clay.jpeg' },
  { match: (n) => n.includes('oil'), path: '/api/stockist/product-image/oil_base.jpeg' },
  { match: (n) => n.includes('water') || n.includes('spray'), path: '/api/stockist/product-image/water_base.jpeg' },
  { match: (n) => n.includes('shave') || n.includes('cream') || n.includes('psyi'), path: '/api/stockist/product-image/psyi.jpeg' },
];

export function getKnownProductImage(name: string): string | null {
  const lower = name.toLowerCase();
  const hit = KNOWN_PRODUCT_IMAGES.find((entry) => entry.match(lower));
  return hit ? hit.path : null;
}
