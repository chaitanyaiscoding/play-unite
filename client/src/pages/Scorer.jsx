import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { abandonMatch, addMatchEvent, finishMatch, undoMatchEvent } from '../api.js';
import useLiveMatch from '../useLiveMatch.js';
import {
  WICKETS_ON,
  WICKET_TYPES,
  availableBatters,
  availableBowlers,
  describeBall,
  oversText,
  rates,
  summarize,
} from '../../../shared/scoring.js';
import { buildPerformances, emptyPerformance, matchResult, pickMvp, scorePerformance } from '../../../shared/cricket.js';
import { RoleBadge } from '../components/PlayerBits.jsx';

const sr = (r, b) => (b ? ((r / b) * 100).toFixed(1) : '0.0');
const econ = (r, balls) => (balls ? (r / (balls / 6)).toFixed(1) : '0.0');
const EXTRA_LABEL = { wide: 'Wide', noball: 'No ball', bye: 'Byes', legbye: 'Leg byes' };
const EXTRA_RUNS = { wide: [0, 1, 2, 3, 4], noball: [0, 1, 2, 3, 4, 6], bye: [1, 2, 3, 4], legbye: [1, 2, 3, 4] };

// Bottom sheet used for every scorer prompt.
function Sheet({ title, children, onClose, onUndo }) {
  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
      {onClose && <button type="button" className="sheet__scrim" aria-label="Close" onClick={onClose} />}
      <div className="sheet__panel">
        <div className="sheet__head">
          <h3>{title}</h3>
          {onClose && (
            <button type="button" className="sheet__close" onClick={onClose} aria-label="Close">
              ×
            </button>
          )}
        </div>
        {children}
        {/* Prompts cover the keypad, so a mistake can still be taken back from here. */}
        {onUndo && (
          <button type="button" className="cta__link" onClick={onUndo}>
            ↶ Undo last ball
          </button>
        )}
      </div>
    </div>
  );
}

function PickList({ players, roles, figures, disabled = new Set(), onPick }) {
  return (
    <ul className="pick-list">
      {players.map((name) => (
        <li key={name}>
          <button type="button" className="pick-list__item" disabled={disabled.has(name)} onClick={() => onPick(name)}>
            <span className="pick-list__name">
              <strong>{name}</strong>
              <RoleBadge role={roles.get(name)} />
            </span>
            <span className="help">{disabled.has(name) ? 'Bowled the last over' : figures?.(name)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function OpenersSheet({ inn, onStart, onUndo, busy }) {
  const [striker, setStriker] = useState('');
  const [nonStriker, setNonStriker] = useState('');
  const [bowler, setBowler] = useState('');
  const select = (label, value, set, options) => (
    <label className="sc-field sc-field--wide">
      <span>{label}</span>
      <select className="input" value={value} onChange={(e) => set(e.target.value)}>
        <option value="">Pick…</option>
        {options.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <Sheet title={`${inn.batting} innings`} onUndo={onUndo}>
      <p className="help">Who opens the batting, and who bowls the first over?</p>
      {select('Striker', striker, setStriker, inn.battingXI.filter((n) => n !== nonStriker))}
      {select('Non-striker', nonStriker, setNonStriker, inn.battingXI.filter((n) => n !== striker))}
      {select(`Opening bowler (${inn.bowling})`, bowler, setBowler, inn.bowlingXI)}
      <button
        type="button"
        className="cta__primary"
        disabled={busy || !striker || !nonStriker || !bowler}
        onClick={() => onStart({ type: 'start', striker, nonStriker, bowler })}
      >
        Start scoring
      </button>
    </Sheet>
  );
}

function WicketSheet({ inn, extra, onConfirm, onClose, busy }) {
  const allowed = WICKETS_ON[extra ?? 'none'];
  const [how, setHow] = useState(allowed[0]);
  const [out, setOut] = useState(inn.striker);
  const [fielder, setFielder] = useState('');
  const [runs, setRuns] = useState(0);
  const needsFielder = how === 'caught' || how === 'stumped' || how === 'runout';
  const ok = !((how === 'caught' || how === 'stumped') && !fielder);

  return (
    <Sheet title={extra ? `Wicket off a ${EXTRA_LABEL[extra].toLowerCase().replace(/s$/, '')}` : 'Wicket'} onClose={onClose}>
      <div className="chips">
        {allowed.map((v) => (
          <button
            key={v}
            type="button"
            className={`chip-btn${how === v ? ' is-selected' : ''}`}
            onClick={() => {
              setHow(v);
              if (v !== 'runout') setOut(inn.striker);
            }}
          >
            {WICKET_TYPES.find((w) => w.value === v).label}
          </button>
        ))}
      </div>
      {how === 'runout' && (
        <>
          <p className="sheet__label">Who&rsquo;s out?</p>
          <div className="chips">
            {[inn.striker, inn.nonStriker].map((n) => (
              <button key={n} type="button" className={`chip-btn${out === n ? ' is-selected' : ''}`} onClick={() => setOut(n)}>
                {n}
                {n === inn.striker ? ' ✱' : ''}
              </button>
            ))}
          </div>
          <p className="sheet__label">Runs completed</p>
          <div className="chips">
            {(extra === 'bye' || extra === 'legbye' ? [1, 2, 3] : [0, 1, 2, 3]).map((n) => (
              <button key={n} type="button" className={`chip-btn${runs === n ? ' is-selected' : ''}`} onClick={() => setRuns(n)}>
                {n}
              </button>
            ))}
          </div>
        </>
      )}
      {needsFielder && (
        <label className="sc-field sc-field--wide">
          <span>{how === 'caught' ? 'Caught by' : how === 'stumped' ? 'Wicketkeeper' : 'Fielder (optional)'}</span>
          <select className="input" value={fielder} onChange={(e) => setFielder(e.target.value)}>
            <option value="">Pick…</option>
            {inn.bowlingXI.map((n) => (
              <option key={n} value={n}>
                {n}
                {n === inn.bowler ? ' (bowler)' : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        type="button"
        className="cta__primary btn-out"
        disabled={busy || !ok}
        onClick={() =>
          onConfirm({
            runs: how === 'runout' ? runs : 0,
            wicket: { how, out: how === 'runout' ? out : inn.striker, ...(fielder ? { fielder } : {}) },
          })
        }
      >
        Out!
      </button>
    </Sheet>
  );
}

function ExtraSheet({ extra, onRuns, onWicket, onClose, busy }) {
  return (
    <Sheet title={EXTRA_LABEL[extra]} onClose={onClose}>
      <p className="help">
        {extra === 'wide'
          ? 'Runs taken on the wide (1 wide is added automatically).'
          : extra === 'noball'
            ? 'Runs off the bat (1 no ball is added automatically).'
            : 'Runs taken.'}
      </p>
      <div className="runs-grid">
        {EXTRA_RUNS[extra].map((n) => (
          <button key={n} type="button" className="key" disabled={busy} onClick={() => onRuns(n)}>
            {extra === 'wide' ? (n ? `Wd+${n}` : 'Wd') : extra === 'noball' ? (n ? `Nb+${n}` : 'Nb') : n}
          </button>
        ))}
      </div>
      <button type="button" className="cta__link" onClick={onWicket}>
        + Wicket on this ball
      </button>
    </Sheet>
  );
}

export default function Scorer() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { match, setMatch, state, error: loadError, reload } = useLiveMatch(id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sheet, setSheet] = useState(null); // { kind: 'extra' | 'wicket' | 'menu', extra? }

  if (loadError && !match) return <div className="card section"><p className="help help--error">{loadError}</p></div>;
  if (!match) return null;
  if (match.version !== 2 || match.status !== 'live' || !match.canControl || !state) {
    return <Navigate to={match.status === 'toss' ? `/matches/${id}/toss` : `/matches/${id}`} replace />;
  }

  const at = match.log.length;
  const send = async (fn) => {
    setBusy(true);
    setError('');
    try {
      const m = await fn();
      if (m) setMatch(m);
      setSheet(null);
    } catch (err) {
      setError(err.message);
      if (err.data?.stale) reload();
    } finally {
      setBusy(false);
    }
  };
  const event = (e) => send(() => addMatchEvent(id, e, at));
  const ball = (runs, extra = null, wicket = null) => event({ type: 'ball', runs, extra, wicket });
  const undo = () => send(() => undoMatchEvent(id, at));

  const roles = new Map(match.sides.flatMap((s) => s.playingXI.map((p) => [p.name, p.role])));
  const idx = state.current ?? state.innings.length - 1;
  const inn = state.innings[idx];
  const r = rates(state, idx);
  const bat = (n) => inn.batters[n];
  const bowlerFig = (n) => {
    const w = inn.bowlers[n];
    return w ? `${oversText(w.balls)}-${w.maidens}-${w.runs}-${w.wickets}` : 'Yet to bowl';
  };

  // Live MVP + result preview from the balls so far.
  const summaries = state.innings.filter((i) => !i.needs.includes('openers')).map(summarize);
  const perfs = buildPerformances(summaries);
  const leader = pickMvp(
    [...roles.keys()].map((n) => {
      const perf = perfs.get(n) ?? emptyPerformance();
      return { player: n, ...perf, ...scorePerformance(perf, roles.get(n)) };
    })
  );
  const result = state.finished ? matchResult(summaries) : null;

  const finish = (noResult = false) => {
    if (noResult && !window.confirm('End this match now as a no result? No MVP will be awarded.')) return;
    send(async () => {
      await finishMatch(id, at, noResult);
      navigate(`/matches/${id}`, { replace: true });
    });
  };
  const abandon = () => {
    if (!window.confirm('Abandon this match? No stats are recorded and both teams are freed.')) return;
    send(async () => {
      await abandonMatch(id);
      navigate('/home', { replace: true });
    });
  };

  const prev = idx === 1 ? state.innings[0] : null;
  const keypadOff = busy || inn.needs.length > 0 || inn.complete || state.finished;

  return (
    <section className="scorer">
      <Link to={`/matches/${id}`} className="back">← Match centre</Link>

      <div className="card scorer__board">
        <div className="scorer__teams">
          <span className="help">
            {inn.batting} vs {inn.bowling} · {idx === 0 ? '1st' : '2nd'} innings · {state.overs} ov
          </span>
        </div>
        <div className="scorer__score">
          <strong>
            {inn.runs}/{inn.wickets}
          </strong>
          <span>({oversText(inn.legal)} ov)</span>
        </div>
        <div className="scorer__rates">
          <span>CRR {r.crr}</span>
          {idx === 1 && (
            <>
              <span>Target {state.target}</span>
              {!inn.complete && r.need > 0 && (
                <span className="scorer__need">
                  Need {r.need} off {r.ballsLeft} ball{r.ballsLeft === 1 ? '' : 's'} · RRR {r.rrr}
                </span>
              )}
            </>
          )}
          {prev && <span className="help">{prev.batting} {prev.runs}/{prev.wickets}</span>}
        </div>
      </div>

      {!inn.needs.includes('openers') && (
        <div className="card scorer__crease">
          <table className="crease">
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
              {[inn.striker, inn.nonStriker].map((n, k) =>
                n ? (
                  <tr key={n} className={k === 0 ? 'is-striker' : ''}>
                    <td>
                      {n}
                      {k === 0 ? ' ✱' : ''}
                    </td>
                    <td className="num strong">{bat(n).runs}</td>
                    <td className="num">{bat(n).balls}</td>
                    <td className="num">{bat(n).fours}</td>
                    <td className="num">{bat(n).sixes}</td>
                    <td className="num">{sr(bat(n).runs, bat(n).balls)}</td>
                  </tr>
                ) : (
                  <tr key={`empty${k}`}>
                    <td colSpan={6} className="help">New batter…</td>
                  </tr>
                )
              )}
            </tbody>
          </table>
          <div className="crease__foot">
            <span className="help">
              Partnership {inn.partnership.runs} ({inn.partnership.balls})
            </span>
            <button type="button" className="link-btn" disabled={keypadOff} onClick={() => event({ type: 'swap' })}>
              ⇄ Change strike
            </button>
          </div>
          <div className="crease__bowler">
            <span>
              {inn.bowler ? (
                <>
                  <strong>{inn.bowler}</strong> {bowlerFig(inn.bowler)}{' '}
                  <span className="help">econ {econ(inn.bowlers[inn.bowler].runs, inn.bowlers[inn.bowler].balls)}</span>
                </>
              ) : (
                <span className="help">New over: pick a bowler</span>
              )}
            </span>
          </div>
          <div className="this-over" aria-label="This over">
            {inn.thisOver.length === 0 && <span className="help">This over</span>}
            {inn.thisOver.map((b, i) => (
              <span key={i} className={`ball-chip${/W/.test(b) && !/Wd$/.test(b) ? ' is-w' : b === '4' || b === '6' ? ' is-b' : /Wd|Nb|B|Lb/.test(b) ? ' is-x' : ''}`}>
                {b}
              </span>
            ))}
          </div>
        </div>
      )}

      {!state.finished && !inn.complete && (
        <div className="keypad" aria-label="Scoring keypad">
          {[0, 1, 2, 3, 4, 6].map((n) => (
            <button key={n} type="button" className={`key${n === 4 || n === 6 ? ' key--boundary' : ''}`} disabled={keypadOff} onClick={() => ball(n)}>
              {n === 0 ? '•' : n}
            </button>
          ))}
          {['wide', 'noball', 'bye', 'legbye'].map((x) => (
            <button key={x} type="button" className="key key--extra" disabled={keypadOff} onClick={() => setSheet({ kind: 'extra', extra: x })}>
              {{ wide: 'WD', noball: 'NB', bye: 'BYE', legbye: 'LB' }[x]}
            </button>
          ))}
          <button type="button" className="key key--out" disabled={keypadOff} onClick={() => setSheet({ kind: 'wicket', extra: null })}>
            OUT
          </button>
          <button type="button" className="key key--undo" disabled={busy || at === 0} onClick={undo}>
            UNDO
          </button>
          <button type="button" className="key key--more" disabled={busy} onClick={() => setSheet({ kind: 'menu' })}>
            •••
          </button>
          <button type="button" className="key" disabled={keypadOff} onClick={() => ball(5)}>
            5
          </button>
        </div>
      )}
      {error && <p className="help help--error">{error}</p>}

      {(inn.complete || state.finished) && (
        <div className="card section scorer__break">
          {state.finished ? (
            <>
              <p className="eyebrow">Match over</p>
              <h3>{result.text}</h3>
              {leader && (
                <p className="help">
                  MVP: <strong>{leader.player}</strong> · {leader.points} pts
                </p>
              )}
              <button type="button" className="cta__primary" disabled={busy} onClick={() => finish(false)}>
                Finish match
              </button>
              <button type="button" className="cta__link" disabled={busy || at === 0} onClick={undo}>
                Undo last ball
              </button>
            </>
          ) : null}
        </div>
      )}

      {inn.commentary.length > 0 && (
        <div className="card section">
          <h3>Commentary</h3>
          <ol className="commentary">
            {[...inn.commentary].reverse().slice(0, 12).map((c, i) => (
              <li key={i}>
                <span className={`ball-chip${c.wicket ? ' is-w' : c.runs === 4 || c.runs === 6 ? ' is-b' : c.extra ? ' is-x' : ''}`}>{c.label}</span>
                <span className="commentary__over">{c.over}</span>
                <span>{describeBall(c)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Prompts the scorer must answer before the next ball */}
      {!state.finished && inn.needs[0] === 'openers' && (
        <>
          {prev && (
            <div className="card section scorer__break">
              <p className="eyebrow">Innings break</p>
              <h3>
                {prev.batting} {prev.runs}/{prev.wickets} ({oversText(prev.legal)} ov)
              </h3>
              <p className="help">
                {inn.batting} need {state.target} to win from {state.overs * 6} balls.
              </p>
            </div>
          )}
          <OpenersSheet inn={inn} busy={busy} onStart={event} onUndo={prev ? undo : undefined} />
        </>
      )}
      {!state.finished && inn.needs[0] === 'batter' && (
        <Sheet title="New batter" onUndo={undo}>
          <PickList
            players={availableBatters(inn)}
            roles={roles}
            figures={(n) => (inn.batters[n]?.how === 'retired' ? `Retired ${inn.batters[n].runs} (${inn.batters[n].balls})` : 'Yet to bat')}
            onPick={(player) => event({ type: 'batter', player })}
          />
        </Sheet>
      )}
      {!state.finished && inn.needs[0] === 'bowler' && (
        <Sheet title={`Over ${Math.floor(inn.legal / 6) + 1}: bowler`} onUndo={at > 1 ? undo : undefined}>
          <PickList
            players={inn.bowlingXI}
            roles={roles}
            figures={bowlerFig}
            disabled={new Set(inn.bowlingXI.filter((n) => !availableBowlers(inn).includes(n)))}
            onPick={(bowler) => event({ type: 'bowler', bowler })}
          />
        </Sheet>
      )}

      {sheet?.kind === 'extra' && (
        <ExtraSheet
          extra={sheet.extra}
          busy={busy}
          onRuns={(n) => ball(n, sheet.extra)}
          onWicket={() => setSheet({ kind: 'wicket', extra: sheet.extra })}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === 'wicket' && (
        <WicketSheet
          inn={inn}
          extra={sheet.extra}
          busy={busy}
          onClose={() => setSheet(null)}
          onConfirm={({ runs, wicket }) => ball(sheet.extra === 'bye' || sheet.extra === 'legbye' ? Math.max(1, runs) : runs, sheet.extra, wicket)}
        />
      )}
      {sheet?.kind === 'menu' && (
        <Sheet title="More" onClose={() => setSheet(null)}>
          <div className="menu-list">
            {[inn.striker, inn.nonStriker].filter(Boolean).map((n) => (
              <button key={n} type="button" className="menu-list__item" disabled={keypadOff} onClick={() => event({ type: 'retire', player: n })}>
                Retire {n} (hurt)
              </button>
            ))}
            <button
              type="button"
              className="menu-list__item"
              disabled={busy || inn.needs.includes('openers')}
              onClick={() => window.confirm(`End the ${inn.batting} innings now?`) && event({ type: 'endInnings' })}
            >
              End innings
            </button>
            <button type="button" className="menu-list__item" disabled={busy} onClick={() => finish(true)}>
              End match as no result
            </button>
            <button type="button" className="menu-list__item menu-list__item--danger" disabled={busy} onClick={abandon}>
              Abandon match
            </button>
          </div>
        </Sheet>
      )}
    </section>
  );
}
