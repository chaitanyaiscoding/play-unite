import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { abandonMatch, callToss, chooseToss, getMatch } from '../api.js';
import Coin from '../components/Coin.jsx';
import { OVERS_MAX, OVERS_MIN } from '../../../shared/scoring.js';

export const scorePath = (id) => `/matches/${id}/score`;
const POLL_MS = 3000;
const OVER_PRESETS = [2, 5, 6, 8, 10, 20];

function BatIcon() {
  return (
    <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14.5 3.5l6 6-9.8 9.8a2 2 0 0 1-2.8 0l-3.2-3.2a2 2 0 0 1 0-2.8zM4.5 19.5l-2 2M16.5 5.5l2 2" />
    </svg>
  );
}
function BallIcon() {
  return (
    <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8 4.8c2.6 4.4 2.6 10 0 14.4M16 4.8c-2.6 4.4-2.6 10 0 14.4" />
    </svg>
  );
}

export default function Toss() {
  const { id } = useParams();
  const navigate = useNavigate();
  const coin = useRef(null);
  const [match, setMatch] = useState(null);
  const [phase, setPhase] = useState('call'); // call | flipping | result
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [decision, setDecision] = useState(null);
  const [overs, setOvers] = useState(6);
  const shown = useRef(false);
  const [pending, setPending] = useState(null); // { face, animate } once the coin is mounted

  // Load, and keep spectators in sync until the creator has tossed.
  useEffect(() => {
    let live = true;
    let timer;
    const load = async () => {
      try {
        const m = await getMatch(id);
        if (!live) return;
        setMatch(m);
        if (m.toss && !shown.current) {
          shown.current = true;
          // The creator reloading sees the result; a spectator watches it happen.
          setPending({ face: m.toss.outcome, animate: !m.canControl });
          setPhase(m.canControl ? 'result' : 'flipping');
        }
        if (!m.toss || !m.toss.decision) timer = setTimeout(load, POLL_MS);
      } catch (err) {
        if (live) setError(err.message);
      }
    };
    load();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [id]);

  useEffect(() => {
    if (!pending || !coin.current) return;
    if (!pending.animate) coin.current.show(pending.face);
    else coin.current.flip(pending.face).then(() => setPhase('result'));
    setPending(null);
  }, [pending, match]);

  if (error && !match) return <div className="card section"><p className="help help--error">{error}</p></div>;
  if (!match) return null;
  if (match.version !== 2 || (match.status !== 'toss' && phase !== 'flipping')) {
    return <Navigate to={match.status === 'live' && match.canControl ? scorePath(id) : `/matches/${id}`} replace />;
  }

  const [home, away] = match.sides;

  // Calling heads or tails tosses the coin straight away.
  const flip = async (side) => {
    setError('');
    setPhase('flipping');
    shown.current = true;
    try {
      const m = await callToss(id, side);
      await coin.current.flip(m.toss.outcome);
      setMatch(m);
      setPhase('result');
    } catch (err) {
      setError(err.message);
      setPhase('call');
      shown.current = false;
    }
  };

  const oversOk = Number.isInteger(overs) && overs >= OVERS_MIN && overs <= OVERS_MAX;
  const start = async () => {
    setBusy(true);
    setError('');
    try {
      await chooseToss(id, decision, overs);
      navigate(scorePath(id), { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const abandon = async () => {
    if (!window.confirm('Abandon this match? Both teams will be free again.')) return;
    try {
      await abandonMatch(id);
      navigate('/home', { replace: true });
    } catch (err) {
      setError(err.message);
    }
  };

  const won = match.toss && match.toss.winner;

  return (
    <section className="toss">
      <Link to="/home" className="back">← Home</Link>
      <div className="toss__teams">
        <span className="toss__team">{home.team}</span>
        <span className="toss__vs">vs</span>
        <span className="toss__team">{away.team}</span>
      </div>

      <div className="toss__arena">
        <div className="hero__bg" aria-hidden="true" />
        <Coin ref={coin} />
      </div>

      {phase === 'call' && match.canControl && (
        <div className="toss__panel">
          <p className="toss__prompt">
            Call it for <strong>{home.team}</strong>: the coin flips as soon as you tap
          </p>
          <div className="toss__calls" aria-label="Call the toss">
            {['heads', 'tails'].map((side) => (
              <button key={side} type="button" className="toss__call" onClick={() => flip(side)}>
                {side === 'heads' ? 'Heads' : 'Tails'}
              </button>
            ))}
          </div>
          <button type="button" className="cta__link" onClick={abandon}>
            Abandon match
          </button>
        </div>
      )}

      {phase === 'call' && !match.canControl && (
        <p className="toss__wait">Waiting for {match.createdBy} to toss the coin…</p>
      )}

      {phase === 'flipping' && <p className="toss__wait">The coin is in the air…</p>}

      {phase === 'result' && won && (
        <div className="toss__panel toss__panel--result">
          <p className="toss__outcome">{match.toss.outcome === 'heads' ? 'Heads' : 'Tails'}!</p>
          <p className="toss__winner">
            <strong>{won}</strong> won the toss
            {match.canControl && <span className="help"> ({home.team} called {match.toss.call})</span>}
          </p>
          {match.canControl ? (
            <>
              <p className="toss__prompt">{won} chose to…</p>
              <div className="toss__choices">
                {[
                  ['bat', 'Bat first', <BatIcon key="i" />],
                  ['bowl', 'Bowl first', <BallIcon key="i" />],
                ].map(([value, label, icon]) => (
                  <button
                    key={value}
                    type="button"
                    className={`toss__choice${decision === value ? ' is-selected' : ''}`}
                    aria-pressed={decision === value}
                    disabled={busy}
                    onClick={() => setDecision(value)}
                  >
                    {icon}
                    <span>{label}</span>
                  </button>
                ))}
              </div>
              {decision && (
                <div className="overs-pick">
                  <p className="toss__prompt">Overs per innings</p>
                  <div className="overs-pick__chips" role="radiogroup" aria-label="Overs per innings">
                    {OVER_PRESETS.map((n) => (
                      <button
                        key={n}
                        type="button"
                        role="radio"
                        aria-checked={overs === n}
                        className={`overs-pick__chip${overs === n ? ' is-selected' : ''}`}
                        onClick={() => setOvers(n)}
                      >
                        {n}
                      </button>
                    ))}
                    <input
                      className="input overs-pick__custom"
                      type="text"
                      inputMode="numeric"
                      aria-label="Custom overs"
                      placeholder="Other"
                      value={OVER_PRESETS.includes(overs) ? '' : String(overs || '')}
                      onChange={(e) => setOvers(Number(e.target.value.replace(/\D/g, '').slice(0, 2)) || 0)}
                    />
                  </div>
                  <button type="button" className="cta__primary" disabled={busy || !oversOk} onClick={start}>
                    {busy ? 'Starting…' : oversOk ? `Start match · ${overs} over${overs === 1 ? '' : 's'}` : `Overs: ${OVERS_MIN}–${OVERS_MAX}`}
                  </button>
                </div>
              )}
            </>
          ) : (
            <p className="toss__wait">Waiting for {won}&rsquo;s choice…</p>
          )}
        </div>
      )}
      {error && <p className="help help--error">{error}</p>}
    </section>
  );
}
