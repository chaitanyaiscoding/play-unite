import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { acceptRequest, addTeamPlayers, getTeam, rejectRequest, requestToJoin } from '../api.js';
import { useNotifications } from '../NotificationsContext.jsx';
import PlayerPicker from '../components/PlayerPicker.jsx';
import TeamStatus from '../components/TeamStatus.jsx';
import LineupBoard from '../components/LineupBoard.jsx';
import { PlayerName } from '../components/PlayerBits.jsx';
import { RESULTS } from '../../../shared/cricket.js';

export const matchPath = (id) => `/matches/${id}`;
const resultLabel = (r) => RESULTS.find((x) => x.value === r)?.label ?? '';
const vs = (opponent) => (opponent ? `vs ${opponent}` : 'Match');

// Live match link, or "Create a match" for any member of the team.
function MatchCard({ team }) {
  const m = team.currentMatch;
  if (m) {
    const label = m.status === 'toss' ? 'Toss time' : 'Live';
    return (
      <div className="card section match match--live">
        <div className="match__body">
          <h3>{vs(m.opponent)}</h3>
          <p className="help">
            {label} · since {new Date(m.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </p>
        </div>
        <Link to={m.status === 'toss' ? `/matches/${m.id}/toss` : matchPath(m.id)} className="btn btn--sm">
          {m.status === 'toss' ? 'Go to toss' : 'Match centre'}
        </Link>
      </div>
    );
  }
  if (!team.isMember) return null;
  return (
    <div className="card section match">
      <div className="match__body">
        <h3>Match</h3>
        <p className="help">
          {team.status === 'needs_players'
            ? `${team.playersNeeded} short of a full XI, but you can still play a smaller match.`
            : 'Challenge another team: pick both XIs, toss and start scoring.'}
        </p>
      </div>
      <Link to={`/matches/new?team=${encodeURIComponent(team.name)}`} className="btn btn--sm">
        Create a match
      </Link>
    </div>
  );
}

// Read-only XI + bench (non-captains, or anyone during a match).
function LineupView({ title, xi, bench, captain }) {
  return (
    <div className="card section">
      <div className="section__head">
        <h3>{title}</h3>
        <span className="help">{xi.length} / 11</span>
      </div>
      <ol className="list lineup__readonly">
        {xi.map((p, i) => (
          <li key={p.name} className="list__row">
            <span className="lineup__num">{i + 1}</span>
            <PlayerName player={p} captain={p.name === captain} />
          </li>
        ))}
      </ol>
      {bench.length > 0 && (
        <>
          <div className="lineup__bench-head">
            <h4>Bench</h4>
          </div>
          <ul className="list">
            {bench.map((p) => (
              <li key={p.name} className="list__row">
                <PlayerName player={p} captain={p.name === captain} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function RecentMatches({ matches }) {
  if (!matches.length) return null;
  return (
    <div className="card section">
      <h3>Recent matches</h3>
      <ul className="list">
        {matches.map((m) => (
          <li key={m.id}>
            <Link to={matchPath(m.id)} className="list__row result-row">
              <span className={`result result--${m.result}`}>{resultLabel(m.result)}</span>
              <span className="list__main">
                <strong>{vs(m.opponent)}</strong>
                <span className="help">
                  {m.summary ? `${m.summary} · ` : ''}
                  {m.mvp ? `MVP ${m.mvp.name} · ${m.mvp.points} pts` : 'No MVP'} ·{' '}
                  {new Date(m.endedAt).toLocaleDateString()}
                </span>
              </span>
              <span className="chev" aria-hidden="true">›</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AddPlayers({ team, onAdded }) {
  const [selected, setSelected] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const spots = team.maxPlayers - team.players.length;

  const add = async () => {
    setError('');
    setBusy(true);
    try {
      onAdded(await addTeamPlayers(team.name, selected));
      setSelected([]);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card section">
      <div className="section__head">
        <h3>Add players</h3>
        <span className="help">{spots} spots left</span>
      </div>
      <PlayerPicker
        selected={selected}
        onChange={setSelected}
        exclude={[team.captain.name, ...team.players.map((p) => p.name)]}
        max={spots}
      />
      {error && <p className="help help--error">{error}</p>}
      {selected.length > 0 && (
        <div className="section__foot">
          <button type="button" className="btn btn--sm" onClick={add} disabled={busy}>
            {busy ? 'Adding…' : `Add ${selected.length} player${selected.length > 1 ? 's' : ''}`}
          </button>
        </div>
      )}
    </div>
  );
}

export function RequestActions({ id, onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const act = async (fn) => {
    setBusy(true);
    setError('');
    try {
      await fn(id);
      await onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <span className="req-actions">
      {error && <span className="help help--error">{error}</span>}
      <button type="button" className="btn btn--sm" disabled={busy} onClick={() => act(acceptRequest)}>
        Accept
      </button>
      <button type="button" className="btn btn--sm btn--danger" disabled={busy} onClick={() => act(rejectRequest)}>
        Reject
      </button>
    </span>
  );
}

export default function Team() {
  const { name } = useParams();
  const notifications = useNotifications();
  const [team, setTeam] = useState(null);
  const [error, setError] = useState('');
  const [joinMsg, setJoinMsg] = useState('');

  const load = useCallback(
    () =>
      getTeam(name)
        .then(setTeam)
        .catch((err) => setError(err.message)),
    [name]
  );
  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <section className="stack">
        <Link to="/home" className="back">← Home</Link>
        <div className="card section"><p className="help help--error">{error}</p></div>
      </section>
    );
  }
  if (!team) return null;

  const join = async () => {
    try {
      await requestToJoin(team.name);
      setJoinMsg(`Request sent. ${team.captain.name} will be notified.`);
      load();
    } catch (err) {
      setJoinMsg(err.message);
    }
  };

  const afterDecision = async () => {
    await Promise.all([load(), notifications.refresh()]);
  };

  const inMatch = team.status === 'in_match' && team.currentMatch;

  return (
    <section className="stack">
      <Link to="/home" className="back">← Home</Link>
      <div className="card team__hero">
        <span className="team-badge team-badge--lg" aria-hidden="true">
          {team.name[0].toUpperCase()}
        </span>
        <div className="team__info">
          <h2>{team.name}</h2>
          <p className="team__sub">
            Captain: {team.captain.name} · {team.size} players
          </p>
          <TeamStatus team={team} />
        </div>
        <div className="team__cta">
          {team.isCaptain ? (
            <span className="badge badge--light">You&rsquo;re the captain</span>
          ) : team.isMember ? (
            <span className="badge badge--light">You&rsquo;re in this team</span>
          ) : team.requested ? (
            <span className="badge badge--light">Request pending</span>
          ) : team.players.length >= team.maxPlayers ? (
            <span className="badge badge--light">Team full</span>
          ) : (
            <button type="button" className="btn btn--light btn--sm" onClick={join}>
              Request to join
            </button>
          )}
        </div>
      </div>
      {joinMsg && <p className="help">{joinMsg}</p>}

      <MatchCard team={team} />

      {team.isCaptain && team.requests.length > 0 && (
        <div className="card section">
          <h3>Join requests</h3>
          <ul className="list">
            {team.requests.map((r) => (
              <li key={r.id} className="list__row">
                <span className="avatar avatar--sm" aria-hidden="true">{r.player[0].toUpperCase()}</span>
                <span className="list__main"><span><strong>{r.player}</strong> wants to join</span></span>
                <RequestActions id={r.id} onDone={afterDecision} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {inMatch ? (
        <LineupView
          title={`Match XI ${vs(team.currentMatch.opponent).toLowerCase()}`}
          xi={team.currentMatch.playingXI}
          bench={team.currentMatch.bench}
          captain={team.captain.name}
        />
      ) : team.isCaptain ? (
        <LineupBoard team={team} onSaved={setTeam} />
      ) : (
        <LineupView
          title="Playing XI"
          xi={team.lineup.playingXI}
          bench={team.lineup.bench}
          captain={team.captain.name}
        />
      )}

      <RecentMatches matches={team.recentMatches} />

      <div className="card section">
        <div className="section__head">
          <h3>Squad</h3>
          <span className="help">
            {team.size} / {team.maxPlayers + 1} incl. captain
          </span>
        </div>
        <div
          className="progress"
          role="progressbar"
          aria-label="Players towards a full XI"
          aria-valuemin={0}
          aria-valuemax={team.squadTarget}
          aria-valuenow={Math.min(team.size, team.squadTarget)}
        >
          <span style={{ width: `${Math.min(100, (team.size / team.squadTarget) * 100)}%` }} />
        </div>
        <p className="help">
          {team.size >= team.squadTarget
            ? `Full XI ready (${team.size} players).`
            : `${team.size} of ${team.squadTarget} players for a full XI.`}
        </p>
        <ul className="list">
          {[team.captain, ...team.players].map((p) => (
            <li key={p.name} className="list__row">
              <span className="avatar avatar--sm" aria-hidden="true">{p.name[0].toUpperCase()}</span>
              <PlayerName player={p} captain={p.name === team.captain.name} />
            </li>
          ))}
        </ul>
      </div>

      {team.isCaptain && team.players.length < team.maxPlayers && <AddPlayers team={team} onAdded={setTeam} />}
    </section>
  );
}
