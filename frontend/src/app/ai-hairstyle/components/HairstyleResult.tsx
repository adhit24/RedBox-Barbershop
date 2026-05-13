'use client';

import { HairstyleAnalysis } from '../types';

interface Props {
  data: HairstyleAnalysis;
  previewUrl: string;
  onReset: () => void;
}

const FACE_SHAPE_DESC: Record<string, string> = {
  Oval: 'Balanced proportions — most styles work well.',
  Round: 'Add height on top, keep sides tight.',
  Square: 'Soften angles with textured, layered styles.',
  Heart: 'Balance a wider forehead with volume at jaw.',
  Diamond: 'Add width at forehead and chin.',
  Oblong: 'Add width on sides, avoid extra height.',
  Triangle: 'Volume on top balances wider jaw.',
};

function Badge({ label, variant = 'default' }: { label: string; variant?: 'default' | 'gold' | 'red' | 'blue' }) {
  const styles = {
    default: 'bg-zinc-800 text-zinc-300 border border-zinc-700',
    gold: 'bg-amber-500/10 text-amber-400 border border-amber-500/30',
    red: 'bg-red-500/10 text-red-400 border border-red-500/30',
    blue: 'bg-blue-500/10 text-blue-400 border border-blue-500/30',
  };
  return (
    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${styles[variant]}`}>
      {label}
    </span>
  );
}

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-400 uppercase tracking-widest mb-4">
        <span>{icon}</span> {title}
      </h3>
      {children}
    </div>
  );
}

export default function HairstyleResult({ data, previewUrl, onReset }: Props) {
  const faceDesc = FACE_SHAPE_DESC[data.face_shape] || 'Unique face shape with specific style needs.';

  return (
    <div className="w-full space-y-4">

      {/* Header card */}
      <div className="bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-800 border border-zinc-800 rounded-2xl p-5">
        <div className="flex items-center gap-4">
          <div className="relative flex-shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewUrl} alt="Portrait" className="w-20 h-20 rounded-xl object-cover ring-2 ring-amber-500/40" />
            <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-amber-500 rounded-full flex items-center justify-center">
              <svg className="w-3 h-3 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <p className="text-xs text-amber-500 font-medium tracking-widest uppercase mb-1">AI Analysis Complete</p>
                <h2 className="text-white font-bold text-lg leading-tight">Hair Profile</h2>
              </div>
              <div className="text-right">
                <p className="text-3xl font-bold text-amber-400">{data.confidence_score}<span className="text-base text-zinc-500">%</span></p>
                <p className="text-xs text-zinc-500">Confidence</p>
              </div>
            </div>
          </div>
        </div>

        {/* Confidence bar */}
        <div className="mt-4">
          <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-amber-600 to-amber-400 rounded-full transition-all duration-1000"
              style={{ width: `${data.confidence_score}%` }}
            />
          </div>
        </div>
      </div>

      {/* Face & Hair Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
          <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Face Shape</p>
          <p className="text-white font-bold text-lg">{data.face_shape}</p>
          <p className="text-zinc-500 text-xs mt-1 leading-relaxed">{faceDesc}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
          <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Hair Type</p>
          <p className="text-white font-bold text-base leading-tight">{data.hair_type}</p>
          <div className="flex gap-2 mt-2 flex-wrap">
            <Badge label={data.hair_thickness} variant="blue" />
            <Badge label={`Density: ${data.hair_density}`} />
          </div>
        </div>
      </div>

      {/* Current condition */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
        <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">Current Condition</p>
        <p className="text-zinc-300 text-sm leading-relaxed">{data.current_hair_condition}</p>
      </div>

      {/* Recommended hairstyles */}
      <Section title="Recommended Styles" icon="✂️">
        <div className="flex flex-wrap gap-2">
          {data.recommended_hairstyles.map((style, i) => (
            <div key={i} className="flex items-center gap-2 bg-zinc-800/60 border border-amber-500/20 rounded-xl px-3 py-2">
              <span className="text-amber-500 text-xs font-bold">#{i + 1}</span>
              <span className="text-white text-sm font-medium">{style}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* Avoid hairstyles */}
      <Section title="Avoid These Styles" icon="⚠️">
        <div className="flex flex-wrap gap-2">
          {data.avoid_hairstyles.map((style, i) => (
            <Badge key={i} label={style} variant="red" />
          ))}
        </div>
      </Section>

      {/* Styling tips */}
      <Section title="Styling Tips" icon="💡">
        <ul className="space-y-2">
          {data.styling_tips.map((tip, i) => (
            <li key={i} className="flex items-start gap-3 text-sm text-zinc-300">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 text-xs flex items-center justify-center font-bold mt-0.5">
                {i + 1}
              </span>
              {tip}
            </li>
          ))}
        </ul>
      </Section>

      {/* Products & Colors — 2 col */}
      <div className="grid grid-cols-2 gap-3">
        <Section title="Products" icon="🧴">
          <div className="flex flex-col gap-2">
            {data.recommended_products.map((p, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                <span className="text-zinc-300 text-xs">{p}</span>
              </div>
            ))}
          </div>
        </Section>
        <Section title="Hair Colors" icon="🎨">
          <div className="flex flex-col gap-2">
            {data.recommended_hair_colors.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                <span className="text-zinc-300 text-xs">{c}</span>
              </div>
            ))}
          </div>
        </Section>
      </div>

      {/* Barber instruction */}
      <div className="bg-gradient-to-r from-amber-950/40 to-zinc-900 border border-amber-500/30 rounded-2xl p-5">
        <p className="text-xs text-amber-500 font-semibold uppercase tracking-widest mb-2">Tell Your Barber</p>
        <p className="text-white text-sm leading-relaxed italic">&ldquo;{data.barber_instruction}&rdquo;</p>
      </div>

      {/* Reset button */}
      <button
        onClick={onReset}
        className="w-full py-4 rounded-2xl border border-zinc-700 text-zinc-400 text-sm font-medium hover:border-zinc-600 hover:text-white transition-colors"
      >
        Analyze Another Photo
      </button>
    </div>
  );
}
