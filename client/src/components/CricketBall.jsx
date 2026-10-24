import { useId } from 'react';

// A red leather cricket ball. The seam spins with `spinRef` (an SVG <g>) while
// the shading stays put, so the light source doesn't rotate with the ball.
export default function CricketBall({ size = 44, spinRef, className }) {
  const id = useId().replace(/:/g, '');

  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <radialGradient id={`${id}-shade`} cx="36%" cy="30%" r="72%">
          <stop offset="0" stopColor="#fff" stopOpacity="0.45" />
          <stop offset="0.25" stopColor="#fff" stopOpacity="0.08" />
          <stop offset="0.6" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.55" />
        </radialGradient>
        <clipPath id={`${id}-clip`}>
          <circle cx="32" cy="32" r="30" />
        </clipPath>
      </defs>

      <g clipPath={`url(#${id}-clip)`}>
        <g ref={spinRef}>
          <circle cx="32" cy="32" r="30" fill="#c8102e" />
          {/* leather grain */}
          <circle cx="18" cy="40" r="7" fill="#b00d27" opacity="0.6" />
          <circle cx="46" cy="22" r="6" fill="#d61a37" opacity="0.5" />
          {/* seam: ridge lines with a band of stitches between */}
          <path d="M24 2 Q 40 32 24 62" stroke="#8a0718" strokeWidth="1.6" fill="none" />
          <path d="M34 2 Q 50 32 34 62" stroke="#8a0718" strokeWidth="1.6" fill="none" />
          <path
            d="M29 2 Q 45 32 29 62"
            stroke="#f5e6c8"
            strokeWidth="7"
            strokeDasharray="1.3 2.5"
            fill="none"
          />
          <path d="M29 2 Q 45 32 29 62" stroke="#a50c20" strokeWidth="1.2" fill="none" />
        </g>
      </g>
      <circle cx="32" cy="32" r="30" fill={`url(#${id}-shade)`} />
      <ellipse cx="22" cy="17" rx="8" ry="4.5" fill="#fff" opacity="0.28" transform="rotate(-32 22 17)" />
    </svg>
  );
}
