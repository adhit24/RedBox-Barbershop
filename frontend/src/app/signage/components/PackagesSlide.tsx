'use client';

import { motion } from 'framer-motion';
import { packages } from '../data';

const spring = { type: 'spring' as const, stiffness: 100, damping: 22 };
const royal = packages[0];
const supporting = packages.slice(1);
const romans = ['I', 'II', 'III', 'IV', 'V'];

/* ── Layout grid (1920 x 1080) ────────────────────────────────────
   Top bar:       80 – 144
   Header band:   180 – 380   (200h)
   Content band:  420 – 950   (530h)
   Bottom bar:    1000 – 1020
   Side margins:  140
─────────────────────────────────────────────────────────────────── */

export function PackagesSlide() {
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {/* Layered atmospheric background */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `url(${royal.image})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          filter: 'blur(40px) brightness(0.32) saturate(0.55)',
          transform: 'scale(1.1)',
        }}
      />
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(11,11,13,0.82)' }} />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            'repeating-linear-gradient(45deg, rgba(184,149,74,0.04) 0 1px, transparent 1px 90px), repeating-linear-gradient(-45deg, rgba(184,149,74,0.04) 0 1px, transparent 1px 90px)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(ellipse 1200px 500px at 50% -150px, rgba(184,149,74,0.16), transparent 60%)',
        }}
      />

      <span className="ghost-numeral" style={{ bottom: -140, right: -50 }}>04</span>

      {/* ═══ HEADER BAND (y 180–380) ═════════════════════════════ */}
      <div
        style={{
          position: 'absolute',
          top: 200,
          left: 140,
          right: 140,
          textAlign: 'center',
        }}
      >
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring, delay: 0.1 }}
          className="font-mono"
          style={{
            fontSize: 18,
            color: 'var(--accent-gold)',
            letterSpacing: '0.42em',
          }}
        >
          The Grooming Collection
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.25, duration: 0.5 }}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 24,
            marginTop: 16,
          }}
        >
          <OrnamentRule width={120} />
          <CrownEmblem />
          <OrnamentRule width={120} />
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring, delay: 0.32 }}
          className="font-display"
          style={{
            fontSize: 64,
            lineHeight: 1.05,
            margin: '14px 0 0',
            color: 'var(--text-ivory)',
            letterSpacing: '-0.015em',
          }}
        >
          Five Rituals.{' '}
          <span className="font-display-italic" style={{ color: 'var(--accent-gold)' }}>
            Five Crowns.
          </span>
        </motion.h1>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.55, duration: 0.6 }}
          className="font-display-italic"
          style={{
            fontSize: 19,
            color: 'var(--text-smoke)',
            marginTop: 14,
          }}
        >
          Each ritual ninety minutes — every detail considered.
        </motion.div>
      </div>

      {/* ═══ CONTENT BAND (y 420–950) ════════════════════════════ */}

      {/* ── ROYAL SHOWCASE (left) ────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...spring, delay: 0.45 }}
        style={{
          position: 'absolute',
          top: 420,
          left: 140,
          width: 900,
          height: 530,
          padding: 5,
          background:
            'linear-gradient(135deg, rgba(184,149,74,0.6) 0%, rgba(184,149,74,0.18) 50%, rgba(184,149,74,0.6) 100%)',
          boxShadow: '0 40px 100px rgba(0,0,0,0.7), 0 0 0 1px rgba(184,149,74,0.3)',
        }}
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            background: 'var(--bg-charcoal)',
            display: 'grid',
            gridTemplateColumns: '340px 1fr',
            position: 'relative',
          }}
        >
          <CornerBracket pos="tl" />
          <CornerBracket pos="tr" />
          <CornerBracket pos="bl" />
          <CornerBracket pos="br" />

          {/* Photo */}
          <div style={{ position: 'relative', overflow: 'hidden' }}>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                backgroundImage: `url(${royal.image})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                filter: 'grayscale(0.55) brightness(0.85) sepia(0.15) contrast(1.05)',
              }}
            />
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background:
                  'radial-gradient(circle at 50% 60%, transparent 30%, rgba(11,11,13,0.55) 100%)',
              }}
            />
            <div
              className="font-display-italic"
              style={{
                position: 'absolute',
                top: 26,
                left: 26,
                fontSize: 56,
                color: 'var(--accent-gold)',
                opacity: 0.92,
                lineHeight: 1,
              }}
            >
              {romans[0]}
            </div>
            <div
              className="font-mono"
              style={{
                position: 'absolute',
                bottom: 22,
                left: 26,
                fontSize: 12,
                color: 'var(--accent-gold)',
                letterSpacing: '0.32em',
              }}
            >
              The Showcase
            </div>
          </div>

          {/* Content */}
          <div
            style={{
              padding: '36px 40px',
              display: 'flex',
              flexDirection: 'column',
              gap: 0,
              minWidth: 0,
            }}
          >
            <div
              className="font-mono"
              style={{ fontSize: 12, color: 'var(--accent-gold)', letterSpacing: '0.32em' }}
            >
              Premier Ritual
            </div>

            <div
              className="font-section"
              style={{
                fontSize: 36,
                color: 'var(--text-ivory)',
                textTransform: 'uppercase',
                marginTop: 10,
                lineHeight: 1.05,
                letterSpacing: '-0.005em',
              }}
            >
              Redbox{' '}
              <span style={{ color: 'var(--accent-gold)' }}>Royal Grooming</span>
            </div>

            <div
              className="font-display-italic"
              style={{ fontSize: 22, color: 'var(--text-ivory)', marginTop: 8 }}
            >
              {royal.tag}
            </div>

            <div className="hairline-gold" style={{ height: 1, margin: '20px 0 14px' }} />

            <div
              className="font-mono"
              style={{
                fontSize: 11,
                color: 'var(--accent-gold)',
                letterSpacing: '0.32em',
                marginBottom: 8,
              }}
            >
              The Inclusions
            </div>

            <RoyalItemList items={royal.items.split(' · ')} />
          </div>
        </div>
      </motion.div>

      {/* ── 4 SUPPORTING LOTS (right) ────────────────────────── */}
      <div
        style={{
          position: 'absolute',
          top: 420,
          right: 140,
          width: 620,
          height: 530,
          display: 'grid',
          gridTemplateRows: 'repeat(4, 1fr)',
          gap: 14,
        }}
      >
        {supporting.map((p, i) => (
          <motion.div
            key={p.name}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...spring, delay: 0.6 + i * 0.1 }}
            style={{
              background: 'rgba(21,21,26,0.88)',
              borderLeft: '2px solid rgba(184,149,74,0.55)',
              padding: '14px 20px',
              display: 'grid',
              gridTemplateColumns: '46px 1fr 56px',
              alignItems: 'center',
              gap: 16,
              backdropFilter: 'blur(4px)',
              minWidth: 0,
            }}
          >
            <div
              className="font-display-italic"
              style={{
                fontSize: 34,
                color: 'var(--accent-gold)',
                lineHeight: 1,
                opacity: 0.88,
                textAlign: 'center',
              }}
            >
              {romans[i + 1]}
            </div>

            <div style={{ minWidth: 0 }}>
              <div
                className="font-section"
                style={{
                  fontSize: 18,
                  color: 'var(--text-ivory)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.02em',
                  lineHeight: 1.15,
                }}
              >
                {p.name}
              </div>
              <div
                className="font-display-italic"
                style={{
                  fontSize: 15,
                  color: 'var(--accent-gold)',
                  marginTop: 2,
                  lineHeight: 1.2,
                }}
              >
                {p.tag}
              </div>
              <div
                className="font-body"
                style={{
                  fontSize: 12,
                  color: 'var(--text-smoke)',
                  marginTop: 6,
                  lineHeight: 1.4,
                }}
              >
                {p.items}
              </div>
            </div>

            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                backgroundImage: `url(${p.image})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                border: '1px solid rgba(184,149,74,0.4)',
                filter: 'grayscale(0.5) brightness(0.9)',
              }}
            />
          </motion.div>
        ))}
      </div>
    </div>
  );
}

/* ── Atoms ───────────────────────────────────────────────────── */

function OrnamentRule({ width }: { width: number }) {
  return (
    <div
      style={{
        width,
        height: 1,
        background:
          'linear-gradient(90deg, transparent, var(--accent-gold) 30%, var(--accent-gold) 70%, transparent)',
      }}
    />
  );
}

function CrownEmblem() {
  return (
    <svg width="40" height="28" viewBox="0 0 40 28" fill="none">
      <path
        d="M2 22 L2 12 L10 18 L14 6 L20 18 L26 6 L30 18 L38 12 L38 22 Z"
        fill="none"
        stroke="var(--accent-gold)"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M2 24 L38 24" stroke="var(--accent-gold)" strokeWidth="1.2" />
      <circle cx="14" cy="4" r="1.2" fill="var(--accent-gold)" />
      <circle cx="20" cy="2" r="1.5" fill="var(--accent-gold)" />
      <circle cx="26" cy="4" r="1.2" fill="var(--accent-gold)" />
    </svg>
  );
}

function CornerBracket({ pos }: { pos: 'tl' | 'tr' | 'bl' | 'br' }) {
  const size = 20;
  const offset = 10;
  const style: React.CSSProperties = {
    position: 'absolute',
    width: size,
    height: size,
    borderColor: 'var(--accent-gold)',
    borderStyle: 'solid',
    borderWidth: 0,
    pointerEvents: 'none',
    zIndex: 2,
  };
  if (pos.includes('t')) {
    style.top = offset;
    style.borderTopWidth = 1;
  } else {
    style.bottom = offset;
    style.borderBottomWidth = 1;
  }
  if (pos.includes('l')) {
    style.left = offset;
    style.borderLeftWidth = 1;
  } else {
    style.right = offset;
    style.borderRightWidth = 1;
  }
  return <div style={style} />;
}

function RoyalItemList({ items }: { items: string[] }) {
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {items.map((item, i) => (
        <motion.li
          key={item}
          initial={{ opacity: 0, x: 6 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ ...spring, delay: 0.7 + i * 0.06 }}
          className="font-item"
          style={{
            fontSize: 14,
            color: 'var(--text-ivory)',
            padding: '4px 0',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            lineHeight: 1.3,
          }}
        >
          <span
            className="font-mono"
            style={{
              fontSize: 10,
              color: 'var(--accent-gold)',
              opacity: 0.65,
              minWidth: 22,
            }}
          >
            0{i + 1}
          </span>
          <span>{item}</span>
        </motion.li>
      ))}
    </ul>
  );
}
