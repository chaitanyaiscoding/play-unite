import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ballsToOvers } from '../../../shared/cricket.js';

const TAKE_LABEL = { winner: 'Winner', loser: 'Loser' };

// Connected matches in rows, each row one step below the matches feeding it.
// Matches with no connections are listed on their own, under the map.
function layout(entries) {
  const fed = new Set(entries.flatMap((e) => e.sources.map((s) => s.number)));
  const depth = new Map();
  for (const e of entries) {
    depth.set(e.number, e.sources.length ? 1 + Math.max(...e.sources.map((s) => depth.get(s.number) ?? 0)) : 0);
  }
  const connected = entries.filter((e) => e.sources.length || fed.has(e.number));
  const rows = [];
  for (const e of connected) (rows[depth.get(e.number)] ??= []).push(e);
  const others = entries.filter((e) => !connected.includes(e));
  return { rows: rows.filter(Boolean), loose: others.filter((e) => !e.final), finals: others.filter((e) => e.final) };
}

function statusLine(entry) {
  if (entry.match) {
    const live = entry.state === 'live' || entry.state === 'toss';
    return <span className={`t-tile__line${live ? ' is-live' : ''}`}>{entry.match.line}</span>;
  }
  if (entry.state === 'ready') return <span className="t-tile__line is-action">Set lineups →</span>;
  if (entry.state === 'no_result') return <span className="t-tile__line">No result</span>;
  return <span className="t-tile__line">Waiting for results</span>;
}

// One match on the map. Tapping opens the match, or its lineups once it's ready.
function Tile({ entry, tournamentId, canManage, onRemove, tileRef }) {
  const teamLine = (i) => {
    const name = entry.match?.teams[i]?.name ?? entry.teams[i]?.name;
    if (name) {
      const score = entry.match?.teams[i]?.score;
      const won = entry.match?.winner === name;
      return (
        <span key={i} className={`t-tile__team${won ? ' is-winner' : ''}`}>
          <span className="t-tile__name">{name}</span>
          {score && (
            <span className="t-tile__score">
              {score.runs}/{score.wickets}
              <span className="help"> ({ballsToOvers(score.balls)})</span>
            </span>
          )}
        </span>
      );
    }
    const source = entry.sources[i];
    return (
      <span key={i} className="t-tile__team t-tile__team--tbc">
        {source ? `${TAKE_LABEL[source.take]} of Match ${source.number}` : 'To be decided'}
      </span>
    );
  };

  const inner = (
    <>
      <span className="t-tile__label">{entry.final ? '🏆 Final' : `Match ${entry.number}`}</span>
      {teamLine(0)}
      {teamLine(1)}
      {statusLine(entry)}
    </>
  );
  const classes = `t-tile t-tile--${entry.state}${entry.final ? ' t-tile--final' : ''}`;
  let body = <div className={classes}>{inner}</div>;
  if (entry.match) body = <Link to={`/matches/${entry.match.id}`} className={classes}>{inner}</Link>;
  else if (entry.state === 'ready' && canManage) {
    body = <Link to={`/tournaments/${tournamentId}/add?entry=${entry.number}`} className={classes}>{inner}</Link>;
  }

  return (
    <div className="t-tile-wrap" ref={tileRef}>
      {body}
      {entry.removable && (
        <button type="button" className="t-tile__remove" aria-label={`Remove match ${entry.number} from the tournament`} onClick={() => onRemove(entry)}>
          ×
        </button>
      )}
    </div>
  );
}

// The connecting lines, measured from where the tiles actually landed.
function useLines(entries, rootRef, tileRefs) {
  const [lines, setLines] = useState({ paths: [], width: 0, height: 0 });
  const measure = useRef(() => {});

  measure.current = () => {
    const root = rootRef.current;
    if (!root) return;
    const box = root.getBoundingClientRect();
    const paths = [];
    for (const e of entries) {
      const to = tileRefs.current.get(e.number)?.getBoundingClientRect();
      if (!to) continue;
      e.sources.forEach((s, i) => {
        const from = tileRefs.current.get(s.number)?.getBoundingClientRect();
        if (!from) return;
        const x1 = from.left + from.width / 2 - box.left;
        const y1 = from.bottom - box.top;
        const x2 = to.left + to.width / 2 - box.left + (i === 0 ? -14 : 14);
        const y2 = to.top - box.top;
        const bend = (y2 - y1) / 2;
        paths.push({
          key: `${s.number}-${e.number}-${i}`,
          take: s.take,
          d: `M${x1} ${y1} C${x1} ${y1 + bend},${x2} ${y2 - bend},${x2} ${y2}`,
          labelX: (x1 + x2) / 2,
          labelY: (y1 + y2) / 2 + 3,
        });
      });
    }
    setLines({ paths, width: root.scrollWidth, height: root.scrollHeight });
  };

  useLayoutEffect(() => measure.current(), [entries]);
  useEffect(() => {
    if (!rootRef.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => measure.current());
    observer.observe(rootRef.current);
    return () => observer.disconnect();
  }, [rootRef]);
  return lines;
}

export default function TournamentMap({ tournament, onRemove }) {
  const { entries, id, canManage } = tournament;
  const rootRef = useRef(null);
  const tileRefs = useRef(new Map());
  const lines = useLines(entries, rootRef, tileRefs);
  const { rows, loose, finals } = layout(entries);
  const tile = (e) => (
    <Tile
      key={e.number}
      entry={e}
      tournamentId={id}
      canManage={canManage}
      onRemove={onRemove}
      tileRef={(el) => (el ? tileRefs.current.set(e.number, el) : tileRefs.current.delete(e.number))}
    />
  );

  if (!entries.length) return <p className="help empty">No matches yet.</p>;

  return (
    <>
      {rows.length > 0 && (
        <div className="t-map">
          <div className="t-map__inner" ref={rootRef}>
            <svg className="t-map__lines" width={lines.width} height={lines.height} aria-hidden="true">
              {lines.paths.map((p) => (
                <g key={p.key} className={`t-line t-line--${p.take}`}>
                  <path d={p.d} />
                  <text x={p.labelX} y={p.labelY} textAnchor="middle">{TAKE_LABEL[p.take]}</text>
                </g>
              ))}
            </svg>
            {rows.map((row, i) => (
              <div key={i} className="t-map__row">{row.map(tile)}</div>
            ))}
          </div>
        </div>
      )}
      {loose.length > 0 && (
        <>
          {rows.length > 0 && <h4 className="t-subhead">Not connected</h4>}
          <div className="t-loose">{loose.map(tile)}</div>
        </>
      )}
      {finals.length > 0 && <div className="t-finals">{finals.map(tile)}</div>}
    </>
  );
}
