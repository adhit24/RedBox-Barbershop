import type { StockistProduct } from '@/lib/stockistApi';

export type StandardCategory =
  | 'Pomade'
  | 'Parfume'
  | 'Perawatan Rambut'
  | 'Peralatan & Aksesoris'
  | 'Barang Pemakaian'
  | 'Perlengkapan'
  | 'Merchandise'
  | 'Lainnya';

export interface CategorySummary {
  category: StandardCategory;
  productCount: number;
  totalQuantity: number;
  brandCount: number;
  outOfStockCount: number;
  lowStockCount: number;
  safeStockCount: number;
  iconName: string;
}

export interface BrandGroup<T extends StockistProduct = StockistProduct> {
  brandName: string;
  products: T[];
  totalQuantity: number;
  outOfStockCount: number;
  lowStockCount: number;
}

export interface CategoryGroup<T extends StockistProduct = StockistProduct> {
  category: StandardCategory;
  iconName: string;
  totalQuantity: number;
  brands: BrandGroup<T>[];
  allProducts: T[];
}

export function getCategoryForProduct(p: StockistProduct): StandardCategory {
  const type = p.product_type || '';
  if (type === 'CONSUMABLE') return 'Perlengkapan';
  if (['SERVICE', 'SERVICE_CONSUMABLE', 'BOTH'].includes(type)) return 'Barang Pemakaian';

  const catAttr = (p.category || '').trim().toLowerCase();
  const name = (p.name || '').trim().toLowerCase();

  if (catAttr === 'pomade' || name.includes('pomade') || name.includes('clay') || name.includes('oilbase') || name.includes('waterbase') || name.includes('hair powder') || name.includes('wax')) {
    return 'Pomade';
  }
  if (catAttr === 'parfume' || catAttr === 'perfume' || name.includes('parfume') || name.includes('perfume') || name.includes('eau de') || name.includes('cologne') || name.includes('parfum')) {
    return 'Parfume';
  }
  if (catAttr.includes('hair') || name.includes('shampoo') || name.includes('tonic') || name.includes('spray') || name.includes('mousse') || name.includes('serum') || name.includes('hair food') || name.includes('bleaching') || name.includes('creambath')) {
    return 'Perawatan Rambut';
  }
  if (name.includes('sisir') || name.includes('clipper') || name.includes('razor') || name.includes('handuk') || name.includes('cape') || name.includes('gunting')) {
    return 'Peralatan & Aksesoris';
  }
  if (catAttr === 'merchandise' || name.includes('tumbler') || name.includes('card') || name.includes('member card')) {
    return 'Merchandise';
  }

  if (p.category && p.category.trim()) {
    const raw = p.category.trim();
    if (['Pomade', 'Parfume', 'Perawatan Rambut', 'Peralatan & Aksesoris', 'Barang Pemakaian', 'Perlengkapan', 'Merchandise'].includes(raw)) {
      return raw as StandardCategory;
    }
  }

  return 'Lainnya';
}

export function getBrandForProduct(p: StockistProduct): string {
  const name = (p.name || '').trim();
  const lowerName = name.toLowerCase();

  if (lowerName.includes('doctor dapper')) return 'Doctor Dapper Pomade';
  if (lowerName.includes('hairnerds')) return 'Hairnerds';
  if (lowerName.includes('his erha') || lowerName.includes('hiserha')) return 'HIS ERHA';
  if (lowerName.includes('mantology')) return 'MANTOLOGY';
  if (lowerName.includes('murray') || lowerName.includes('murrays')) return 'Murrays Pomade';
  if (lowerName.includes('redbox') || lowerName.includes('red box')) return 'Redbox Pomade';
  if (lowerName.includes('tezzen')) return 'Tezzen';
  if (lowerName.includes('barbara')) return 'Barbara';
  if (lowerName.includes('kenny')) return 'Kenny';
  if (lowerName.includes('gentle fever')) return 'Gentle Fever';
  if (lowerName.includes('nestle')) return 'Nestle';
  if (lowerName.includes('teh botol') || lowerName.includes('fruit tea') || lowerName.includes('tebs')) return 'Teh Botol / Drinks';

  if (p.brand && p.brand.trim() && p.brand.toLowerCase() !== 'unbranded') {
    return p.brand.trim();
  }

  const parts = name.split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0]} ${parts[1]}`;
  }
  if (parts.length === 1 && parts[0]) {
    return parts[0];
  }

  return 'Tanpa Merek';
}

export function getCategoryIcon(category: StandardCategory): string {
  switch (category) {
    case 'Pomade': return 'style';
    case 'Parfume': return 'local_fire_department';
    case 'Perawatan Rambut': return 'content_cut';
    case 'Peralatan & Aksesoris': return 'hardware';
    case 'Barang Pemakaian': return 'design_services';
    case 'Perlengkapan': return 'inventory_2';
    case 'Merchandise': return 'shopping_bag';
    default: return 'category';
  }
}

export function groupProductsByCategoryAndBrand<T extends StockistProduct & { qty: number; status: 'SAFE' | 'LOW' | 'OUT' }>(
  products: T[]
): Record<StandardCategory, CategoryGroup<T>> {
  const categories: Record<StandardCategory, CategoryGroup<T>> = {
    'Pomade': { category: 'Pomade', iconName: getCategoryIcon('Pomade'), totalQuantity: 0, brands: [], allProducts: [] },
    'Parfume': { category: 'Parfume', iconName: getCategoryIcon('Parfume'), totalQuantity: 0, brands: [], allProducts: [] },
    'Perawatan Rambut': { category: 'Perawatan Rambut', iconName: getCategoryIcon('Perawatan Rambut'), totalQuantity: 0, brands: [], allProducts: [] },
    'Peralatan & Aksesoris': { category: 'Peralatan & Aksesoris', iconName: getCategoryIcon('Peralatan & Aksesoris'), totalQuantity: 0, brands: [], allProducts: [] },
    'Barang Pemakaian': { category: 'Barang Pemakaian', iconName: getCategoryIcon('Barang Pemakaian'), totalQuantity: 0, brands: [], allProducts: [] },
    'Perlengkapan': { category: 'Perlengkapan', iconName: getCategoryIcon('Perlengkapan'), totalQuantity: 0, brands: [], allProducts: [] },
    'Merchandise': { category: 'Merchandise', iconName: getCategoryIcon('Merchandise'), totalQuantity: 0, brands: [], allProducts: [] },
    'Lainnya': { category: 'Lainnya', iconName: getCategoryIcon('Lainnya'), totalQuantity: 0, brands: [], allProducts: [] },
  };

  const brandMapByCat = new Map<StandardCategory, Map<string, T[]>>();

  for (const cat of Object.keys(categories) as StandardCategory[]) {
    brandMapByCat.set(cat, new Map<string, T[]>());
  }

  for (const product of products) {
    const cat = getCategoryForProduct(product);
    const brand = getBrandForProduct(product);
    const catGroup = categories[cat];

    catGroup.allProducts.push(product);
    catGroup.totalQuantity += product.qty;

    const bMap = brandMapByCat.get(cat)!;
    if (!bMap.has(brand)) {
      bMap.set(brand, []);
    }
    bMap.get(brand)!.push(product);
  }

  for (const [cat, bMap] of brandMapByCat.entries()) {
    const brandGroups: BrandGroup<T>[] = [];
    for (const [brandName, pList] of bMap.entries()) {
      let brandQty = 0;
      let outCount = 0;
      let lowCount = 0;
      for (const p of pList) {
        brandQty += p.qty;
        if (p.status === 'OUT') outCount++;
        if (p.status === 'LOW') lowCount++;
      }
      brandGroups.push({
        brandName,
        products: pList,
        totalQuantity: brandQty,
        outOfStockCount: outCount,
        lowStockCount: lowCount,
      });
    }

    brandGroups.sort((a, b) => a.brandName.localeCompare(b.brandName));
    categories[cat].brands = brandGroups;
  }

  return categories;
}
