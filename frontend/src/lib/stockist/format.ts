// Shared currency formatters for the Stockist owner dashboard.
//
// `formatCurrency` renders full-notation IDR (e.g. "Rp 1.250.000.000") and is
// used wherever there's room for the full string (hero stat card, location
// list rows). `formatCurrencyCompact` renders compact notation (e.g. "Rp 1,25
// M") and is used in tighter spaces — the 2-up KPI grid cards and the
// horizontal bar chart tooltip — where full notation risks overflow.

export function formatCurrency(value: number | null): string {
  if (value === null) return 'Tidak tersedia';
  return new Intl.NumberFormat('id-ID', {
    style: 'currency', currency: 'IDR', minimumFractionDigits: 0,
  }).format(value);
}

export function formatCurrencyCompact(value: number | undefined): string {
  if (value === undefined) return '';
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    notation: 'compact',
  }).format(value);
}
