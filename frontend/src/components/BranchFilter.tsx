'use client';
import { BRANCHES, type BranchKey } from '@/lib/constants';

interface Props {
  value: BranchKey;
  onChange: (branch: BranchKey) => void;
}

export function BranchFilter({ value, onChange }: Props) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {BRANCHES.map((b) => (
        <button
          key={b.key}
          onClick={() => onChange(b.key)}
          className={`px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
            value === b.key
              ? 'bg-red-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          {b.label}
        </button>
      ))}
    </div>
  );
}
