/** Logo mark: a 2×2 answer-sheet bubble grid with one bubble filled in. */
export function LogoMark({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={className} aria-hidden>
      <rect x="0.5" y="0.5" width="27" height="27" rx="8" fill="#0f1a3a" />
      <circle cx="9.5" cy="9.5" r="3.6" fill="none" stroke="#8f86f2" strokeWidth="1.4" />
      <circle cx="18.5" cy="9.5" r="3.6" fill="#7a5af5" />
      <circle cx="9.5" cy="18.5" r="3.6" fill="none" stroke="#8f86f2" strokeWidth="1.4" />
      <circle cx="18.5" cy="18.5" r="3.6" fill="none" stroke="#8f86f2" strokeWidth="1.4" />
    </svg>
  );
}
