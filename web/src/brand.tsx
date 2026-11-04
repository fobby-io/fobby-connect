// The header logo: the live fobby mascot (assets/brand/fobby-mascot.js, loaded from index.html) where the symbol sits,
// then "Connect" drawn in the wordmark's own geometry (24-unit round strokes, 32.5-radius bowls on a 109 centre line,
// stems from 31 to 154), so it reads as one family with fobby.io's logo without using a font.
import { useEffect, useRef } from "react";

declare global { interface Window { FobbyMascot?: { mount(el: Element): { destroy(): void } } } }

export function FobbyLogo({ height = 22 }: { height?: number }) {
  const el = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!el.current || !window.FobbyMascot) return;
    const m = window.FobbyMascot.mount(el.current);
    return () => m.destroy();
  }, []);
  // fobby.io sizes the mascot 38×39 against a 32px wordmark, nudged up and left; the same ratios here.
  const k = height / 32;
  return (
    <span className="flex items-start">
      <span ref={el} aria-hidden="true" className="block flex-none cursor-pointer [&>svg]:h-full [&>svg]:w-full"
        style={{ width: 38 * k, height: 39 * k, margin: `${-5.8 * k}px 0 0 ${-1.9 * k}px` }} />
      <svg viewBox="0 0 672 200" role="img" aria-label="Connect" className="block w-auto overflow-visible text-foreground" style={{ height }}>
        <g fill="none" stroke="currentColor" strokeWidth="24" strokeLinecap="round" strokeLinejoin="round">
          <path d="M93.8 130.4A49.5 49.5 0 1 1 93.8 54.6" />
          <circle cx="176.5" cy="109" r="32.5" />
          <path d="M231 142V76.5M231 109A32.5 32.5 0 0 1 296 109V142" />
          <path d="M330 142V76.5M330 109A32.5 32.5 0 0 1 395 109V142" />
          <path d="M427 109H492A32.5 32.5 0 1 0 482.5 132" />
          <path d="M579.5 132A32.5 32.5 0 1 1 579.5 86" />
          <path d="M623 45V142M600 76.5H648" />
        </g>
      </svg>
    </span>
  );
}
