import { forwardRef, useId, useImperativeHandle, useRef } from 'react';

const EDGE_LAYERS = 14;
const THICKNESS = 12; // px
const FLIP_MS = 2300;
const SETTLE_MS = 650;

function Emblem({ side }) {
  return side === 'heads' ? (
    <>
      <circle cx="100" cy="100" r="34" />
      <path d="M84 70 Q 112 100 84 130" />
      <path d="M96 67 Q 124 100 96 133" />
      <path d="M90 68.5 Q 118 100 90 131.5" strokeDasharray="3 4" />
    </>
  ) : (
    <>
      <path d="M82 138 V 74 M100 138 V 74 M118 138 V 74" />
      <path d="M80 72 h 20 M100 72 h 20" />
      <path d="M66 126 L 132 80 M134 126 L 68 80" className="coin__bats" />
    </>
  );
}

function Face({ side }) {
  const id = useId().replace(/:/g, '');
  const ring = side === 'heads' ? 'PLAY · UNITE · HEADS · PLAY · UNITE · HEADS · ' : 'UNITE · CLUB · TAILS · UNITE · CLUB · TAILS · ';
  return (
    <div className={`coin__face coin__face--${side}`}>
      <svg viewBox="0 0 200 200" aria-hidden="true">
        <defs>
          <path id={`${id}-ring`} d="M100,100 m-72,0 a72,72 0 1,1 144,0 a72,72 0 1,1 -144,0" />
        </defs>
        <circle cx="100" cy="100" r="86" className="coin__inner-ring" />
        <circle cx="100" cy="100" r="58" className="coin__inner-ring coin__inner-ring--thin" />
        <text className="coin__ring-text">
          <textPath href={`#${id}-ring`} startOffset="0">{ring}</textPath>
        </text>
        {/* light copy offset below the engraving reads as embossed metal */}
        <g className="coin__emboss coin__emboss--hi" transform="translate(0 1.8)">
          <Emblem side={side} />
        </g>
        <g className="coin__emboss">
          <Emblem side={side} />
        </g>
      </svg>
    </div>
  );
}

// Height (0..1) and spin progress for normalised time t in a parabolic toss.
const arc = (t) => 4 * t * (1 - t);
const spinEase = (t) => 1 - (1 - t) ** 2.2; // air drag slows the spin

// A 3D coin. ref.flip(outcome) animates a toss that lands on `outcome` and
// resolves when it settles; ref.show(face) sets it without animating.
const Coin = forwardRef(function Coin({ size = 150 }, ref) {
  const coinRef = useRef(null);
  const shadowRef = useRef(null);
  const angle = useRef(0);

  useImperativeHandle(ref, () => ({
    show(face) {
      angle.current = face === 'tails' ? 180 : 0;
      coinRef.current.getAnimations().forEach((a) => a.cancel());
      coinRef.current.style.transform = `rotateX(${angle.current}deg)`;
    },
    flip(outcome) {
      const coin = coinRef.current;
      const shadow = shadowRef.current;
      coin.classList.remove('is-idle');
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const start = angle.current;
      // Land face up on the outcome after several full turns.
      const spins = reduce ? 1 : 6 + Math.floor(Math.random() * 3);
      const target = (outcome === 'tails' ? 180 : 0) + 360 * (Math.ceil(start / 360) + spins);
      // Throw as high as the space above the coin allows (clear of the sticky header).
      const room = coin.getBoundingClientRect().top - 72;
      const lift = Math.max(110, Math.min(room, 230));
      const precession = (Math.random() * 2 - 1) * 14;

      const frames = [];
      const shadowFrames = [];
      const N = 48;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const h = arc(t);
        const a = start + (target - start) * spinEase(t);
        frames.push({
          offset: t,
          transform: `translateY(${-h * lift}px) translateZ(${h * 90}px) rotateY(${Math.sin(t * Math.PI) * precession}deg) rotateX(${a}deg)`,
        });
        shadowFrames.push({ offset: t, transform: `scale(${1 - h * 0.55})`, opacity: 0.55 - h * 0.4 });
      }
      // Bounce and settle: a small hop with a wobble that dies out.
      const settle = [
        { offset: 0, transform: `rotateX(${target}deg)` },
        { offset: 0.35, transform: `translateY(-16px) translateZ(8px) rotateX(${target + 14}deg)` },
        { offset: 0.65, transform: `translateY(0) rotateX(${target - 6}deg)` },
        { offset: 0.85, transform: `translateY(-3px) rotateX(${target + 2}deg)` },
        { offset: 1, transform: `rotateX(${target}deg)` },
      ];

      return new Promise((resolve) => {
        const up = coin.animate(frames, { duration: reduce ? 600 : FLIP_MS, easing: 'linear', fill: 'forwards' });
        shadow.animate(shadowFrames, { duration: reduce ? 600 : FLIP_MS, easing: 'linear', fill: 'forwards' });
        up.onfinish = () => {
          navigator.vibrate?.([18, 40, 10]);
          const s = coin.animate(settle, { duration: reduce ? 1 : SETTLE_MS, easing: 'ease-out', fill: 'forwards' });
          s.onfinish = () => {
            angle.current = target;
            resolve(outcome);
          };
        };
      });
    },
  }));

  return (
    <div className="coin-stage" style={{ '--coin': `${size}px` }}>
      <div className="coin-shadow" ref={shadowRef} />
      <div className="coin is-idle" ref={coinRef}>
        <Face side="heads" />
        <Face side="tails" />
        {Array.from({ length: EDGE_LAYERS }, (_, i) => (
          <div
            key={i}
            className="coin__edge"
            // Edge layers sit strictly between the faces so they never z-fight with them.
            style={{ transform: `translateZ(${-THICKNESS / 2 + 0.5 + ((THICKNESS - 1) * i) / (EDGE_LAYERS - 1)}px)` }}
          />
        ))}
      </div>
    </div>
  );
});

export default Coin;
