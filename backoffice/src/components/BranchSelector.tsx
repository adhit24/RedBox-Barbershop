export function BranchSelector({
  value,
  branches,
  onChange,
}: {
  value: string;
  branches: { slug: string; name: string }[];
  onChange: (slug: string) => void;
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-sm">
      <span className="sr-only">Cabang</span>
      <select
        aria-label="Cabang"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-rb-button border border-rb-border bg-rb-surface px-3 py-2 text-sm text-rb-text-secondary outline-none focus:border-rb-red"
      >
        <option value="all">Semua Cabang</option>
        {branches.map((b) => (
          <option key={b.slug} value={b.slug}>
            {b.name}
          </option>
        ))}
      </select>
    </label>
  );
}
