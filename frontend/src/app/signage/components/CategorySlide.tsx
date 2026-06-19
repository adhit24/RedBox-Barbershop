'use client';

import { motion } from 'framer-motion';
import type { CategorySlideData } from '../data';

const spring = { type: 'spring' as const, stiffness: 100, damping: 22 };

export function CategorySlide({ data }: { data: CategorySlideData }) {
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {/* Background image - right side dominant */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `url(${data.bg})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center right',
          filter: 'grayscale(0.5) brightness(0.55) contrast(1.05)',
        }}
      />
      {/* Left dark gradient for text legibility */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(90deg, rgba(11,11,13,0.97) 0%, rgba(11,11,13,0.88) 38%, rgba(11,11,13,0.35) 70%, rgba(11,11,13,0.1) 100%)',
        }}
      />

      <span className="ghost-numeral" style={{ bottom: -120, right: -40 }}>
        {data.index}
      </span>

      {/* LEFT — narrative column */}
      <div style={{ position: 'absolute', top: 220, left: 160, width: 780 }}>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring, delay: 0.1 }}
          className="font-mono"
          style={{ fontSize: 20, color: 'var(--accent-gold)' }}
        >
          {data.eyebrow}
        </motion.div>

        {/* Mega category title */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring, delay: 0.18 }}
          className="font-section"
          style={{
            fontSize: 96,
            color: 'var(--accent-gold)',
            textTransform: 'uppercase',
            letterSpacing: '-0.01em',
            marginTop: 12,
            lineHeight: 1,
          }}
        >
          {data.title}
        </motion.div>

        {/* Crimson rule */}
        <motion.div
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ delay: 0.45, duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }}
          style={{
            width: 120,
            height: 3,
            background: 'var(--accent-crimson)',
            margin: '28px 0 36px',
            transformOrigin: 'left',
          }}
        />

        {/* Editorial display headline */}
        <motion.h1
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring, delay: 0.3 }}
          className="font-display"
          style={{
            fontSize: 88,
            lineHeight: 1.02,
            margin: 0,
            color: 'var(--text-ivory)',
            maxWidth: 760,
          }}
        >
          {data.display.line1}
          <br />
          {data.display.line2}{' '}
          <span className="font-display-italic">{data.display.italic}</span>
        </motion.h1>

        {/* Intro body */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.55, duration: 0.6 }}
          className="font-body"
          style={{
            fontSize: 22,
            color: 'var(--text-ivory)',
            opacity: 0.85,
            marginTop: 36,
            maxWidth: 640,
            lineHeight: 1.55,
          }}
        >
          {data.intro}
        </motion.p>

        {/* Upsell line — elegant, no exclamation */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring, delay: 0.75 }}
          style={{
            marginTop: 28,
            paddingLeft: 20,
            borderLeft: '2px solid var(--accent-gold)',
            maxWidth: 620,
          }}
        >
          <div
            className="font-mono"
            style={{ fontSize: 14, color: 'var(--accent-gold)', marginBottom: 6 }}
          >
            A Quiet Suggestion
          </div>
          <div
            className="font-display-italic"
            style={{ fontSize: 22, color: 'var(--text-ivory)', lineHeight: 1.35 }}
          >
            {data.upsell}
          </div>
        </motion.div>
      </div>

      {/* RIGHT — menu list */}
      <div
        style={{
          position: 'absolute',
          top: 220,
          right: 160,
          width: 720,
          bottom: 160,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        }}
      >
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.6 }}
          className="font-mono"
          style={{ fontSize: 16, color: 'var(--text-smoke)', marginBottom: 24 }}
        >
          The Menu — {String(data.items.length).padStart(2, '0')} Rituals
        </motion.div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {data.items.map((item, i) => (
            <motion.div
              key={item.name}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ ...spring, delay: 0.5 + i * 0.08 }}
              style={{
                borderTop: '1px solid rgba(184,149,74,0.18)',
                padding: '18px 0 16px',
              }}
            >
              <div
                className="font-item"
                style={{
                  fontSize: 26,
                  color: 'var(--text-ivory)',
                  lineHeight: 1.2,
                }}
              >
                {item.name}
              </div>
              <div
                className="font-body"
                style={{
                  fontSize: 17,
                  color: 'var(--text-smoke)',
                  marginTop: 4,
                  fontStyle: 'italic',
                  lineHeight: 1.4,
                }}
              >
                {item.desc}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
