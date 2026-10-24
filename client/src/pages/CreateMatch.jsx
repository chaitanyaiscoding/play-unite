import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { createMatch, getTeam, listTeams, myTeams } from '../api.js';
import SearchSelect from '../components/SearchSelect.jsx';
import TeamStatus from '../components/TeamStatus.jsx';
import LineupEditor from '../components/LineupEditor.jsx';
import { XI_MAX, XI_MIN } from '../../../shared/cricket.js';

export const tossPath = (id) => `/matches/${id}/toss`;

// Why a team can't play right now, or null. Short-handed teams can still play.
const unavailable = (t) => (t.status === 'in_match' ? 'Playing a match' : null);

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

export default function CreateMatch() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [mine, setMine] = useState(null);
  const [all, setAll] = useState([]);
  const [teamName, setTeamName] = useState(params.get('team') ?? '');
  const [opponentName, setOpponentName] = useState('');
  const [team, setTeam] = useState(null);
  const [opponent, setOpponent] = useState(null);
  const [lineups, setLineups] = useState({ a: null, b: null });
  const [tab, setTab] = useState('a');
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

  // Load both squads; start from each team's saved default XI.
  useEffect(() => {
    setTeam(null);
    if (teamName) getTeam(teamName).then(setTeam).catch((err) => setError(err.message));
  }, [teamName]);
  useEffect(() => {
    setOpponent(null);
    if (opponentName) getTeam(opponentName).then(setOpponent).catch((err) => setError(err.message));
  }, [opponentName]);
  useEffect(() => {
    if (!team || !opponent) return setLineups({ a: null, b: null });
    const a = lineupOf(team);
    setLineups({ a, b: withoutClashes(a, lineupOf(opponent)) });
    setTab('a');
  }, [team, opponent]);

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

  const blockedFor = (other, otherTeam) => new Map((other?.xi ?? []).map((n) => [n, `Playing for ${otherTeam.name}`]));
  const okSize = (l) => l && l.xi.length >= XI_MIN && l.xi.length <= XI_MAX;
  const ready = okSize(lineups.a) && okSize(lineups.b);
  const opponentNames = new Set(opponent ? [opponent.captain, ...opponent.players].map((p) => p.name) : []);
  const shared = team ? [team.captain, ...team.players].filter((p) => opponentNames.has(p.name)).length : 0;

  // Take a player who's picked for the other side into this side's XI.
  const claim = (side, name) =>
    setLineups((l) => {
      const other = side === 'a' ? 'b' : 'a';
      return {
        [other]: { xi: l[other].xi.filter((n) => n !== name), bench: [...l[other].bench, name] },
        [side]: { xi: [...l[side].xi, name], bench: l[side].bench.filter((n) => n !== name) },
      };
    });

  const create = async () => {
    setBusy(true);
    setError('');
    try {
      const match = await createMatch(
        { name: team.name, playingXI: lineups.a.xi },
        { name: opponent.name, playingXI: lineups.b.xi }
      );
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

      {lineups.a && lineups.b && (
        <div className="card section">
          <h3>3. Playing XIs</h3>
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
      )}

      {lineups.a && lineups.b && (
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
          <button type="button" className="btn btn--sm" disabled={!ready || busy} onClick={create}>
            {busy ? 'Creating…' : 'Create match'}
          </button>
        </div>
      )}
      {error && <p className="help help--error sc-error">{error}</p>}
    </section>
  );
}
