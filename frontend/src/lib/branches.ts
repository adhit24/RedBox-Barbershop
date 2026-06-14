// frontend/src/lib/branches.ts
export interface BranchDef {
  slug: string;
  label: string;
}

// Slug HARUS sama dengan kolom barbers.branch / outlets.slug
export const BRANCHES: BranchDef[] = [
  { slug: 'bypass',    label: 'Bypass' },
  { slug: 'sumber',    label: 'Sumber' },
  { slug: 'samadikun', label: 'Samadikun' },
  { slug: 'csb',       label: 'CSB Mall' },
  { slug: 'tegal',     label: 'Tegal' },
];

export function branchLabel(slug: string | null | undefined): string {
  if (!slug) return '';
  return BRANCHES.find(b => b.slug === slug)?.label ?? slug;
}
