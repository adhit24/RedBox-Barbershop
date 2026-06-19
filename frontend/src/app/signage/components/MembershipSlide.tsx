'use client';

import { motion } from 'framer-motion';
import { membershipBenefits } from '../data';

const spring = { type: 'spring' as const, stiffness: 100, damping: 22 };

export function MembershipSlide() {
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {/* Atmospheric background */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: 'url(/signage/services-bg.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          filter: 'grayscale(0.75) brightness(0.32) blur(4px)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(circle at 20% 30%, rgba(184,149,74,0.16), transparent 55%), rgba(11,11,13,0.78)',
        }}
      />

      <span className="ghost-numeral" style={{ bottom: -140, left: -50 }}>05</span>

      {/* Header right */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...spring, delay: 0.1 }}
        className="font-mono"
        style={{
          position: 'absolute',
          top: 220,
          right: 140,
          fontSize: 20,
          color: 'var(--accent-gold)',
          letterSpacing: '0.4em',
        }}
      >
        The Inner Circle
      </motion.div>

      <motion.h1
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...spring, delay: 0.2 }}
        className="font-display"
        style={{
          position: 'absolute',
          top: 270,
          right: 140,
          fontSize: 116,
          lineHeight: 0.98,
          margin: 0,
          textAlign: 'right',
          color: 'var(--text-ivory)',
          maxWidth: 920,
        }}
      >
        The chair
        <br />
        remembers
        <br />
        <span className="font-display-italic">its regulars.</span>
      </motion.h1>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5, duration: 0.6 }}
        className="font-body"
        style={{
          position: 'absolute',
          top: 600,
          right: 140,
          fontSize: 22,
          color: 'var(--text-smoke)',
          textAlign: 'right',
          maxWidth: 720,
        }}
      >
        Become a Redbox Member. Step in as a guest — leave recognised.
      </motion.p>

      {/* Real member card - left, tilted */}
      <motion.div
        initial={{ opacity: 0, x: -30, rotate: -14 }}
        animate={{ opacity: 1, x: 0, rotate: -7 }}
        transition={{ ...spring, delay: 0.35 }}
        style={{
          position: 'absolute',
          top: 320,
          left: 160,
          width: 620,
          filter: 'drop-shadow(0 40px 80px rgba(0,0,0,0.7)) drop-shadow(0 0 0 1px rgba(184,149,74,0.2))',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/signage/member-card.png"
          alt="Redbox Member Card"
          style={{ width: '100%', height: 'auto', display: 'block' }}
        />
      </motion.div>

      {/* Soft gold glow behind card */}
      <div
        style={{
          position: 'absolute',
          top: 380,
          left: 200,
          width: 540,
          height: 320,
          background: 'radial-gradient(circle, rgba(184,149,74,0.18), transparent 70%)',
          filter: 'blur(40px)',
          pointerEvents: 'none',
        }}
      />

      {/* Benefits right */}
      <div
        style={{
          position: 'absolute',
          right: 140,
          top: 720,
          width: 920,
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 36,
        }}
      >
        {membershipBenefits.map((b, i) => (
          <motion.div
            key={b.n}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: 0.55 + i * 0.12 }}
            style={{ borderTop: '1px solid rgba(184,149,74,0.3)', paddingTop: 18 }}
          >
            <div className="font-mono" style={{ fontSize: 16, color: 'var(--accent-gold)', marginBottom: 8 }}>
              {b.n}
            </div>
            <div
              className="font-section"
              style={{
                fontSize: 26,
                color: 'var(--text-ivory)',
                textTransform: 'uppercase',
                marginBottom: 8,
                lineHeight: 1.1,
              }}
            >
              {b.title}
            </div>
            <div className="font-body" style={{ fontSize: 16, color: 'var(--text-smoke)', lineHeight: 1.5 }}>
              {b.body}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
