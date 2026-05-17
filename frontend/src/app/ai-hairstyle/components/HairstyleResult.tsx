'use client';

import { HairstyleAnalysis, RedboxProduct } from '../types';

interface Props {
  data: HairstyleAnalysis;
  previewUrl: string;
  onReset: () => void;
}

export default function HairstyleResult({ data, previewUrl, onReset }: Props) {
  const topRec = data.recommendations[0];

  const heroBadges = [
    data.faceShape.charAt(0).toUpperCase() + data.faceShape.slice(1) + ' Face',
    data.currentHair.texture.charAt(0).toUpperCase() + data.currentHair.texture.slice(1) + ' Hair',
    data.currentHair.density.charAt(0).toUpperCase() + data.currentHair.density.slice(1) + ' Density',
  ];

  return (
    <div className="w-full bg-black text-white overflow-hidden" style={{ fontFamily: 'system-ui, sans-serif' }}>

      {/* ── HERO ─────────────────────────────────────────────── */}
      <section className="relative w-full" style={{ height: '92vh' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={previewUrl}
          alt="Portrait"
          className="absolute inset-0 w-full h-full object-cover object-top"
        />
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, #000 0%, rgba(0,0,0,0.45) 50%, transparent 100%)' }} />

        <div className="absolute bottom-0 left-0 right-0 p-6">
          <div className="flex items-center gap-2 mb-3">
            <div style={{ width: 40, height: 1, background: '#ef4444' }} />
            <p className="text-[11px] tracking-[0.3em] uppercase text-zinc-400">AI Grooming Analysis</p>
          </div>

          <h1 className="font-black leading-none tracking-tight" style={{ fontSize: 'clamp(3rem, 12vw, 5rem)' }}>
            YOUR BEST
            <span className="block" style={{ color: '#ef4444' }}>LOOK</span>
          </h1>

          <div className="flex flex-wrap gap-2 mt-5">
            {heroBadges.map((badge) => (
              <div
                key={badge}
                className="rounded-full px-4 py-2"
                style={{ border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', backdropFilter: 'blur(8px)' }}
              >
                <p className="text-sm font-medium text-zinc-200">{badge}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── BEST HAIRSTYLES ──────────────────────────────────── */}
      <section className="px-5 py-14">
        <div className="mb-8">
          <p className="text-sm tracking-[0.25em] uppercase mb-3" style={{ color: '#ef4444' }}>Recommended</p>
          <h2 className="font-black tracking-tight leading-none" style={{ fontSize: 'clamp(2.5rem, 10vw, 4rem)' }}>
            BEST
            <span className="block text-zinc-500">HAIRSTYLES</span>
          </h2>
        </div>

        <div className="flex flex-col gap-6">
          {data.recommendations.map((rec) => (
            <div
              key={rec.rank}
              className="relative overflow-hidden"
              style={{ borderRadius: 28, background: '#111' }}
            >
              <div className="relative overflow-hidden" style={{ aspectRatio: '4/5' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewUrl}
                  alt={rec.name}
                  className="w-full h-full object-cover object-top"
                  style={{ filter: 'brightness(0.8) saturate(0.85)' }}
                />
                <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, #000 0%, rgba(0,0,0,0.1) 50%, transparent 100%)' }} />

                {/* Score chip top-right */}
                <div
                  className="absolute top-4 right-4 flex items-center gap-1.5 px-3 py-1.5"
                  style={{ background: 'rgba(0,0,0,0.6)', borderRadius: 99, backdropFilter: 'blur(8px)' }}
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
                  <p className="text-xs font-bold text-white">{rec.suitabilityScore}% Match</p>
                </div>

                <div className="absolute bottom-0 left-0 right-0 p-5">
                  <div className="inline-flex rounded-full px-4 py-1.5 mb-3" style={{ background: '#ef4444' }}>
                    <p className="text-xs font-bold uppercase tracking-wider text-white">{rec.category}</p>
                  </div>
                  <h3 className="font-black leading-none tracking-tight" style={{ fontSize: 'clamp(1.8rem, 7vw, 3rem)' }}>
                    {rec.name}
                  </h3>
                  <p className="text-zinc-400 text-sm mt-1">{rec.whyItSuits}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── HAIRSTYLES TO AVOID ──────────────────────────────── */}
      <section className="px-5 pb-14" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="mb-8 pt-14">
          <p className="text-sm tracking-[0.25em] uppercase mb-3" style={{ color: '#ef4444' }}>Avoid</p>
          <h2 className="font-black tracking-tight leading-none" style={{ fontSize: 'clamp(2.5rem, 10vw, 4rem)' }}>
            SKIP
            <span className="block text-zinc-500">THESE CUTS</span>
          </h2>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {data.avoidHairstyles.map((avoid, i) => (
            <div key={i} className="relative overflow-hidden" style={{ borderRadius: 20 }}>
              <div className="relative overflow-hidden" style={{ aspectRatio: '3/4' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewUrl}
                  alt={avoid.style}
                  className="w-full h-full object-cover object-top"
                  style={{ filter: 'brightness(0.45) saturate(0.3) sepia(0.4)' }}
                />
                <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(120,0,0,0.75) 0%, transparent 60%)' }} />

                {/* X badge */}
                <div
                  className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center"
                  style={{ background: '#ef4444', borderRadius: '50%' }}
                >
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>

                <div className="absolute bottom-0 left-0 right-0 px-2 pb-2">
                  <p className="text-white font-black text-[10px] leading-tight uppercase">{avoid.style}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── STYLING STEPS ────────────────────────────────────── */}
      <section className="px-5 pb-14" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="mb-8 pt-14">
          <p className="text-sm tracking-[0.25em] uppercase mb-3" style={{ color: '#ef4444' }}>How To Style</p>
          <h2 className="font-black tracking-tight leading-none" style={{ fontSize: 'clamp(2.5rem, 10vw, 4rem)' }}>
            DAILY
            <span className="block text-zinc-500">ROUTINE</span>
          </h2>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {[
            { icon: '💨', step: '01', label: 'Blow Dry', sub: 'Towel dry then blow dry for volume' },
            { icon: '✋', step: '02', label: 'Apply Product', sub: 'Work pomade/clay through damp hair' },
            { icon: '✂️', step: '03', label: 'Shape & Style', sub: 'Lift roots, define your cut' },
            { icon: '⏱', step: '04', label: 'Finish', sub: 'Light hold spray to set all day' },
          ].map((s) => (
            <div key={s.step} className="p-4" style={{ background: '#111', borderRadius: 24 }}>
              <div className="flex items-center justify-between mb-4">
                <span className="text-2xl">{s.icon}</span>
                <span className="text-zinc-700 font-black text-lg">{s.step}</span>
              </div>
              <p className="text-white font-black text-base leading-tight">{s.label}</p>
              <p className="text-zinc-500 text-xs mt-1 leading-snug">{s.sub}</p>
            </div>
          ))}
        </div>

        {topRec && (
          <div
            className="mt-4 p-4 flex items-start gap-3"
            style={{ background: '#111', borderRadius: 24, border: '1px solid rgba(239,68,68,0.2)' }}
          >
            <span className="text-xl flex-shrink-0">✂️</span>
            <div>
              <p className="text-xs font-black uppercase tracking-widest mb-1" style={{ color: '#ef4444' }}>Tell Your Barber</p>
              <p className="text-white text-sm leading-snug italic">&ldquo;{data.barberTip}&rdquo;</p>
              <p className="text-zinc-600 text-xs mt-1">{topRec.maintenanceFrequency} trim · {topRec.stylingTime} styling</p>
            </div>
          </div>
        )}
      </section>

      {/* ── REDBOX PRODUCTS UPSELL ───────────────────────────── */}
      {data.recommendedProducts && data.recommendedProducts.length > 0 && (
        <section className="px-5 pb-14" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="mb-8 pt-14">
            <p className="text-sm tracking-[0.25em] uppercase mb-3" style={{ color: '#ef4444' }}>Shop Now</p>
            <h2 className="font-black tracking-tight leading-none" style={{ fontSize: 'clamp(2.5rem, 10vw, 4rem)' }}>
              YOUR
              <span className="block text-zinc-500">PRODUCTS</span>
            </h2>
          </div>

          <div className="flex flex-col gap-3">
            {data.recommendedProducts.map((product: RedboxProduct) => (
              <a
                key={product.id}
                href={product.shopeeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-4 p-4 transition-all active:scale-[0.98]"
                style={{ background: '#111', borderRadius: 24, border: '1px solid rgba(255,255,255,0.06)' }}
              >
                <div
                  className="flex-shrink-0 flex items-center justify-center text-2xl"
                  style={{ width: 56, height: 56, background: '#1a1a1a', borderRadius: 16 }}
                >
                  {product.emoji}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-black text-sm leading-tight">{product.name}</p>
                  <p className="text-zinc-500 text-xs mt-0.5 capitalize">
                    {product.type}{product.hold ? ` · ${product.hold} hold` : ''}{product.base ? ` · ${product.base} base` : ''}
                  </p>
                </div>
                <div
                  className="flex-shrink-0 px-4 py-2"
                  style={{ background: '#ef4444', borderRadius: 99 }}
                >
                  <p className="text-white text-xs font-black uppercase">Buy</p>
                </div>
              </a>
            ))}
          </div>

          <p className="text-zinc-700 text-[11px] text-center mt-4">
            Redbox Barbershop · Official Shopee Store
          </p>
        </section>
      )}

      {/* ── RESET ────────────────────────────────────────────── */}
      <div className="px-5 pb-10">
        <button
          onClick={onReset}
          className="w-full py-4 font-bold text-sm transition-colors"
          style={{ borderRadius: 99, border: '1px solid rgba(255,255,255,0.1)', color: '#71717a' }}
        >
          ↩ Analisis Ulang
        </button>
      </div>
    </div>
  );
}
