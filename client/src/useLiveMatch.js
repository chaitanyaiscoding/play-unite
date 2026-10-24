import { useCallback, useEffect, useMemo, useState } from 'react';
import { getMatch } from './api.js';
import { replay, splitLog } from '../../shared/scoring.js';

// Loads a match and keeps it fresh: the server pushes a message after every
// ball, and we refetch. Returns the match, its replayed ball-by-ball state
// (null before the toss decision) and setters for the scorer.
export default function useLiveMatch(id) {
  const [match, setMatch] = useState(null);
  const [error, setError] = useState('');

  const reload = useCallback(
    () =>
      getMatch(id)
        .then((m) => {
          setMatch(m);
          setError('');
          return m;
        })
        .catch((err) => setError(err.message)),
    [id]
  );

  useEffect(() => {
    setMatch(null);
    reload();
  }, [reload]);

  // Subscribe while the match can still change.
  const active = match && match.version === 2 && ['toss', 'live'].includes(match.status);
  useEffect(() => {
    if (!active || typeof EventSource === 'undefined') return;
    const source = new EventSource(`/api/matches/${id}/live`);
    source.onmessage = () => reload();
    return () => source.close();
  }, [active, id, reload]);

  const state = useMemo(() => {
    if (!match || match.version !== 2 || !match.overs || !match.battingFirst) return null;
    try {
      return replay(
        {
          overs: match.overs,
          battingFirst: match.battingFirst,
          sides: match.sides.map((s) => ({ team: s.team, xi: s.playingXI.map((p) => p.name) })),
        },
        splitLog(match.log)
      );
    } catch {
      return null;
    }
  }, [match]);

  return { match, setMatch, state, error, reload };
}
