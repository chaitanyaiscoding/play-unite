import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import CricketBall from './CricketBall.jsx';

const GRAVITY = 1500; // px/s²

// A ball that never stops: it rolls back and forth along the top edge of
// whatever sits below the track, hopping now and then. ref.hop() makes it jump;
// onLand(impact) fires when it touches down so the parent can react.
const BallTrack = forwardRef(function BallTrack({ size = 44, onLand }, ref) {
  const trackRef = useRef(null);
  const ballRef = useRef(null);
  const shadowRef = useRef(null);
  const spinRef = useRef(null);
  const onLandRef = useRef(onLand);
  const state = useRef({ x: 0, dir: 1, y: 0, vy: 0, squash: 0, boost: 0, nextHop: 0 });
  onLandRef.current = onLand;

  const hop = (power = 1) => {
    const s = state.current;
    if (s.y > 6) return; // already airborne
    s.vy = Math.max(s.vy, 330 * power);
    s.boost = 1; // roll faster for a moment
  };
  useImperativeHandle(ref, () => ({ hop }));

  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const s = state.current;
    let last = performance.now();
    let raf;
    s.nextHop = last + 1800;

    const tick = (now) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const max = Math.max((trackRef.current?.clientWidth ?? 0) - size, 0);

      // Roll, bouncing off each end of the track.
      s.boost = Math.max(0, s.boost - dt * 1.5);
      s.x += s.dir * (reduce ? 28 : 72 + 120 * s.boost) * dt;
      if (s.x <= 0) [s.x, s.dir] = [0, 1];
      else if (s.x >= max) [s.x, s.dir] = [max, -1];

      // Random hops (skipped for reduced motion).
      if (!reduce && s.y === 0 && s.vy === 0 && now > s.nextHop) {
        s.vy = 260 + Math.random() * 180;
        s.nextHop = now + 2200 + Math.random() * 3800;
      }
      if (s.vy !== 0 || s.y > 0) {
        s.vy -= GRAVITY * dt;
        s.y += s.vy * dt;
        if (s.y <= 0) {
          const impact = -s.vy;
          s.y = 0;
          // Bounce once more if it came down hard.
          s.vy = impact > 300 ? impact * 0.3 : 0;
          s.squash = Math.min(impact / 600, 1);
          onLandRef.current?.(impact);
        }
      }
      s.squash = Math.max(0, s.squash - dt * 6);

      const sq = s.squash * 0.22;
      const deg = (s.x / (size / 2)) * (180 / Math.PI); // roll without slipping
      if (ballRef.current) {
        ballRef.current.style.transform = `translate3d(${s.x}px, ${-s.y}px, 0) scale(${1 + sq}, ${1 - sq})`;
      }
      spinRef.current?.setAttribute('transform', `rotate(${deg} 32 32)`);
      if (shadowRef.current) {
        const k = Math.max(0.35, 1 - s.y / 120);
        shadowRef.current.style.transform = `translate3d(${s.x}px, 0, 0) scale(${k}, 1)`;
        shadowRef.current.style.opacity = String(0.55 * k);
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [size]);

  return (
    <div className="ball-track" ref={trackRef} style={{ height: size }}>
      <span className="ball-track__shadow" ref={shadowRef} style={{ width: size }} aria-hidden="true" />
      <div
        className="ball-track__ball"
        ref={ballRef}
        style={{ width: size, height: size }}
        onPointerDown={() => hop(1.25)}
        aria-hidden="true"
      >
        <CricketBall size={size} spinRef={spinRef} />
      </div>
    </div>
  );
});

export default BallTrack;
