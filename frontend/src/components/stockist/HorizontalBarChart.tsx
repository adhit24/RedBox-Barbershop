'use client';

import { BarChart, Bar, XAxis, YAxis, Cell, ResponsiveContainer, Tooltip } from 'recharts';

export interface HorizontalBarChartDatum {
  name: string;
  value: number;
}

const formatCurrencyCompact = (value: number | undefined): string => {
  if (value === undefined) return '';
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    notation: 'compact',
  }).format(value);
};

export function HorizontalBarChart({ data }: { data: HorizontalBarChartDatum[] }) {
  return (
    <div className="h-[220px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, bottom: 4, left: 4 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" width={92} tick={{ fill: '#B8AAAC', fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip
            formatter={(value) => formatCurrencyCompact(value as number | undefined)}
            contentStyle={{ background: '#211B1C', border: '1px solid #302728', borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: '#F5EEEE' }}
            cursor={{ fill: 'rgba(199,40,32,0.08)' }}
          />
          <Bar dataKey="value" radius={[0, 6, 6, 0]} animationDuration={600} animationEasing="ease-out">
            {data.map((entry) => (
              <Cell key={entry.name} fill="#C72820" />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
