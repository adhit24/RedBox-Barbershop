'use client';

import { motion } from 'framer-motion';
import { bookingUrl, reservationFeatures } from '../data';

const spring = { type: 'spring' as const, stiffness: 100, damping: 22 };

const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(
  bookingUrl
)}&size=480x480&color=EFE9DC&bgcolor=15151A&qzone=1&format=png`;

export function ReservationSlide() {
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {/* Subtle dark canvas with geometric pattern */}
      <div style={{ position: 'absolute', inset: 0, backgroundColor: 'var(--bg-obsidian)' }} />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            'repeating-linear-gradient(45deg, rgba(184,149,74,0.05) 0 1px, transparent 1px 70px), repeating-linear-gradient(-45deg, rgba(184,149,74,0.05) 0 1px, transparent 1px 70px)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(ellipse 900px 500px at 30% 50%, rgba(184,149,74,0.12), transparent 60%)',
        }}
      />

      <span className="ghost-numeral" style={{ bottom: -140, right: -50 }}>06</span>

      {/* ── HEADER (y 200) ───────────────────────────────────── */}
      <div style={{ position: 'absolute', top: 200, left: 140, right: 140 }}>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring, delay: 0.1 }}
          className="font-mono"
          style={{
            fontSize: 20,
            color: 'var(--accent-gold)',
            letterSpacing: '0.4em',
          }}
        >
          Online Reservation
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring, delay: 0.2 }}
          className="font-display"
          style={{
            fontSize: 96,
            lineHeight: 0.98,
            margin: '14px 0 0',
            color: 'var(--text-ivory)',
            maxWidth: 1100,
          }}
        >
          Your seat,
          <br />
          one scan <span className="font-display-italic" style={{ color: 'var(--accent-gold)' }}>away.</span>
        </motion.h1>
      </div>

      {/* ── LEFT — Features list ─────────────────────────────── */}
      <div
        style={{
          position: 'absolute',
          top: 540,
          left: 140,
          width: 1020,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          rowGap: 32,
          columnGap: 56,
        }}
      >
        {reservationFeatures.map((f, i) => (
          <motion.div
            key={f.n}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: 0.4 + i * 0.1 }}
            style={{
              display: 'grid',
              gridTemplateColumns: '60px 1fr',
              gap: 20,
              alignItems: 'flex-start',
            }}
          >
            <div
              className="font-display-italic"
              style={{
                fontSize: 42,
                color: 'var(--accent-gold)',
                lineHeight: 1,
                opacity: 0.85,
              }}
            >
              {f.n}
            </div>
            <div>
              <div
                className="font-section"
                style={{
                  fontSize: 24,
                  color: 'var(--text-ivory)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.01em',
                  lineHeight: 1.15,
                }}
              >
                {f.title}
              </div>
              <div
                className="font-body"
                style={{
                  fontSize: 16,
                  color: 'var(--text-smoke)',
                  marginTop: 6,
                  lineHeight: 1.5,
                  maxWidth: 420,
                }}
              >
                {f.body}
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* ── RIGHT — QR Frame ─────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ ...spring, delay: 0.3 }}
        style={{
          position: 'absolute',
          top: 520,
          right: 140,
          width: 480,
        }}
      >
        <div
          style={{
            background: 'var(--bg-charcoal)',
            padding: 32,
            boxShadow: '0 30px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(184,149,74,0.45)',
            position: 'relative',
          }}
        >
          {/* Corner brackets */}
          {(['tl', 'tr', 'bl', 'br'] as const).map((p) => (
            <CornerBracket key={p} pos={p} />
          ))}

          <div className="font-mono" style={{ fontSize: 12, color: 'var(--accent-gold)', letterSpacing: '0.32em', textAlign: 'center', marginBottom: 14 }}>
            Scan to Reserve
          </div>

          <div style={{ background: 'var(--text-ivory)', padding: 16 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrSrc} alt="Scan to book" width={416} height={416} style={{ display: 'block', width: '100%', height: 'auto' }} />
          </div>

          <div
            className="font-display-italic"
            style={{
              fontSize: 22,
              color: 'var(--text-ivory)',
              textAlign: 'center',
              marginTop: 18,
            }}
          >
            redboxbarbershop.com
          </div>

          <div
            className="font-mono"
            style={{
              fontSize: 11,
              color: 'var(--text-smoke)',
              letterSpacing: '0.3em',
              textAlign: 'center',
              marginTop: 6,
            }}
          >
            Or visit on any device
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function CornerBracket({ pos }: { pos: 'tl' | 'tr' | 'bl' | 'br' }) {
  const size = 18;
  const offset = 8;
  const style: React.CSSProperties = {
    position: 'absolute',
    width: size,
    height: size,
    borderColor: 'var(--accent-gold)',
    borderStyle: 'solid',
    borderWidth: 0,
    pointerEvents: 'none',
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
