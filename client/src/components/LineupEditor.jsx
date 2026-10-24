import { useEffect, useMemo, useRef, useState } from 'react';
import { ROLES } from '../../../shared/cricket.js';
import { PlayerName } from './PlayerBits.jsx';

export const XI_SIZE = 11;
const EDGE = 70; // px from the viewport edge where dragging auto-scrolls
const SCROLL_AFTER = 24; // px the finger must travel before auto-scroll kicks in

// Where a pointer at y would drop: { zone, index } or null.
function hitTest(zones, dragged, y) {
  let best = null;
  for (const [zone, el] of Object.entries(zones)) {
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    const dist = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
    if (dist > 48 || (best && best.dist <= dist)) continue;
    const items = [...el.querySelectorAll('[data-name]')].filter((n) => n.dataset.name !== dragged);
    const index = items.filter((n) => {
      const r = n.getBoundingClientRect();
      return r.top + r.height / 2 < y;
    }).length;
    best = { zone, index, dist };
  }
  return best && { zone: best.zone, index: best.index };
}

// Moves `name` and returns the new { xi, bench }. Dropping a bench player on a
// full XI swaps them with the player at the drop position.
export function moveIn({ xi, bench }, name, from, to, index, max = XI_SIZE) {
  const nx = xi.filter((n) => n !== name);
  const nb = bench.filter((n) => n !== name);
  if (to === 'xi' && from === 'bench' && nx.length >= max) {
    const i = Math.min(index, max - 1);
    const out = nx[i];
    nx[i] = name;
    nb.splice(bench.indexOf(name), 0, out);
  } else if (to === 'xi') {
    nx.splice(index, 0, name);
  } else {
    nb.splice(index, 0, name);
  }
  return { xi: nx, bench: nb };
}

// Drag-and-drop Playing XI (batting order) + bench. Controlled: the parent
// owns { xi, bench } (arrays of names). `blocked` maps a name to why it can't
// join the XI (e.g. "Playing for India").
export default function LineupEditor({
  members,
  captain,
  value,
  onChange,
  blocked = new Map(),
  onClaim, // (name) => take a blocked player from the other side
  title = 'Playing XI',
  max = XI_SIZE,
}) {
  const { xi, bench } = value;
  const [drag, setDrag] = useState(null); // { name, from, x, y, dx, dy, width, over }
  const zoneRefs = useRef({ xi: null, bench: null });
  const pointer = useRef(null);
  const byName = useMemo(() => new Map(members.map((p) => [p.name, p])), [members]);
  const full = xi.length >= max;

  const move = (name, from, to, index) => {
    if (to === 'xi' && from === 'bench' && blocked.has(name)) return;
    onChange(moveIn(value, name, from, to, index, max));
  };

  // Auto-scroll while dragging near the top/bottom edge.
  useEffect(() => {
    if (!drag) return;
    let raf;
    const tick = () => {
      const p = pointer.current;
      if (p && Math.abs(p.y - p.startY) >= SCROLL_AFTER) {
        const step =
          p.y < EDGE ? -(EDGE - p.y) / 5 : p.y > window.innerHeight - EDGE ? (p.y - window.innerHeight + EDGE) / 5 : 0;
        if (step) {
          window.scrollBy(0, step);
          setDrag((d) => d && { ...d, over: hitTest(zoneRefs.current, d.name, p.y) });
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [Boolean(drag)]); // eslint-disable-line react-hooks/exhaustive-deps

  const onPointerDown = (e, name, from) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (from === 'bench' && blocked.has(name)) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const row = e.currentTarget.closest('[data-name]').getBoundingClientRect();
    pointer.current = { x: e.clientX, y: e.clientY, startY: e.clientY };
    navigator.vibrate?.(10);
    setDrag({
      name,
      from,
      x: e.clientX,
      y: e.clientY,
      dx: e.clientX - row.left,
      dy: e.clientY - row.top,
      width: row.width,
      over: { zone: from, index: (from === 'xi' ? xi : bench).indexOf(name) },
    });
  };
  const onPointerMove = (e) => {
    if (!drag) return;
    pointer.current = { ...pointer.current, x: e.clientX, y: e.clientY };
    setDrag({ ...drag, x: e.clientX, y: e.clientY, over: hitTest(zoneRefs.current, drag.name, e.clientY) });
  };
  const onPointerUp = () => {
    if (drag?.over) move(drag.name, drag.from, drag.over.zone, drag.over.index);
    pointer.current = null;
    setDrag(null);
  };
  const onPointerCancel = () => {
    pointer.current = null;
    setDrag(null);
  };

  const counts = ROLES.map((r) => ({ ...r, n: xi.filter((n) => byName.get(n)?.role === r.value).length }));
  const noKeeper = xi.length > 0 && !counts.find((c) => c.value === 'wicketkeeper').n;

  const renderRow = (name, i, zone) => {
    const p = byName.get(name);
    if (!p) return null;
    const over = drag?.over;
    const isDragged = drag?.name === name;
    const others = (zone === 'xi' ? xi : bench).filter((n) => n !== drag?.name);
    const pos = others.indexOf(name);
    const swapping = drag && drag.from === 'bench' && zone === 'xi' && over?.zone === 'xi' && full;
    const lock = zone === 'bench' ? blocked.get(name) : null;
    const cls = [
      'lineup__row',
      isDragged && 'is-dragging',
      lock && 'is-blocked',
      !isDragged && over?.zone === zone && !swapping && over.index === pos && 'is-drop-before',
      !isDragged && swapping && Math.min(over.index, max - 1) === xi.indexOf(name) && 'is-swap',
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <li key={name} data-name={name} className={cls}>
        <span
          className="lineup__handle"
          onPointerDown={(e) => onPointerDown(e, name, zone)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          aria-hidden="true"
        >
          <svg viewBox="0 0 24 24" width="18" height="18">
            <circle cx="9" cy="6" r="1.6" />
            <circle cx="15" cy="6" r="1.6" />
            <circle cx="9" cy="12" r="1.6" />
            <circle cx="15" cy="12" r="1.6" />
            <circle cx="9" cy="18" r="1.6" />
            <circle cx="15" cy="18" r="1.6" />
          </svg>
        </span>
        {zone === 'xi' && <span className="lineup__num">{i + 1}</span>}
        <span className="lineup__who">
          <PlayerName player={p} captain={p.name === captain} />
          {lock && <span className="lineup__lock">{lock}</span>}
        </span>
        {lock && onClaim ? (
          <button
            type="button"
            className="lineup__btn lineup__btn--in"
            onClick={() => onClaim(name)}
            disabled={full}
            aria-label={`Move ${name} to this team`}
            title={full ? 'XI is full' : undefined}
          >
            Switch
          </button>
        ) : zone === 'xi' ? (
          <button
            type="button"
            className="lineup__btn"
            onClick={() => move(name, 'xi', 'bench', 0)}
            aria-label={`Move ${name} to the bench`}
          >
            Bench
          </button>
        ) : (
          <button
            type="button"
            className="lineup__btn lineup__btn--in"
            onClick={() => move(name, 'bench', 'xi', xi.length)}
            disabled={full || Boolean(lock)}
            aria-label={`Move ${name} into the playing XI`}
            title={lock ?? (full ? 'XI is full: drag onto a player to swap' : undefined)}
          >
            + XI
          </button>
        )}
      </li>
    );
  };

  const dragged = drag && byName.get(drag.name);

  return (
    <div className={`lineup${drag ? ' is-active' : ''}`}>
      <div className="section__head">
        <h3>{title}</h3>
        <span className={`count${xi.length === max ? ' count--ok' : ''}`}>
          {xi.length} / {max}
        </span>
      </div>
      <p className="help">Drag the ⋮⋮ handle to set the batting order or swap players with the bench.</p>

      <div className="lineup__mix">
        {counts.map((c) => (
          <span key={c.value} className={`role role--${c.value}`}>
            {c.short} {c.n}
          </span>
        ))}
      </div>
      {noKeeper && <p className="help help--warn">No wicketkeeper in this XI.</p>}

      <ol
        className={`lineup__list${drag?.over?.zone === 'xi' && drag.over.index >= xi.filter((n) => n !== drag.name).length && !(drag.from === 'bench' && full) ? ' is-drop-end' : ''}`}
        ref={(el) => (zoneRefs.current.xi = el)}
      >
        {xi.map((n, i) => renderRow(n, i, 'xi'))}
        {xi.length === 0 && <li className="lineup__empty">Drag players here</li>}
      </ol>

      <div className="lineup__bench-head">
        <h4>Bench</h4>
        <span className="help">
          {bench.length} player{bench.length === 1 ? '' : 's'}
        </span>
      </div>
      <ul
        className={`lineup__list lineup__list--bench${drag?.over?.zone === 'bench' && drag.over.index >= bench.filter((n) => n !== drag.name).length ? ' is-drop-end' : ''}`}
        ref={(el) => (zoneRefs.current.bench = el)}
      >
        {bench.map((n, i) => renderRow(n, i, 'bench'))}
        {bench.length === 0 && <li className="lineup__empty">Nobody on the bench</li>}
      </ul>

      {drag && dragged && (
        <div
          className="lineup__ghost"
          style={{ width: drag.width, transform: `translate3d(${drag.x - drag.dx}px, ${drag.y - drag.dy}px, 0)` }}
          aria-hidden="true"
        >
          <span className="lineup__handle">⋮⋮</span>
          <PlayerName player={dragged} captain={dragged.name === captain} />
        </div>
      )}
    </div>
  );
}
