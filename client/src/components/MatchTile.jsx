import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listMatches } from '../api.js';
import { ballsToOvers } from '../../../shared/cricket.js';

const REFRESH_MS = 10000;

// Matches for a list, refreshed every few seconds while live ones are shown.
export function useMatchList(status, limit) {
  const [matches, setMatches] = useState(null);
  const load = useCallback(
    () =>
      listMatches({ status, limit })
        .then(setMatches)
        .catch(() => setMatches((m) => m ?? [])),
    [status, limit]
  );
  useEffect(() => {
    load();
    if (status !== 'live') return;
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load, status]);
  return matches;
}

// One match: both teams with scores, live badge or result, and a status line.
export default function MatchTile({ match }) {
  const live = match.status !== 'completed';
  return (
    <Link to={`/matches/${match.id}`} className={`match-tile${live ? ' is-live' : ''}`}>
      <div className="match-tile__top">
        {live ? (
          <span className="live-badge">
            <span className="live-badge__dot" aria-hidden="true" />
            {match.status === 'toss' ? 'Toss' : 'Live'}
          </span>
        ) : (
          <span className="help">Result</span>
        )}
        <span className="help">
          {match.overs ? `${match.overs} ov · ` : ''}scored by {match.createdBy}
        </span>
      </div>
      {match.teams.map((t) => (
        <div
          key={t.name}
          className={`match-tile__team${match.batting === t.name ? ' is-batting' : ''}${match.winner === t.name ? ' is-winner' : ''}`}
        >
          <span className="match-tile__name">
            <span className="team-badge team-badge--xs" aria-hidden="true">{t.name[0].toUpperCase()}</span>
            {t.name}
            {match.batting === t.name && <span className="match-tile__bat" aria-label="batting">●</span>}
          </span>
          {t.score ? (
            <span className="match-tile__score">
              {t.score.runs}/{t.score.wickets} <span className="help">({ballsToOvers(t.score.balls)})</span>
            </span>
          ) : (
            <span className="help">Yet to bat</span>
          )}
        </div>
      ))}
      {match.line && <p className={`match-tile__line${live ? '' : ' is-result'}`}>{match.line}</p>}
    </Link>
  );
}
