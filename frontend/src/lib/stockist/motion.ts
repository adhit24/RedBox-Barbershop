import type { Variants } from 'framer-motion';

export const MOTION = {
  micro: 0.15,
  card: 0.2,
  content: 0.26,
  sheet: 0.25,
} as const;

export const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];

export const staggerContainer: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.06 },
  },
};

export const fadeSlideItem: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: MOTION.content, ease: EASE_OUT } },
};

export const cardHover = {
  whileHover: { y: -2, transition: { duration: MOTION.card, ease: EASE_OUT } },
  whileTap: { scale: 0.98, transition: { duration: MOTION.micro, ease: EASE_OUT } },
};

export const sheetBackdrop: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: MOTION.sheet, ease: EASE_OUT } },
  exit: { opacity: 0, transition: { duration: MOTION.sheet, ease: EASE_OUT } },
};

export const sheetPanel: Variants = {
  hidden: { y: '100%' },
  show: { y: 0, transition: { duration: MOTION.sheet, ease: EASE_OUT } },
  exit: { y: '100%', transition: { duration: MOTION.sheet, ease: EASE_OUT } },
};
