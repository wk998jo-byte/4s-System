import { type RefObject, useEffect, useState } from "react";

/** Ease-out cubic. */
function easeOut(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Progress 0→1 when `ref` enters the viewport (or is already visible).
 * Re-runs when `replayKey` changes (e.g. tab / filter change).
 */
export function useChartReveal(
  ref: RefObject<Element | null>,
  replayKey: string | number = 0,
  durationMs = 780,
) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let raf = 0;
    let start = 0;
    let started = false;
    setProgress(0);

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      setProgress(easeOut(t));
      if (t < 1) raf = requestAnimationFrame(tick);
    };

    const play = () => {
      if (started) return;
      started = true;
      start = performance.now();
      raf = requestAnimationFrame(tick);
    };

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          play();
          io.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);

    // If already on-screen (common on first paint), kick off shortly after mount.
    const fallback = window.setTimeout(() => {
      const rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight && rect.bottom > 0) play();
    }, 40);

    return () => {
      io.disconnect();
      window.clearTimeout(fallback);
      cancelAnimationFrame(raf);
    };
  }, [ref, replayKey, durationMs]);

  return progress;
}
