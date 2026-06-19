'use client';

import { slides } from '../data';

export function Frame({ activeIndex }: { activeIndex: number }) {
  return (
    <>
      {/* Top bar */}
      <div
        style={{
          position: 'absolute',
          top: 80,
          left: 96,
          right: 96,
          height: 64,
          display: 'flex',
          alignItems: 'center',
          gap: 32,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <RedboxWordmark />
        </div>
        <div className="hairline-gold" style={{ flex: 1 }} />
        <div className="font-mono" style={{ fontSize: 20, color: 'var(--accent-gold)' }}>
          {slides[activeIndex].index} — {String(slides.length).padStart(2, '0')}
        </div>
        <ProgressRail activeIndex={activeIndex} />
      </div>

      {/* Bottom bar */}
      <div
        style={{
          position: 'absolute',
          bottom: 60,
          left: 96,
          right: 96,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span className="font-mono" style={{ fontSize: 18, color: 'var(--text-smoke)' }}>
          The Gentleman&apos;s Ritual — Est. Redbox
        </span>
        <span className="font-mono" style={{ fontSize: 18, color: 'var(--accent-gold)' }}>
          @Redboxbarbershop
        </span>
      </div>
    </>
  );
}

function ProgressRail({ activeIndex }: { activeIndex: number }) {
  return (
    <div style={{ display: 'flex', gap: 8, width: 320 }}>
      {slides.map((_, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            height: 2,
            background: i === activeIndex ? 'var(--accent-crimson)' : 'rgba(239,233,220,0.15)',
            transition: 'background 400ms ease',
          }}
        />
      ))}
    </div>
  );
}

function RedboxWordmark() {
  return (
    <span
      className="font-section"
      style={{
        fontSize: 28,
        letterSpacing: '0.32em',
        color: 'var(--text-ivory)',
        textTransform: 'uppercase',
      }}
    >
      Redbox
    </span>
  );
}
