import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { completeTournament, getTournament, removeTournamentEntry, reorderTournament } from '../api.js';
import TournamentMap from '../components/TournamentMap.jsx';

const REFRESH_MS = 10000;

function StandingsTable({ tournament, reordering, onMove }) {
  const rows = tournament.standings;
  if (!rows.length) return <p className="help empty">The table fills in as matches finish.</p>;
  const level = (a, b) => rows[a] && rows[b] && rows[a].won === rows[b].won;

  return (
    <table className="sc-table t-table">
      <thead>
        <tr>
          <th>Team</th>
          <th>P</th>
          <th>W</th>
          <th>L</th>
          <th>NR</th>
          {reordering && <th aria-label="Move" />}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.name} className={i < 2 ? 'is-top' : ''}>
            <td className="t-table__team">
              <span className="t-table__rank">{i + 1}</span>
              <span className="t-table__name">{r.name}</span>
            </td>
            <td className="num">{r.played}</td>
            <td className="num strong">{r.won}</td>
            <td className="num">{r.lost}</td>
            <td className="num">{r.noResult}</td>
            {reordering && (
              <td className="t-table__move">
                <button type="button" className="t-move" disabled={!level(i, i - 1)} aria-label={`Move ${r.name} up`} onClick={() => onMove(i, i - 1)}>↑</button>
                <button type="button" className="t-move" disabled={!level(i, i + 1)} aria-label={`Move ${r.name} down`} onClick={() => onMove(i, i + 1)}>↓</button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Awards({ tournament }) {
  const { batsman, bowler } = tournament.awards;
  const mvps = tournament.entries.filter((e) => e.match?.mvp);
  return (
    <div className="card section">
      <h3>Awards</h3>
      <div className="t-awards">
        <div className="t-award">
          <span className="help">Best batsman</span>
          <strong>{batsman?.name ?? '–'}</strong>
          {batsman && <span className="help">{batsman.runs} runs</span>}
        </div>
        <div className="t-award">
          <span className="help">Best bowler</span>
          <strong>{bowler?.name ?? '–'}</strong>
          {bowler && <span className="help">{bowler.wickets} wicket{bowler.wickets === 1 ? '' : 's'}</span>}
        </div>
      </div>
      {mvps.length > 0 && (
        <>
          <h4 className="t-subhead">Match MVPs</h4>
          <ul className="list">
            {mvps.map((e) => (
              <li key={e.number} className="t-mvp">
                <span className="help">{e.final ? 'Final' : `Match ${e.number}`}</span>
                <strong>{e.match.mvp.name}</strong>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export default function Tournament() {
  const { id } = useParams();
  const [t, setT] = useState(null);
  const [tab, setTab] = useState('map');
  const [reordering, setReordering] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => getTournament(id).then(setT), [id]);
  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [load]);

  const running = t?.status === 'running';
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => load().catch(() => {}), REFRESH_MS);
    return () => clearInterval(timer);
  }, [running, load]);

  const act = async (fn) => {
    setBusy(true);
    setError('');
    try {
      setT(await fn());
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!t) return error ? <p className="help help--error">{error}</p> : null;

  const move = (from, to) => {
    const names = t.standings.map((r) => r.name);
    [names[from], names[to]] = [names[to], names[from]];
    act(() => reorderTournament(id, names));
  };
  const remove = (entry) => {
    if (window.confirm(`Take Match ${entry.number} out of ${t.name}?`)) act(() => removeTournamentEntry(id, entry.number));
  };
  const end = () => {
    if (window.confirm(`End ${t.name}? Nothing in it can be changed afterwards.`)) act(() => completeTournament(id));
  };

  const hasLevelTeams = t.standings.some((r, i) => i > 0 && r.won === t.standings[i - 1].won);

  return (
    <section className={`stack${t.canManage ? ' t-page--bar' : ''}`}>
      <Link to="/tournaments" className="back">← Tournaments</Link>

      <div className="card section">
        <p className="eyebrow">{running ? 'Running' : 'Completed'}</p>
        <h2 className="t-title">{t.name}</h2>
        <p className="help">Organised by {t.organiser}</p>
        {t.champion && <p className="t-champion">🏆 Champion: {t.champion.name}</p>}
      </div>

      <div className="tabs tabs--teams t-tabs" role="tablist">
        {[['map', 'Map'], ['table', 'Table & awards']].map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={`tab${tab === value ? ' is-active' : ''}`}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <p className="help help--error">{error}</p>}

      {tab === 'map' && (
        <div className="card section">
          <TournamentMap tournament={t} onRemove={remove} />
        </div>
      )}

      {tab === 'table' && (
        <>
          <div className="card section">
            <div className="section__head section__head--center">
              <h3>Table</h3>
              {t.canManage && hasLevelTeams && (
                <button type="button" className="link-btn" onClick={() => setReordering((r) => !r)}>
                  {reordering ? 'Done' : 'Change order'}
                </button>
              )}
            </div>
            <StandingsTable tournament={t} reordering={reordering && t.canManage} onMove={move} />
            {t.canManage && t.finalTeams && (
              <Link to={`/tournaments/${id}/add?final=1`} className="btn t-final-btn">
                Create final: {t.finalTeams[0].name} vs {t.finalTeams[1].name}
              </Link>
            )}
          </div>

          <Awards tournament={t} />

          {t.canManage && (
            <div className="card section">
              <h3>End tournament</h3>
              <p className={`help${t.blockers.complete ? ' help--warn' : ''}`}>
                {t.blockers.complete ?? 'Once it ends, nothing in this tournament can be changed.'}
              </p>
              <button type="button" className="btn btn--danger" disabled={busy || Boolean(t.blockers.complete)} onClick={end}>
                End tournament
              </button>
            </div>
          )}
        </>
      )}

      {t.canManage && !t.blockers.add && (
        <div className="sc-bar">
          <div className="sc-bar__mvp">
            <span className="help">{t.entries.length} match{t.entries.length === 1 ? '' : 'es'} in this tournament</span>
          </div>
          <Link to={`/tournaments/${id}/add`} className="btn btn--sm">+ Add match</Link>
        </div>
      )}
    </section>
  );
}
