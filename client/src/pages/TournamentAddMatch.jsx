import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  addConnectedMatch,
  addExistingMatch,
  addTournamentMatch,
  eligibleMatches,
  getTeam,
  getTournament,
  listTeams,
} from '../api.js';
import SearchSelect from '../components/SearchSelect.jsx';
import MatchLineups from '../components/MatchLineups.jsx';
import { tossPath, unavailable } from './CreateMatch.jsx';

const MODES = [
  ['new', 'New'],
  ['connected', 'Connected'],
  ['existing', 'Existing'],
];

// Loads a team's squad whenever its name changes.
function useSquad(name, onError) {
  const [team, setTeam] = useState(null);
  useEffect(() => {
    setTeam(null);
    if (name) getTeam(name).then(setTeam).catch((err) => onError(err.message));
  }, [name, onError]);
  return team;
}

// Lineups for a match whose two teams are `names`, picked or already decided.
function Lineups({ tournamentId, names, payload, onError }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const team = useSquad(names[0], onError);
  const opponent = useSquad(names[1], onError);

  const create = async (xiA, xiB) => {
    setBusy(true);
    onError('');
    try {
      const t = await addTournamentMatch(
        tournamentId,
        { name: team.name, playingXI: xiA },
        { name: opponent.name, playingXI: xiB },
        payload
      );
      const entry = payload.entry ? t.entries.find((e) => e.number === payload.entry) : t.entries.at(-1);
      navigate(tossPath(entry.match.id), { replace: true });
    } catch (err) {
      onError(err.message);
      setBusy(false);
    }
  };

  return <MatchLineups team={team} opponent={opponent} busy={busy} onCreate={create} />;
}

function NewMatch({ tournamentId, onError }) {
  const [teams, setTeams] = useState([]);
  const [a, setA] = useState('');
  const [b, setB] = useState('');

  useEffect(() => {
    listTeams().then(setTeams).catch((err) => onError(err.message));
  }, [onError]);

  const options = (other) =>
    teams
      .filter((t) => t.name !== other)
      .map((t) => ({
        value: t.name,
        label: t.name,
        meta: unavailable(t) ?? `${t.size} player${t.size === 1 ? '' : 's'}`,
        disabled: Boolean(unavailable(t)),
      }));

  return (
    <>
      <div className="card section form">
        <h3>Pick two teams</h3>
        <SearchSelect label="First team" options={options(b)} placeholder="First team…" emptyText="No teams" clearOnSelect={false} onSelect={(o) => setA(o.value)} />
        <SearchSelect label="Second team" options={options(a)} placeholder="Second team…" emptyText="No teams" clearOnSelect={false} onSelect={(o) => setB(o.value)} />
      </div>
      {a && b && <Lineups tournamentId={tournamentId} names={[a, b]} payload={{}} onError={onError} />}
    </>
  );
}

const describe = (e) => {
  const names = (e.match?.teams ?? e.teams).map((t) => t?.name).filter(Boolean);
  return `Match ${e.number}${names.length === 2 ? ` · ${names[0]} vs ${names[1]}` : ''}`;
};

function ConnectedMatch({ tournament, onError }) {
  const navigate = useNavigate();
  const options = tournament.entries.filter((e) => !e.final);
  const [sides, setSides] = useState([
    { number: options[0]?.number ?? null, take: 'winner' },
    { number: options[1]?.number ?? null, take: 'winner' },
  ]);
  const [busy, setBusy] = useState(false);

  if (options.length < 2) {
    return (
      <div className="card section">
        <p className="help">Add at least two matches first, then connect them.</p>
      </div>
    );
  }

  const change = (i, patch) => setSides((s) => s.map((side, j) => (j === i ? { ...side, ...patch } : side)));
  const same = sides[0].number === sides[1].number;
  const label = (s) => `${s.take === 'winner' ? 'Winner' : 'Loser'} of Match ${s.number}`;

  const save = async () => {
    setBusy(true);
    onError('');
    try {
      await addConnectedMatch(tournament.id, sides);
      navigate(`/tournaments/${tournament.id}`, { replace: true });
    } catch (err) {
      onError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="card section form">
      <h3>Connect two matches</h3>
      {sides.map((side, i) => (
        <div key={i} className="t-side">
          <label className="help" htmlFor={`t-side-${i}`}>Side {i + 1} comes from</label>
          <select
            id={`t-side-${i}`}
            className="input"
            value={side.number ?? ''}
            onChange={(e) => change(i, { number: Number(e.target.value) })}
          >
            {options.map((e) => (
              <option key={e.number} value={e.number}>{describe(e)}</option>
            ))}
          </select>
          <div className="t-take" role="radiogroup" aria-label={`Side ${i + 1} takes`}>
            {['winner', 'loser'].map((take) => (
              <button
                key={take}
                type="button"
                role="radio"
                aria-checked={side.take === take}
                className={`t-take__btn t-take__btn--${take}${side.take === take ? ' is-active' : ''}`}
                onClick={() => change(i, { take })}
              >
                {take === 'winner' ? 'Winner' : 'Loser'}
              </button>
            ))}
          </div>
        </div>
      ))}
      {same ? (
        <p className="help help--warn">Pick two different matches.</p>
      ) : (
        <p className="help">New match: <strong>{label(sides[0])}</strong> vs <strong>{label(sides[1])}</strong></p>
      )}
      <button type="button" className="btn" disabled={same || busy} onClick={save}>
        {busy ? 'Adding…' : 'Add to map'}
      </button>
    </div>
  );
}

function ExistingMatch({ tournamentId, onError }) {
  const navigate = useNavigate();
  const [matches, setMatches] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    eligibleMatches(tournamentId).then(setMatches).catch((err) => onError(err.message));
  }, [tournamentId, onError]);

  const add = async (id) => {
    setBusy(true);
    onError('');
    try {
      await addExistingMatch(tournamentId, id);
      navigate(`/tournaments/${tournamentId}`, { replace: true });
    } catch (err) {
      onError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="card section">
      <h3>Add an existing match</h3>
      <p className="help">Running or completed matches that aren&rsquo;t in a tournament. They keep their own scorer.</p>
      {matches?.length === 0 && <p className="help empty">No matches to add right now.</p>}
      <div className="t-list">
        {matches?.map((m) => (
          <div key={m.id} className="t-row t-row--action">
            <span className="list__main">
              <strong>{m.teams[0].name} vs {m.teams[1].name}</strong>
              <span className={m.status === 'completed' ? 'help' : 't-row__live'}>{m.line}</span>
            </span>
            <button type="button" className="btn btn--sm" disabled={busy} onClick={() => add(m.id)}>Add</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// Adds a match to a tournament: new, connected or existing. With ?entry=N or
// ?final=1 the teams are already decided, so it goes straight to the lineups.
export default function TournamentAddMatch() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const [t, setT] = useState(null);
  const [mode, setMode] = useState('new');
  const [error, setError] = useState('');

  useEffect(() => {
    getTournament(id).then(setT).catch((err) => setError(err.message));
  }, [id]);

  if (!t) return error ? <p className="help help--error">{error}</p> : null;

  const backLink = <Link to={`/tournaments/${id}`} className="back">← {t.name}</Link>;
  if (!t.canManage) {
    return (
      <section className="stack">
        {backLink}
        <p className="help">Only the organiser can add matches, while the tournament is running.</p>
      </section>
    );
  }

  const entryNumber = Number(params.get('entry')) || null;
  const entry = entryNumber ? t.entries.find((e) => e.number === entryNumber && e.state === 'ready') : null;
  const fixed = entry
    ? { title: describe(entry), names: entry.teams.map((x) => x.name), payload: { entry: entry.number } }
    : params.get('final') && t.finalTeams
      ? { title: 'The final', names: t.finalTeams.map((x) => x.name), payload: { final: true } }
      : null;

  if (entryNumber && !entry) {
    return (
      <section className="stack">
        {backLink}
        <p className="help">This match&rsquo;s teams aren&rsquo;t ready yet.</p>
      </section>
    );
  }

  return (
    <section className="stack create-match">
      {backLink}
      {fixed ? (
        <div className="card section">
          <p className="eyebrow">{t.name}</p>
          <h3 className="create-match__title">{fixed.title}</h3>
          <p className="help">{fixed.names[0]} vs {fixed.names[1]}. Set both playing XIs, then head out for the toss.</p>
        </div>
      ) : (
        <div className="card section">
          <p className="eyebrow">{t.name}</p>
          <h3 className="create-match__title">Add a match</h3>
          {t.blockers.add ? (
            <p className="help help--warn">{t.blockers.add}</p>
          ) : (
            <div className="tabs t-tabs" role="tablist">
              {MODES.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={mode === value}
                  className={`tab${mode === value ? ' is-active' : ''}`}
                  onClick={() => setMode(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {fixed && <Lineups tournamentId={id} names={fixed.names} payload={fixed.payload} onError={setError} />}
      {!fixed && !t.blockers.add && mode === 'new' && <NewMatch tournamentId={id} onError={setError} />}
      {!fixed && !t.blockers.add && mode === 'connected' && <ConnectedMatch tournament={t} onError={setError} />}
      {!fixed && !t.blockers.add && mode === 'existing' && <ExistingMatch tournamentId={id} onError={setError} />}
      {error && <p className="help help--error sc-error">{error}</p>}
    </section>
  );
}
