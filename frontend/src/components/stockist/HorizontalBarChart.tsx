'use client';

import { BarChart, Bar, XAxis, YAxis, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { formatCurrencyCompact } from '@/lib/stockist/format';

export interface HorizontalBarChartDatum {
  name: string;
  value: number;
}

const THEME_COLORS = {
  light: { axisTick: '#6F6666', tooltipBg: '#FFFFFF', tooltipBorder: '#E4E0DE', tooltipText: '#1F1A1A' },
  dark: { axisTick: '#B8AAAC', tooltipBg: '#211B1C', tooltipBorder: '#302728', tooltipText: '#F5EEEE' },
} as const;

export function HorizontalBarChart({ data, theme }: { data: HorizontalBarChartDatum[]; theme: 'light' | 'dark' }) {
  const colors = THEME_COLORS[theme];
  return (
    <div className="h-[220px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, bottom: 4, left: 4 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" width={92} tick={{ fill: colors.axisTick, fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip
            formatter={(value) => formatCurrencyCompact(value as number | undefined)}
            contentStyle={{ background: colors.tooltipBg, border: `1px solid ${colors.tooltipBorder}`, borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: colors.tooltipText }}
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
