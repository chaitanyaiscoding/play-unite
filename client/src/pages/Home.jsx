import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { usePlayer } from '../PlayerContext.jsx';
import { checkTeamName, getMe, listTeams, myTeams, requestToJoin, updateMe } from '../api.js';
import SearchSelect from '../components/SearchSelect.jsx';
import TeamStatus, { STATUS_FILTERS, statusLabel } from '../components/TeamStatus.jsx';
import { RoleBadge, RolePicker, Stars, playerPath } from '../components/PlayerBits.jsx';
import MatchTile, { useMatchList } from '../components/MatchTile.jsx';

export const teamPath = (name) => `/teams/${encodeURIComponent(name)}`;

function CreateTeamCard() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await checkTeamName(name);
      if (!result.available) return setError(result.error);
      navigate(`/teams/new?name=${encodeURIComponent(result.name)}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card action">
      <div className="action__icon" aria-hidden="true">＋</div>
      <h3>Create a Team</h3>
      <p>Pick a unique team name, then add your squad. You&rsquo;ll be the captain.</p>
      <form className="form" onSubmit={onSubmit} noValidate>
        <label htmlFor="team-name">Team name</label>
        <input
          id="team-name"
          className="input"
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError('');
          }}
          placeholder="e.g. Royal Strikers"
          maxLength={30}
          autoComplete="off"
          aria-invalid={Boolean(error)}
          aria-describedby="team-name-help"
        />
        <p id="team-name-help" className={error ? 'help help--error' : 'help'}>
          {error || 'Team names are unique.'}
        </p>
        <button type="submit" className="btn" disabled={busy || name.trim().length < 2}>
          {busy ? 'Checking…' : 'Continue'}
        </button>
      </form>
    </div>
  );
}

// "Request to join" / "Requested" / "You're in" for a team summary.
function JoinButton({ team, onJoined }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (team.isMember) return <span className="badge badge--ok">You&rsquo;re in</span>;
  if (team.requested) return <span className="badge">Requested</span>;
  if (team.playerCount >= 15) return <span className="badge">Full</span>;

  const join = async () => {
    setBusy(true);
    setError('');
    try {
      await requestToJoin(team.name);
      await onJoined();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <span className="join">
      <button type="button" className="btn btn--sm" onClick={join} disabled={busy}>
        {busy ? 'Sending…' : 'Request to join'}
      </button>
      {error && <span className="help help--error">{error}</span>}
    </span>
  );
}

// Matches being played right now (refreshes itself).
function LiveNow() {
  const live = useMatchList('live', 10);
  if (!live) return null;
  return (
    <div className="card section">
      <div className="section__head">
        <h3 className="live-title">
          <span className="live-badge__dot" aria-hidden="true" /> Live now
        </h3>
        <Link to="/matches" className="section__link">
          All matches
        </Link>
      </div>
      {live.length === 0 ? (
        <p className="help">No matches in progress right now. Start one below.</p>
      ) : (
        <div className="match-list">
          {live.map((m) => (
            <MatchTile key={m.id} match={m} />
          ))}
        </div>
      )}
    </div>
  );
}

function RecentResults() {
  const recent = useMatchList('completed', 3);
  if (!recent?.length) return null;
  return (
    <div className="card section">
      <div className="section__head">
        <h3>Recent results</h3>
        <Link to="/matches" className="section__link">
          See all
        </Link>
      </div>
      <div className="match-list">
        {recent.map((m) => (
          <MatchTile key={m.id} match={m} />
        ))}
      </div>
    </div>
  );
}

function CreateMatchCard() {
  return (
    <div className="card action action--match">
      <div className="action__icon action__icon--match" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <circle cx="12" cy="12" r="8.5" />
          <path d="M8 4.8c2.6 4.4 2.6 10 0 14.4M16 4.8c-2.6 4.4-2.6 10 0 14.4" />
        </svg>
      </div>
      <h3>Create a Match</h3>
      <p>Pick your team and an opponent, set both playing XIs, toss the coin and start scoring.</p>
      <Link to="/matches/new" className="btn match-cta">
        Create a match
      </Link>
    </div>
  );
}

function JoinTeamCard({ teams, onJoined }) {
  const [selected, setSelected] = useState(null);
  const [sent, setSent] = useState('');

  const options = teams.map((t) => ({
    value: t.name,
    label: t.name,
    meta: t.isMember ? 'Joined' : t.requested ? 'Requested' : statusLabel(t),
  }));
  const team = selected && teams.find((t) => t.name === selected);

  return (
    <div className="card action">
      <div className="action__icon action__icon--alt" aria-hidden="true">⇥</div>
      <h3>Join a Team</h3>
      <p>Find a team and ask to join. The captain decides whether you&rsquo;re in.</p>
      <div className="form">
        <label>Team</label>
        <SearchSelect
          label="Search teams"
          options={options}
          placeholder={teams.length ? 'Search teams…' : 'No teams yet'}
          emptyText="No teams match"
          clearOnSelect={false}
          onSelect={(o) => {
            setSelected(o.value);
            setSent('');
          }}
        />
        {team && (
          <div className="picked">
            <div className="picked__info">
              <Link to={teamPath(team.name)} className="picked__name">
                {team.name}
              </Link>
              <div className="help">
                Captain {team.captain} · {team.size} players
              </div>
              <TeamStatus team={team} />
            </div>
            <JoinButton
              team={team}
              onJoined={async () => {
                setSent(`Request sent. ${team.captain} will be notified.`);
                await onJoined();
              }}
            />
          </div>
        )}
        {sent && <p className="help help--ok">{sent}</p>}
      </div>
    </div>
  );
}

function TeamRow({ team, action }) {
  return (
    <li className="team-row">
      <Link to={teamPath(team.name)} className="team-row__link">
        <span className="team-badge" aria-hidden="true">
          {team.name[0].toUpperCase()}
        </span>
        <span className="list__main">
          <strong>{team.name}</strong>
          <span className="help">
            Captain {team.captain} · {team.size} players
          </span>
        </span>
      </Link>
      <span className="team-row__side">
        <TeamStatus team={team} />
        {action}
      </span>
    </li>
  );
}

function MyTeams({ teams }) {
  if (!teams) return null;
  return (
    <div className="card section">
      <h3>My Teams</h3>
      {teams.length === 0 ? (
        <p className="help">You&rsquo;re not in any team yet. Create one or ask to join one.</p>
      ) : (
        <ul className="list">
          {teams.map((t) => (
            <TeamRow key={t.name} team={t} action={t.isCaptain && <span className="badge badge--ok">Captain</span>} />
          ))}
        </ul>
      )}
    </div>
  );
}

function AllTeams({ version, onJoined }) {
  const [status, setStatus] = useState('');
  const [teams, setTeams] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    listTeams({ status })
      .then((t) => live && setTeams(t))
      .catch((err) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, [status, version]);

  return (
    <div className="card section">
      <div className="section__head">
        <h3>All Teams</h3>
        {teams && <span className="help">{teams.length} teams</span>}
      </div>
      <div className="filters" role="tablist" aria-label="Filter teams by status">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            role="tab"
            aria-selected={status === f.value}
            className={`filter${status === f.value ? ' is-active' : ''}`}
            onClick={() => setStatus(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>
      {error && <p className="help help--error">{error}</p>}
      {teams && teams.length === 0 && <p className="help empty">No teams here yet.</p>}
      {teams && teams.length > 0 && (
        <ul className="list">
          {teams.map((t) => (
            <TeamRow key={t.name} team={t} action={<JoinButton team={t} onJoined={onJoined} />} />
          ))}
        </ul>
      )}
    </div>
  );
}

// Greeting with the player's role, star level and MVPs; asks for a role if missing.
function PlayerCard() {
  const { player, signIn } = usePlayer();
  const [error, setError] = useState('');

  // Pick up new MVPs/stars earned since sign-in.
  useEffect(() => {
    getMe()
      .then((res) => signIn(res.player))
      .catch(() => {});
  }, [signIn]);

  const pickRole = async (role) => {
    try {
      signIn((await updateMe({ role })).player);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="card home__banner">
      <h2>Hi {player.name} 👋</h2>
      <div className="home__me">
        <RoleBadge role={player.role} />
        <Stars count={player.level?.stars ?? 0} />
        <span className="help">
          {player.level?.label ?? 'Rookie'} · {player.mvpCount ?? 0} MVP{player.mvpCount === 1 ? '' : 's'}
        </span>
      </div>
      <Link to={playerPath(player.name)} className="home__profile">
        View profile →
      </Link>
      {!player.role && (
        <div className="home__role">
          <p className="cta__label">What do you play as?</p>
          <RolePicker value={null} onChange={pickRole} name="home-role" />
          {error && <p className="help help--error">{error}</p>}
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const [teams, setTeams] = useState([]);
  const [mine, setMine] = useState(null);
  const [version, setVersion] = useState(0);

  const refresh = useCallback(async () => {
    const [all, my] = await Promise.all([listTeams(), myTeams()]);
    setTeams(all);
    setMine(my);
    setVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    refresh().catch(() => setMine([]));
  }, [refresh]);

  return (
    <section className="stack">
      <PlayerCard />
      <LiveNow />
      <CreateMatchCard />
      <div className="actions">
        <CreateTeamCard />
        <JoinTeamCard teams={teams} onJoined={refresh} />
      </div>
      <MyTeams teams={mine} />
      <RecentResults />
      <AllTeams version={version} onJoined={refresh} />
    </section>
  );
}
