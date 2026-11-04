// The fobby wordmark from fobby.io's brand assets (assets/brand/fobby-logo.svg, symbol cropped off), in the text colour.
export function FobbyWordmark({ className }: { className?: string }) {
  return (
    <svg viewBox="226.5 0 463.5 200" role="img" aria-label="fobby" className={className}>
      <g fill="currentColor">
        <rect x="246" y="37" width="24" height="117" rx="6" /><rect x="246" y="37" width="76" height="24" rx="6" /><rect x="246" y="83" width="66" height="24" rx="6" />
        <rect x="412.5" y="31" width="24" height="123" rx="6" /><rect x="506" y="31" width="24" height="123" rx="6" />
      </g>
      <g fill="none" stroke="currentColor" strokeWidth="24">
        <circle cx="363" cy="109" r="32.5" /><circle cx="457" cy="109" r="32.5" /><circle cx="550.5" cy="109" r="32.5" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M605 76L637 150M669 76L630 166Q622 182 606 179" />
      </g>
    </svg>
  );
}
