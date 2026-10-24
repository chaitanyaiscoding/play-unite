import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getPlayerProfile, updateMe } from '../api.js';
import { usePlayer } from '../PlayerContext.jsx';
import { RESULTS, STAR_LEVELS, roleInfo } from '../../../shared/cricket.js';
import { RoleBadge, RolePicker, Stars } from '../components/PlayerBits.jsx';
import { teamPath } from './Home.jsx';

const resultLabel = (r) => RESULTS.find((x) => x.value === r)?.label ?? '';

// Progress towards the next star, e.g. 3 of 5 MVPs.
function LevelProgress({ mvpCount, level }) {
  if (!level.nextAt) return <p className="help">Top level reached. Legend status.</p>;
  const prev = STAR_LEVELS.find((l) => l.stars === level.stars)?.mvps ?? 0;
  const pct = ((mvpCount - prev) / (level.nextAt - prev)) * 100;
  const left = level.nextAt - mvpCount;
  return (
    <>
      <div className="progress" role="progressbar" aria-valuemin={prev} aria-valuemax={level.nextAt} aria-valuenow={mvpCount}>
        <span style={{ width: `${Math.max(4, pct)}%` }} />
      </div>
      <p className="help">
        {left} more MVP{left === 1 ? '' : 's'} for {level.stars + 1} star{level.stars ? 's' : ''}
      </p>
    </>
  );
}

export default function Profile() {
  const { name } = useParams();
  const { player: me, signIn } = usePlayer();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setData(null);
    getPlayerProfile(name)
      .then(setData)
      .catch((err) => setError(err.message));
  }, [name]);

  if (error) return <div className="card section"><p className="help help--error">{error}</p></div>;
  if (!data) return null;

  const { player, teams, recentMatches } = data;
  const isMe = me?.name === player.name;

  const changeRole = async (role) => {
    try {
      const res = await updateMe({ role });
      signIn(res.player);
      setData({ ...data, player: res.player });
      setEditing(false);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section className="stack">
      <Link to="/home" className="back">← Home</Link>

      <div className="card profile">
        <div className="profile__bg" aria-hidden="true" />
        <span className="profile__avatar" aria-hidden="true">{player.name[0].toUpperCase()}</span>
        <h2>{player.name}</h2>
        <div className="profile__meta">
          {player.role ? <RoleBadge role={player.role} /> : <span className="help">No role yet</span>}
          <span className="help">{roleInfo(player.role)?.label}</span>
        </div>
        <Stars count={player.level.stars} size="lg" />
        <p className="profile__level">{player.level.label}</p>
        <LevelProgress mvpCount={player.mvpCount} level={player.level} />
        {isMe && (
          <button type="button" className="link-btn profile__edit" onClick={() => setEditing(!editing)}>
            {editing ? 'Cancel' : player.role ? 'Change role' : 'Pick your role'}
          </button>
        )}
        {isMe && editing && <RolePicker value={player.role} onChange={changeRole} name="profile-role" />}
      </div>

      <div className="tiles">
        <div className="card tile">
          <span className="tile__num">{player.mvpCount}</span>
          <span className="help">MVP awards</span>
        </div>
        <div className="card tile">
          <span className="tile__num">{player.matchesPlayed}</span>
          <span className="help">Matches</span>
        </div>
        <div className="card tile">
          <span className="tile__num">
            {player.matchesPlayed ? Math.round((player.mvpCount / player.matchesPlayed) * 100) : 0}%
          </span>
          <span className="help">MVP rate</span>
        </div>
      </div>

      <div className="card section">
        <h3>Recent form</h3>
        {recentMatches.length === 0 ? (
          <p className="help">No completed matches yet.</p>
        ) : (
          <ul className="list">
            {recentMatches.map((m) => (
              <li key={m.id}>
                <Link to={`/matches/${m.id}`} className="list__row result-row">
                  <span className={`result result--${m.result}`}>{resultLabel(m.result)}</span>
                  <span className="list__main">
                    <strong>
                      {m.team}
                      {m.opponent ? ` vs ${m.opponent}` : ''}
                    </strong>
                    <span className="help">{new Date(m.endedAt).toLocaleDateString()}</span>
                  </span>
                  {m.isMvp && <span className="mvp-chip">MVP</span>}
                  <span className="points__pts">{m.points}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card section">
        <h3>Teams</h3>
        {teams.length === 0 ? (
          <p className="help">Not in a team yet.</p>
        ) : (
          <ul className="list">
            {teams.map((t) => (
              <li key={t.name}>
                <Link to={teamPath(t.name)} className="list__row">
                  <span className="team-badge" aria-hidden="true">{t.name[0].toUpperCase()}</span>
                  <span className="list__main"><strong>{t.name}</strong></span>
                  {t.isCaptain && <span className="badge badge--ok">Captain</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <details className="card section rules">
        <summary>How stars work</summary>
        <ul className="breakdown">
          {STAR_LEVELS.map((l) => (
            <li key={l.stars}>
              <span>
                <Stars count={l.stars} /> {l.label}
              </span>
              <span className="help">
                {l.mvps} MVP{l.mvps === 1 ? '' : 's'}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
