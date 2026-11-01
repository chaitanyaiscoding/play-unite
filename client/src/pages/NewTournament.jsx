import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createTournament, listTournaments } from '../api.js';
import { usePlayer } from '../PlayerContext.jsx';

// The two starting points: a brand new tournament, or a match for a running one.
export default function NewTournament() {
  const navigate = useNavigate();
  const { player } = usePlayer();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mine, setMine] = useState(null);

  useEffect(() => {
    listTournaments()
      .then((all) => setMine(all.filter((t) => t.status === 'running' && t.organiser === player.name)))
      .catch(() => setMine([]));
  }, [player.name]);

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const t = await createTournament(name);
      navigate(`/tournaments/${t.id}`, { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <section className="stack">
      <Link to="/tournaments" className="back">← Tournaments</Link>

      <form className="card section form" onSubmit={create} noValidate>
        <h3>Create a new tournament</h3>
        <p className="help">Give it a name, then start adding matches. You&rsquo;ll be the organiser.</p>
        <input
          className="input"
          aria-label="Tournament name"
          placeholder="Tournament name"
          maxLength={40}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        {error && <p className="help help--error">{error}</p>}
        <button type="submit" className="btn" disabled={busy || name.trim().length < 2}>
          {busy ? 'Creating…' : 'Create tournament'}
        </button>
      </form>

      <div className="card section">
        <h3>Add a match to a tournament</h3>
        {mine && mine.length === 0 && <p className="help">You&rsquo;re not organising a running tournament yet.</p>}
        {mine && mine.length > 0 && (
          <div className="t-list">
            {mine.map((t) => (
              <Link key={t.id} to={`/tournaments/${t.id}/add`} className="t-row">
                <strong>{t.name}</strong>
                <span className="help">{t.total} match{t.total === 1 ? '' : 'es'} so far</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
