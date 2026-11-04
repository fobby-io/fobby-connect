// The header logo: the live fobby mascot (assets/brand/fobby-mascot.js, loaded from index.html) where the symbol sits,
// then "Connect" in Nunito ExtraBold (Google Fonts, linked from index.html), a rounded face close to the fobby wordmark.
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
    <span className="flex items-center gap-1">
      <span ref={el} aria-hidden="true" className="block flex-none cursor-pointer [&>svg]:h-full [&>svg]:w-full"
        style={{ width: 38 * k, height: 39 * k, margin: `${-5.8 * k}px 0 0 ${-1.9 * k}px` }} />
      <span className="text-foreground" style={{ fontFamily: "Nunito, sans-serif", fontWeight: 800, fontSize: height, lineHeight: 1, letterSpacing: "-0.01em" }}>Connect</span>
    </span>
  );
}
