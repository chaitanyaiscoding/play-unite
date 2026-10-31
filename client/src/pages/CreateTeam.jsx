import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { usePlayer } from '../PlayerContext.jsx';
import { createTeam } from '../api.js';
import PlayerPicker from '../components/PlayerPicker.jsx';
import { teamPath } from './Home.jsx';

const MIN_PLAYERS = 1;
const MAX_PLAYERS = 20;

export default function CreateTeam() {
  const { player } = usePlayer();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const name = params.get('name')?.trim();
  const [players, setPlayers] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!name) return <Navigate to="/home" replace />;

  const onCreate = async () => {
    setError('');
    setBusy(true);
    try {
      const team = await createTeam(name, players);
      navigate(teamPath(team.name), { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <section className="stack">
      <Link to="/home" className="back">
        ← Back
      </Link>
      <div className="card team__hero">
        <span className="team-badge team-badge--lg" aria-hidden="true">
          {name[0].toUpperCase()}
        </span>
        <div>
          <p className="eyebrow">New team</p>
          <h2>{name}</h2>
          <p className="team__sub">Captain: {player.name}</p>
        </div>
      </div>

      <div className="card section">
        <div className="section__head">
          <h3>Add players</h3>
          <span className={`count${players.length >= MIN_PLAYERS ? ' count--ok' : ''}`}>
            {players.length} / {MAX_PLAYERS}
          </span>
        </div>
        <p className="help">
          Add at least {MIN_PLAYERS} and up to {MAX_PLAYERS} players. Only you, as captain, can add players.
        </p>
        <PlayerPicker selected={players} onChange={setPlayers} exclude={[player.name]} max={MAX_PLAYERS} />

        {error && <p className="help help--error">{error}</p>}
        <div className="section__foot">
          <Link to="/home" className="btn btn--ghost btn--sm">
            Cancel
          </Link>
          <button
            type="button"
            className="btn btn--sm"
            onClick={onCreate}
            disabled={busy || players.length < MIN_PLAYERS}
          >
            {busy ? 'Creating…' : 'Create team'}
          </button>
        </div>
      </div>
    </section>
  );
}
