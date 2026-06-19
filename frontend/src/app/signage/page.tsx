'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { slides, SLIDE_DURATION_MS, categorySlides } from './data';
import { Frame } from './components/Frame';
import { CategorySlide } from './components/CategorySlide';
import { PackagesSlide } from './components/PackagesSlide';
import { MembershipSlide } from './components/MembershipSlide';
import { ReservationSlide } from './components/ReservationSlide';
import { SpecialServicesSlide } from './components/SpecialServicesSlide';

export default function SignagePage() {
  const [active, setActive] = useState(() => {
    if (typeof window === 'undefined') return 0;
    const s = Number(new URLSearchParams(window.location.search).get('s'));
    return Number.isFinite(s) && s >= 0 && s < slides.length ? s : 0;
  });
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const fit = () => {
      const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
      setScale(s);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      setActive((i) => (i + 1) % slides.length);
    }, SLIDE_DURATION_MS);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') setActive((i) => (i + 1) % slides.length);
      if (e.key === 'ArrowLeft') setActive((i) => (i - 1 + slides.length) % slides.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const current = slides[active];

  return (
    <div className="signage-fit" style={{ cursor: 'none' }}>
      <div className="signage-stage" style={{ transform: `scale(${scale})` }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={current.id}
            initial={{ opacity: 0, filter: 'blur(8px)' }}
            animate={{ opacity: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0, filter: 'blur(8px)' }}
            transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}
            style={{ position: 'absolute', inset: 0 }}
          >
            {current.id === 'hair' && <CategorySlide data={categorySlides.hair} />}
            {current.id === 'shave' && <CategorySlide data={categorySlides.shave} />}
            {current.id === 'other' && <CategorySlide data={categorySlides.other} />}
            {current.id === 'packages' && <PackagesSlide />}
            {current.id === 'membership' && <MembershipSlide />}
            {current.id === 'reservation' && <ReservationSlide />}
            {current.id === 'special' && <SpecialServicesSlide />}
          </motion.div>
        </AnimatePresence>

        <Frame activeIndex={active} />
      </div>
    </div>
  );
}
