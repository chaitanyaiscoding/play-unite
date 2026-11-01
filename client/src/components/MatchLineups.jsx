import { useEffect, useState } from 'react';
import LineupEditor from './LineupEditor.jsx';
import { XI_MAX, XI_MIN } from '../../../shared/cricket.js';

const lineupOf = (team) => ({
  xi: team.lineup.playingXI.map((p) => p.name),
  bench: team.lineup.bench.map((p) => p.name),
});

// A player in both squads can only play for one side: drop them from `b`'s XI.
function withoutClashes(a, b) {
  const taken = new Set(a.xi);
  const moved = b.xi.filter((n) => taken.has(n));
  return moved.length ? { xi: b.xi.filter((n) => !taken.has(n)), bench: [...b.bench, ...moved] } : b;
}

// Both playing XIs for a new match, starting from each team's saved default XI,
// and the bottom bar that creates it. `onCreate(xiA, xiB)` gets the player names.
export default function MatchLineups({ heading = 'Playing XIs', team, opponent, busy, actionLabel = 'Create match', onCreate }) {
  const [lineups, setLineups] = useState({ a: null, b: null });
  const [tab, setTab] = useState('a');

  useEffect(() => {
    if (!team || !opponent) return setLineups({ a: null, b: null });
    const a = lineupOf(team);
    setLineups({ a, b: withoutClashes(a, lineupOf(opponent)) });
    setTab('a');
  }, [team, opponent]);

  if (!lineups.a || !lineups.b) return null;

  const blockedFor = (other, otherTeam) => new Map((other?.xi ?? []).map((n) => [n, `Playing for ${otherTeam.name}`]));
  const okSize = (l) => l && l.xi.length >= XI_MIN && l.xi.length <= XI_MAX;
  const ready = okSize(lineups.a) && okSize(lineups.b);
  const opponentNames = new Set([opponent.captain, ...opponent.players].map((p) => p.name));
  const shared = [team.captain, ...team.players].filter((p) => opponentNames.has(p.name)).length;

  // Take a player who's picked for the other side into this side's XI.
  const claim = (side, name) =>
    setLineups((l) => {
      const other = side === 'a' ? 'b' : 'a';
      return {
        [other]: { xi: l[other].xi.filter((n) => n !== name), bench: [...l[other].bench, name] },
        [side]: { xi: [...l[side].xi, name], bench: l[side].bench.filter((n) => n !== name) },
      };
    });

  return (
    <>
      <div className="card section">
        <h3>{heading}</h3>
        <p className="help">
          Each side plays {XI_MIN}–{XI_MAX} players.
          {shared > 0 &&
            ` ${shared} player${shared === 1 ? ' is' : 's are'} in both squads; they can only play for one side (tap Switch to move them).`}
        </p>
        <div className="tabs tabs--teams" role="tablist">
          {[
            ['a', team, lineups.a],
            ['b', opponent, lineups.b],
          ].map(([key, t, l]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={`tab${tab === key ? ' is-active' : ''}`}
              onClick={() => setTab(key)}
            >
              {t.name}{' '}
              <span className={okSize(l) ? 'text-ok' : 'help--warn'}>{l.xi.length}</span>
            </button>
          ))}
        </div>
        {tab === 'a' ? (
          <LineupEditor
            key="a"
            title={`${team.name} XI`}
            members={[team.captain, ...team.players]}
            captain={team.captain.name}
            value={lineups.a}
            blocked={blockedFor(lineups.b, opponent)}
            onClaim={(n) => claim('a', n)}
            onChange={(a) => setLineups((l) => ({ ...l, a }))}
          />
        ) : (
          <LineupEditor
            key="b"
            title={`${opponent.name} XI`}
            members={[opponent.captain, ...opponent.players]}
            captain={opponent.captain.name}
            value={lineups.b}
            blocked={blockedFor(lineups.a, team)}
            onClaim={(n) => claim('b', n)}
            onChange={(b) => setLineups((l) => ({ ...l, b }))}
          />
        )}
      </div>

      <div className="sc-bar">
        <div className="sc-bar__mvp">
          <span className="help">
            {team.name} {lineups.a.xi.length} v {lineups.b.xi.length} {opponent.name}
          </span>
          <strong className={ready ? '' : 'help--warn'}>
            {!ready
              ? `Each side needs ${XI_MIN}–${XI_MAX} players`
              : lineups.a.xi.length === lineups.b.xi.length
                ? `${lineups.a.xi.length}-a-side · Ready for the toss`
                : 'Ready for the toss'}
          </strong>
        </div>
        <button type="button" className="btn btn--sm" disabled={!ready || busy} onClick={() => onCreate(lineups.a.xi, lineups.b.xi)}>
          {busy ? 'Creating…' : actionLabel}
        </button>
      </div>
    </>
  );
}
