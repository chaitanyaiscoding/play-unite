import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { reopenMatch } from '../api.js';
import useLiveMatch from '../useLiveMatch.js';
import { describeBall, oversText, rates, summarize } from '../../../shared/scoring.js';
import { EXTRAS, POINTS, RESULTS, ballsToOvers, dismissalText, extrasTotal } from '../../../shared/cricket.js';
import { PlayerName, Stars } from '../components/PlayerBits.jsx';
import CricketBall from '../components/CricketBall.jsx';

const resultLabel = (r) => RESULTS.find((x) => x.value === r)?.label ?? '';
const teamPath = (name) => `/teams/${encodeURIComponent(name)}`;
const scoreLine = (t) => `${t.runs}/${t.wickets}`;
const sr = (runs, balls) => (balls ? ((runs / balls) * 100).toFixed(1) : '–');
const econ = (runs, balls) => (balls ? (runs / (balls / 6)).toFixed(1) : '–');

function statLine(p) {
  const parts = [];
  const { batting: b, bowling: w, fielding: f } = p;
  if (b.runs || b.balls) parts.push(`${b.runs}${b.out ? '' : '*'} (${b.balls})`);
  if (w.balls) parts.push(`${w.wickets}/${w.runs} (${ballsToOvers(w.balls)})`);
  const field = [f.catches && `${f.catches}c`, f.stumpings && `${f.stumpings}st`, f.runOuts && `${f.runOuts}ro`].filter(Boolean);
  if (field.length) parts.push(field.join(' '));
  return parts.join(' · ') || 'Did not bat or bowl';
}

const RULES = [
  ['Run', POINTS.run],
  ['Four (bonus)', POINTS.fourBonus],
  ['Six (bonus)', POINTS.sixBonus],
  ['30 / 50 / 100 runs', '+4 / +8 / +16'],
  ['Strike rate (10+ balls)', '−6 to +6'],
  ['Wicket', POINTS.wicket],
  ['Dot ball', POINTS.dotBall],
  ['Maiden', POINTS.maiden],
  ['3 / 4 / 5 wickets', '+4 / +8 / +16'],
  ['Economy (2+ overs)', '−6 to +6'],
  ['Catch', POINTS.catch],
  ['Stumping / run-out', POINTS.stumping],
];

function MvpCard({ mvp }) {
  if (!mvp) return null;
  return (
    <div className="card mvp-card">
      <CricketBall size={56} className="mvp-card__ball" />
      <p className="eyebrow">Most Valuable Player</p>
      <h2 className="mvp-card__name">{mvp.name}</h2>
      <p className="mvp-card__pts">{mvp.points} points</p>
      <Stars count={mvp.stars} size="md" />
    </div>
  );
}

function PointsTable({ performances, showTeam }) {
  const [open, setOpen] = useState(null);
  const [all, setAll] = useState(false);
  const scored = performances.filter((p) => p.points !== 0);
  const shown = all ? performances : scored;
  return (
    <div className="card section">
      <div className="section__head">
        <h3>MVP points</h3>
        <span className="help">Tap a player for the breakdown</span>
      </div>
      <ol className="list points">
        {shown.map((p, i) => {
          const name = p.name ?? p.player;
          return (
            <li key={name}>
              <button type="button" className="points__row" onClick={() => setOpen(open === name ? null : name)} aria-expanded={open === name}>
                <span className="points__rank">{i + 1}</span>
                <span className="list__main">
                  <PlayerName player={{ name, role: p.role }} />
                  <span className="help">
                    {showTeam && p.team ? `${p.team} · ` : ''}
                    {statLine(p)}
                  </span>
                </span>
                <span className="points__pts">{p.points}</span>
              </button>
              {open === name && (
                <ul className="breakdown">
                  {p.breakdown.length === 0 && <li className="help">No points this match.</li>}
                  {p.breakdown.map((b) => (
                    <li key={b.label}>
                      <span>{b.label}</span>
                      <span className={b.points < 0 ? 'text-bad' : 'text-ok'}>
                        {b.points > 0 ? '+' : ''}
                        {b.points}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
      {scored.length < performances.length && (
        <button type="button" className="cta__link" onClick={() => setAll(!all)}>
          {all ? 'Hide players without points' : `Show all ${performances.length} players`}
        </button>
      )}
    </div>
  );
}

function Rules() {
  return (
    <details className="card section rules">
      <summary>How MVP points work</summary>
      <p className="help">
        Based on the IPL Most Valuable Player formula (boundaries, wickets, dot balls, fielding), plus runs,
        milestones, strike rate and economy as in fantasy T20 scoring. Highest points wins; ties go to more
        wickets, then more runs.
      </p>
      <ul className="breakdown">
        {RULES.map(([label, pts]) => (
          <li key={label}>
            <span>{label}</span>
            <span className="text-ok">{typeof pts === 'number' ? `+${pts}` : pts}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

// One innings, laid out like a Cricbuzz scorecard.
function InningsCard({ inn }) {
  const batted = inn.batters.filter((b) => b.how !== 'dnb');
  const dnb = inn.batters.filter((b) => b.how === 'dnb');
  const ex = inn.extras;
  return (
    <div className="card section innings">
      <div className="innings__head">
        <h3>{inn.batting}</h3>
        <span className="innings__score">
          {scoreLine(inn.total)} <span className="help">({ballsToOvers(inn.total.balls)} ov)</span>
        </span>
      </div>
      <table className="sc-table">
        <thead>
          <tr>
            <th>Batter</th>
            <th>R</th>
            <th>B</th>
            <th>4s</th>
            <th>6s</th>
            <th>SR</th>
          </tr>
        </thead>
        <tbody>
          {batted.map((b) => (
            <tr key={b.name}>
              <td>
                <PlayerName player={b} />
                <span className={`sc-table__how${b.how === 'notout' ? ' is-notout' : ''}`}>{b.dismissal}</span>
              </td>
              <td className="num strong">{b.runs}</td>
              <td className="num">{b.balls}</td>
              <td className="num">{b.fours}</td>
              <td className="num">{b.sixes}</td>
              <td className="num">{sr(b.runs, b.balls)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="innings__line">
        <span>Extras</span>
        <span>
          <strong>{extrasTotal(ex)}</strong>{' '}
          <span className="help">({EXTRAS.map((e) => `${e.short} ${ex[e.value] ?? 0}`).join(', ')})</span>
        </span>
      </div>
      <div className="innings__line innings__line--total">
        <span>Total</span>
        <span>
          <strong>{inn.total.runs}</strong>{' '}
          <span className="help">
            ({inn.total.wickets} wkts, {ballsToOvers(inn.total.balls)} ov)
          </span>
        </span>
      </div>
      {dnb.length > 0 && (
        <p className="help innings__dnb">
          {inn.inProgress ? 'Yet to bat' : 'Did not bat'}: {dnb.map((b) => b.name).join(', ')}
        </p>
      )}
      {inn.fow?.length > 0 && (
        <p className="help innings__dnb">
          Fall of wickets: {inn.fow.map((f) => `${f.score}-${f.wicket} (${f.player}, ${f.over} ov)`).join(', ')}
        </p>
      )}

      {inn.bowlers.length > 0 && (
        <table className="sc-table sc-table--bowl">
          <thead>
            <tr>
              <th>Bowler</th>
              <th>O</th>
              <th>M</th>
              <th>R</th>
              <th>W</th>
              <th>ECO</th>
            </tr>
          </thead>
          <tbody>
            {inn.bowlers.map((w) => (
              <tr key={w.name}>
                <td>
                  <PlayerName player={w} />
                </td>
                <td className="num">{ballsToOvers(w.balls)}</td>
                <td className="num">{w.maidens}</td>
                <td className="num">{w.runs}</td>
                <td className="num strong">{w.wickets}</td>
                <td className="num">{econ(w.runs, w.balls)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// Innings from the live ball log, in the same shape as a completed scorecard.
function liveInnings(state, match) {
  const people = new Map(match.sides.flatMap((s) => s.playingXI.map((p) => [p.name, p])));
  return state.innings
    .filter((inn) => !inn.needs.includes('openers'))
    .map((inn) => {
      const sum = summarize(inn);
      const atCrease = new Set([inn.striker, inn.nonStriker].filter(Boolean));
      return {
        batting: inn.batting,
        bowling: inn.bowling,
        inProgress: !inn.complete,
        batters: sum.batters.map((b) => ({
          ...people.get(b.player),
          name: b.player,
          runs: b.runs,
          balls: b.balls,
          fours: b.fours,
          sixes: b.sixes,
          how: b.how,
          dismissal: b.how === 'notout' && atCrease.has(b.player) && !inn.complete ? 'batting' : dismissalText(b),
        })),
        extras: sum.extras,
        bowlers: sum.bowlers.map((w) => ({ ...people.get(w.player), name: w.player, ...w, wickets: inn.bowlers[w.player].wickets })),
        total: sum.total,
        fow: sum.fow,
      };
    });
}

// Full batting/bowling cards for each innings, as they stand right now.
function LiveScorecards({ state, match }) {
  const innings = liveInnings(state, match);
  const [tab, setTab] = useState(null);
  if (!innings.length) return null;
  const shown = tab ?? innings.length - 1; // follow the current innings by default
  return (
    <>
      <div className="tabs tabs--teams" role="tablist">
        {innings.map((inn, i) => (
          <button
            key={inn.batting}
            type="button"
            role="tab"
            aria-selected={shown === i}
            className={`tab${shown === i ? ' is-active' : ''}`}
            onClick={() => setTab(i)}
          >
            {inn.batting} {scoreLine(inn.total)}
          </button>
        ))}
      </div>
      <InningsCard inn={innings[Math.min(shown, innings.length - 1)]} />
    </>
  );
}

// What followers see while the scorer is scoring.
function LiveScore({ state }) {
  const idx = state.current ?? state.innings.length - 1;
  const inn = state.innings[idx];
  const r = rates(state, idx);
  const prev = idx === 1 ? state.innings[0] : null;
  if (inn.needs.includes('openers')) {
    return (
      <div className="card section">
        <p className="help">
          {prev
            ? `Innings break: ${prev.batting} ${prev.runs}/${prev.wickets} (${oversText(prev.legal)} ov). ${inn.batting} need ${state.target} to win.`
            : 'Waiting for the openers to walk out…'}
        </p>
      </div>
    );
  }
  const bat = (n) => inn.batters[n];
  const w = inn.bowler && inn.bowlers[inn.bowler];
  return (
    <>
      <div className="card scorer__board">
        <span className="help">
          {inn.batting} · {idx === 0 ? '1st' : '2nd'} innings · {state.overs} ov
        </span>
        <div className="scorer__score">
          <strong>
            {inn.runs}/{inn.wickets}
          </strong>
          <span>({oversText(inn.legal)} ov)</span>
        </div>
        <div className="scorer__rates">
          <span>CRR {r.crr}</span>
          {idx === 1 && r.need > 0 && (
            <span className="scorer__need">
              Need {r.need} off {r.ballsLeft} · RRR {r.rrr}
            </span>
          )}
          {prev && (
            <span className="help">
              {prev.batting} {prev.runs}/{prev.wickets}
            </span>
          )}
        </div>
      </div>
      <div className="card scorer__crease">
        <table className="crease">
          <tbody>
            {[inn.striker, inn.nonStriker].filter(Boolean).map((n) => (
              <tr key={n} className={n === inn.striker ? 'is-striker' : ''}>
                <td>
                  {n}
                  {n === inn.striker ? ' ✱' : ''}
                </td>
                <td className="num strong">
                  {bat(n).runs} ({bat(n).balls})
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {w && (
          <div className="crease__bowler">
            <strong>{inn.bowler}</strong> {oversText(w.balls)}-{w.maidens}-{w.runs}-{w.wickets}
          </div>
        )}
        <div className="this-over">
          {inn.thisOver.map((b, i) => (
            <span key={i} className={`ball-chip${/W/.test(b) && !/Wd$/.test(b) ? ' is-w' : b === '4' || b === '6' ? ' is-b' : /Wd|Nb|B|Lb/.test(b) ? ' is-x' : ''}`}>
              {b}
            </span>
          ))}
        </div>
      </div>
      {inn.commentary.length > 0 && (
        <div className="card section">
          <h3>Commentary</h3>
          <ol className="commentary">
            {[...inn.commentary].reverse().slice(0, 18).map((c, i) => (
              <li key={i}>
                <span className={`ball-chip${c.wicket ? ' is-w' : c.runs === 4 || c.runs === 6 ? ' is-b' : c.extra ? ' is-x' : ''}`}>{c.label}</span>
                <span className="commentary__over">{c.over}</span>
                <span>{describeBall(c)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </>
  );
}

function SquadsCard({ sides }) {
  return (
    <div className="card section">
      <h3>Playing XIs</h3>
      <div className="squads">
        {sides.map((s) => (
          <div key={s.team}>
            <h4 className="sc-sub">
              <Link to={teamPath(s.team)}>{s.team}</Link>
            </h4>
            <ol className="squads__list">
              {s.playingXI.map((p) => (
                <li key={p.name}>
                  <PlayerName player={p} captain={p.name === s.captain} />
                </li>
              ))}
            </ol>
            {s.bench.length > 0 && <p className="help">Bench: {s.bench.map((p) => p.name).join(', ')}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

function TwoTeamMatch({ match, state }) {
  const [tab, setTab] = useState(0);
  const [reopening, setReopening] = useState(false);
  const [reopenError, setReopenError] = useState('');
  const navigate = useNavigate();
  if (match.status === 'toss') return <Navigate to={`/matches/${match.id}/toss`} replace />;
  const title = `${match.sides[0].team} vs ${match.sides[1].team}`;

  const reopen = async () => {
    if (!window.confirm('Remove the last ball and put this match back to live? The result and MVP are cleared until it finishes again.')) return;
    setReopening(true);
    setReopenError('');
    try {
      await reopenMatch(match.id);
      navigate(`/matches/${match.id}/score`, { replace: true });
    } catch (err) {
      setReopenError(err.message);
      setReopening(false);
    }
  };

  if (match.status !== 'completed') {
    return (
      <section className="stack">
        <Link to="/home" className="back">← Home</Link>
        <div className={`card section match-head${match.status === 'live' ? ' match--live' : ''}`}>
          <span className={`status status--${match.status === 'live' ? 'in_match' : 'needs_players'}`}>
            <span className="status__dot" aria-hidden="true" />
            {match.status === 'live' ? 'Live' : 'Abandoned'}
          </span>
          <h2>{title}</h2>
          {match.toss?.text && <p className="help">{match.toss.text}</p>}
          {match.status === 'live' &&
            (match.canControl ? (
              <Link to={`/matches/${match.id}/score`} className="btn btn--sm">
                Open scorer
              </Link>
            ) : (
              <p className="help">
                Scored ball by ball by <strong>{match.createdBy}</strong>. This page updates live.
              </p>
            ))}
        </div>
        {match.status === 'live' && state && <LiveScore state={state} />}
        {match.status === 'live' && state && <LiveScorecards state={state} match={match} />}
        <SquadsCard sides={match.sides} />
      </section>
    );
  }

  const winner = match.outcome?.winner;
  return (
    <section className="stack">
      <Link to="/home" className="back">← Home</Link>
      <div className="card section match-head">
        <h2>{title}</h2>
        <p className={`match-head__result${winner ? '' : ' is-neutral'}`}>{match.outcome?.text}</p>
        <p className="help">
          {match.toss?.text} · {match.endedAt && new Date(match.endedAt).toLocaleDateString()}
        </p>
        <div className="match-head__scores">
          {match.innings.map((inn) => (
            <div key={inn.batting} className={`match-head__team${inn.batting === winner ? ' is-winner' : ''}`}>
              <span>{inn.batting}</span>
              <strong>
                {scoreLine(inn.total)} <span className="help">({ballsToOvers(inn.total.balls)})</span>
              </strong>
            </div>
          ))}
        </div>
        {match.canReopen && (
          <button type="button" className="cta__link" disabled={reopening} onClick={reopen}>
            ↶ Last ball wrong? Undo it and reopen the match
          </button>
        )}
        {reopenError && <p className="help help--error">{reopenError}</p>}
      </div>

      <MvpCard mvp={match.mvp} />

      {match.innings.length > 0 && (
        <>
          <div className="tabs tabs--teams" role="tablist">
            {match.innings.map((inn, i) => (
              <button
                key={inn.batting}
                type="button"
                role="tab"
                aria-selected={tab === i}
                className={`tab${tab === i ? ' is-active' : ''}`}
                onClick={() => setTab(i)}
              >
                {inn.batting} {scoreLine(inn.total)}
              </button>
            ))}
          </div>
          <InningsCard inn={match.innings[tab]} />
        </>
      )}

      <PointsTable performances={match.performances} showTeam />
      <SquadsCard sides={match.sides} />
      <Rules />
    </section>
  );
}

// Matches recorded before two-team matches existed.
function LegacyMatch({ match }) {
  return (
    <section className="stack">
      <Link to={teamPath(match.team)} className="back">← {match.team}</Link>
      <div className="card section match-head">
        <span className={`result result--${match.result}`}>{resultLabel(match.result)}</span>
        <h2>
          {match.team} {match.opponent && <span className="match-head__vs">vs {match.opponent}</span>}
        </h2>
        <p className="help">{match.endedAt && new Date(match.endedAt).toLocaleString()}</p>
      </div>
      {match.mvp ? (
        <MvpCard mvp={match.mvp} />
      ) : (
        <div className="card section">
          <p className="help">No MVP for this match.</p>
        </div>
      )}
      <PointsTable performances={match.performances} />
      <Rules />
    </section>
  );
}

export default function MatchResult() {
  const { id } = useParams();
  const { match, state, error } = useLiveMatch(id);

  if (error && !match) return <div className="card section"><p className="help help--error">{error}</p></div>;
  if (!match) return null;
  return match.version === 2 ? <TwoTeamMatch match={match} state={state} /> : <LegacyMatch match={match} />;
}
