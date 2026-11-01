import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listTournaments } from '../api.js';

function TournamentRow({ tournament: t }) {
  const done = t.status === 'completed';
  return (
    <Link to={`/tournaments/${t.id}`} className="t-row">
      <strong>{t.name}</strong>
      {done ? (
        <>
          {t.champion && <span className="t-row__champion">🏆 {t.champion.name}</span>}
          {(t.awards.batsman || t.awards.bowler) && (
            <span className="help">
              {[t.awards.batsman && `Best batsman: ${t.awards.batsman.name}`, t.awards.bowler && `Best bowler: ${t.awards.bowler.name}`]
                .filter(Boolean)
                .join(' · ')}
            </span>
          )}
        </>
      ) : (
        <>
          <span className="help">
            {t.teams} team{t.teams === 1 ? '' : 's'} · {t.played} of {t.total} match{t.total === 1 ? '' : 'es'} done · by {t.organiser}
          </span>
          {t.live.map((line) => (
            <span key={line} className="t-row__live">● {line}</span>
          ))}
        </>
      )}
    </Link>
  );
}

// Running tournaments first, then the results of completed ones.
export default function Tournaments() {
  const [tournaments, setTournaments] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    listTournaments().then(setTournaments).catch((err) => setError(err.message));
  }, []);

  const running = tournaments?.filter((t) => t.status === 'running') ?? [];
  const completed = tournaments?.filter((t) => t.status === 'completed') ?? [];

  return (
    <section className="stack">
      <div className="card section">
        <div className="section__head section__head--center">
          <h3>Tournaments</h3>
          <Link to="/tournaments/new" className="btn btn--sm">+ New</Link>
        </div>
        {error && <p className="help help--error">{error}</p>}
        {tournaments && tournaments.length === 0 && <p className="help empty">No tournaments yet. Create the first one.</p>}
      </div>

      {running.length > 0 && (
        <div className="card section">
          <h3>Running</h3>
          <div className="t-list">
            {running.map((t) => <TournamentRow key={t.id} tournament={t} />)}
          </div>
        </div>
      )}
      {completed.length > 0 && (
        <div className="card section">
          <h3>Completed</h3>
          <div className="t-list">
            {completed.map((t) => <TournamentRow key={t.id} tournament={t} />)}
          </div>
        </div>
      )}
    </section>
  );
}
