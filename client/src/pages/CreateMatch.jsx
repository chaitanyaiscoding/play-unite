import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { createMatch, getTeam, listTeams, myTeams } from '../api.js';
import SearchSelect from '../components/SearchSelect.jsx';
import TeamStatus from '../components/TeamStatus.jsx';
import MatchLineups from '../components/MatchLineups.jsx';

export const tossPath = (id) => `/matches/${id}/toss`;

// Why a team can't play right now, or null. Short-handed teams can still play.
export const unavailable = (t) => (t.status === 'in_match' ? 'Playing a match' : null);

export default function CreateMatch() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [mine, setMine] = useState(null);
  const [all, setAll] = useState([]);
  const [teamName, setTeamName] = useState(params.get('team') ?? '');
  const [opponentName, setOpponentName] = useState('');
  const [team, setTeam] = useState(null);
  const [opponent, setOpponent] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([myTeams(), listTeams()])
      .then(([m, a]) => {
        setMine(m);
        setAll(a);
      })
      .catch((err) => setError(err.message));
  }, []);

  // Load both squads.
  useEffect(() => {
    setTeam(null);
    if (teamName) getTeam(teamName).then(setTeam).catch((err) => setError(err.message));
  }, [teamName]);
  useEffect(() => {
    setOpponent(null);
    if (opponentName) getTeam(opponentName).then(setOpponent).catch((err) => setError(err.message));
  }, [opponentName]);

  const opponentOptions = useMemo(
    () =>
      all
        .filter((t) => t.name !== teamName)
        .map((t) => ({
          value: t.name,
          label: t.name,
          meta: unavailable(t) ?? `${t.size} player${t.size === 1 ? '' : 's'}`,
          disabled: Boolean(unavailable(t)),
        })),
    [all, teamName]
  );

  const create = async (xiA, xiB) => {
    setBusy(true);
    setError('');
    try {
      const match = await createMatch({ name: team.name, playingXI: xiA }, { name: opponent.name, playingXI: xiB });
      navigate(tossPath(match.id), { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  if (!mine) return error ? <p className="help help--error">{error}</p> : null;

  return (
    <section className="stack create-match">
      <Link to="/home" className="back">← Home</Link>
      <div className="card section">
        <p className="eyebrow">New match</p>
        <h3 className="create-match__title">Create a match</h3>
        <p className="help">Pick your team and an opponent, set both playing XIs, then head out for the toss.</p>
      </div>

      <div className="card section">
        <h3>1. Your team</h3>
        {mine.length === 0 ? (
          <p className="help">
            You&rsquo;re not in a team yet. <Link to="/home">Create or join one</Link> first.
          </p>
        ) : (
          <div className="team-pick" role="radiogroup" aria-label="Your team">
            {mine.map((t) => {
              const why = unavailable(t);
              return (
                <label key={t.name} className={`team-pick__item${teamName === t.name ? ' is-selected' : ''}${why ? ' is-disabled' : ''}`}>
                  <input
                    type="radio"
                    name="my-team"
                    className="sr-only"
                    checked={teamName === t.name}
                    disabled={Boolean(why)}
                    onChange={() => {
                      setTeamName(t.name);
                      if (opponentName === t.name) setOpponentName('');
                    }}
                  />
                  <span className="team-badge" aria-hidden="true">{t.name[0].toUpperCase()}</span>
                  <span className="list__main">
                    <strong>{t.name}</strong>
                    <span className="help">{t.size} players</span>
                  </span>
                  <TeamStatus team={t} />
                </label>
              );
            })}
          </div>
        )}
      </div>

      {teamName && (
        <div className="card section">
          <h3>2. Opponent</h3>
          <SearchSelect
            label="Search opponent teams"
            options={opponentOptions}
            placeholder="Search teams…"
            emptyText="No other teams"
            clearOnSelect={false}
            onSelect={(o) => setOpponentName(o.value)}
          />
          {opponentName && <p className="help help--ok">vs {opponentName}</p>}
        </div>
      )}

      <MatchLineups heading="3. Playing XIs" team={team} opponent={opponent} busy={busy} onCreate={create} />
      {error && <p className="help help--error sc-error">{error}</p>}
    </section>
  );
}
