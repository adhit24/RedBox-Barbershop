'use client';

import { useEffect, useRef } from 'react';
import { animate, useMotionValue } from 'framer-motion';

export interface AnimatedNumberProps {
  value: number;
  formatter?: (n: number) => string;
  className?: string;
}

const defaultFormatter = (n: number) => Math.round(n).toLocaleString('id-ID');

export function AnimatedNumber({ value, formatter = defaultFormatter, className }: AnimatedNumberProps) {
  const spanRef = useRef<HTMLSpanElement>(null);
  const motionValue = useMotionValue(0);

  useEffect(() => {
    const controls = animate(motionValue, value, {
      duration: 0.7,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (latest) => {
        if (spanRef.current) {
          spanRef.current.textContent = formatter(latest);
        }
      },
    });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, formatter]);

  return (
    <span ref={spanRef} className={className}>
      {formatter(0)}
    </span>
  );
}
