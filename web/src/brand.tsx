// The fobby logo as on fobby.io's landing page: the live mascot (assets/brand/fobby-mascot.js, loaded from index.html)
// where the symbol sits, then the wordmark (assets/brand/fobby-logo.svg with the symbol cropped off) in the text colour.
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
      <a href="https://fobby.io" className="flex items-center text-foreground" aria-label="fobby.io">
        <svg viewBox="226.5 0 463.5 200" role="img" aria-label="fobby" className="block w-auto overflow-visible" style={{ height }}>
          <g fill="currentColor">
            <rect x="246" y="37" width="24" height="117" rx="6" /><rect x="246" y="37" width="76" height="24" rx="6" /><rect x="246" y="83" width="66" height="24" rx="6" />
            <rect x="412.5" y="31" width="24" height="123" rx="6" /><rect x="506" y="31" width="24" height="123" rx="6" />
          </g>
          <g fill="none" stroke="currentColor" strokeWidth="24">
            <circle cx="363" cy="109" r="32.5" /><circle cx="457" cy="109" r="32.5" /><circle cx="550.5" cy="109" r="32.5" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M605 76L637 150M669 76L630 166Q622 182 606 179" />
          </g>
        </svg>
      </a>
    </span>
  );
}
