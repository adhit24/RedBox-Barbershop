'use client';

import Link from 'next/link';
import { getKnownProductImage } from '@/lib/stockist/productImage';

export interface ProductAttentionRowData {
  key: string;
  name: string;
  meta: string;
  statusLabel: string;
  severity: 'danger' | 'warning';
  trailing: string;
  trailingUnit: string;
  href?: string;
  onClick?: () => void;
}

const SEVERITY_BADGE: Record<ProductAttentionRowData['severity'], string> = {
  danger: 'bg-tint-danger text-danger',
  warning: 'bg-tint-warning text-warning',
};

const SEVERITY_TEXT: Record<ProductAttentionRowData['severity'], string> = {
  danger: 'text-danger',
  warning: 'text-warning',
};

function ProductAttentionRowBody({ row }: { row: ProductAttentionRowData }) {
  const image = getKnownProductImage(row.name);
  return (
    <>
      <span
        className="w-14 h-14 shrink-0 rounded-xl bg-surface-container-high border border-border-base bg-contain bg-no-repeat bg-center p-1 flex items-center justify-center"
        style={image ? { backgroundImage: `url(${image})` } : undefined}
      >
        {!image && <span className="material-symbols-outlined text-text-muted text-[22px]">inventory_2</span>}
      </span>
      <div className="flex flex-col gap-1 min-w-0 flex-1">
        <span className="text-[13px] font-bold text-text-primary leading-tight truncate">{row.name}</span>
        <span className="text-[10px] text-text-muted tabular-nums truncate">{row.meta}</span>
        <span className={`self-start text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${SEVERITY_BADGE[row.severity]}`}>
          {row.statusLabel}
        </span>
      </div>
      <div className="flex flex-col items-end gap-0.5 shrink-0">
        <span className={`text-[17px] font-extrabold tabular-nums leading-none ${SEVERITY_TEXT[row.severity]}`}>{row.trailing}</span>
        <span className="text-[9px] font-bold text-text-muted uppercase">{row.trailingUnit}</span>
      </div>
    </>
  );
}

export function ProductAttentionRow({ row }: { row: ProductAttentionRowData }) {
  const className =
    'w-full flex items-center gap-3 p-3 rounded-2xl border border-border-base bg-surface-elevated hover:border-danger/40 transition-colors text-left';
  if (row.href) {
    return (
      <Link href={row.href} className={className}>
        <ProductAttentionRowBody row={row} />
      </Link>
    );
  }
  return (
    <button type="button" onClick={row.onClick} className={className}>
      <ProductAttentionRowBody row={row} />
    </button>
  );
}
