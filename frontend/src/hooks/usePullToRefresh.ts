'use client';

import { useEffect, useRef, useState } from 'react';

type PullToRefreshOptions = {
  enabled?: boolean;
  threshold?: number;
  onRefresh: () => void | Promise<void>;
};

export function usePullToRefresh({ enabled = true, threshold = 76, onRefresh }: PullToRefreshOptions) {
  const [distance, setDistance] = useState(0);
  const startYRef = useRef<number | null>(null);
  const distanceRef = useRef(0);
  const pullingRef = useRef(false);
  const refreshingRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    const onTouchStart = (event: TouchEvent) => {
      if (refreshingRef.current || window.scrollY > 0 || event.touches.length !== 1) return;
      startYRef.current = event.touches[0].clientY;
      pullingRef.current = false;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (startYRef.current === null || refreshingRef.current || event.touches.length !== 1) return;
      const delta = event.touches[0].clientY - startYRef.current;
      if (delta <= 0 || window.scrollY > 0) return;

      pullingRef.current = true;
      const nextDistance = Math.min(delta * 0.55, threshold + 18);
      distanceRef.current = nextDistance;
      setDistance(nextDistance);
      if (event.cancelable) event.preventDefault();
    };

    const onTouchEnd = () => {
      const shouldRefresh = pullingRef.current && distanceRef.current >= threshold;
      startYRef.current = null;
      pullingRef.current = false;
      distanceRef.current = 0;
      setDistance(0);

      if (!shouldRefresh || refreshingRef.current) return;
      refreshingRef.current = true;
      Promise.resolve(onRefresh()).finally(() => {
        refreshingRef.current = false;
      });
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [enabled, onRefresh, threshold]);

  return { distance, threshold, ready: distance >= threshold };
}
