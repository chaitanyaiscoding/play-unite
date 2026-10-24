import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { lookupName, login, register } from '../api.js';
import { usePlayer } from '../PlayerContext.jsx';
import BallTrack from '../components/BallTrack.jsx';
import { RolePicker } from '../components/PlayerBits.jsx';

const FORMATS = [
  'Box Cricket',
  'Gully Cricket',
  'Turf Nights',
  'Tennis Ball',
  'Weekend T20s',
  'Corporate Cups',
  'Net Sessions',
  'Street Leagues',
];

const Icon = ({ children }) => (
  <svg
    viewBox="0 0 24 24"
    width="22"
    height="22"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

const FEATURES = [
  {
    title: 'Create a team',
    text: 'Claim a unique team name, pick up to 15 players and lead as captain.',
    icon: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M19 8v6M22 11h-6" />
      </>
    ),
  },
  {
    title: 'Join a team',
    text: 'Search every team on play-unite and ask to join in a single tap.',
    icon: (
      <>
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </>
    ),
  },
  {
    title: "Captain's call",
    text: 'Captains accept or reject every request, so squads stay tight.',
    icon: (
      <>
        <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
  },
  {
    title: 'Many teams, one you',
    text: 'Office XI on Fridays, gully side on Sundays. Play for as many teams as you like.',
    icon: (
      <>
        <path d="m12 2 10 5-10 5L2 7z" />
        <path d="m2 17 10 5 10-5" />
        <path d="m2 12 10 5 10-5" />
      </>
    ),
  },
  {
    title: 'Instant alerts',
    text: 'Know the moment someone wants in, or when your captain says yes.',
    icon: (
      <>
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </>
    ),
  },
  {
    title: 'Just a name',
    text: 'No email, no phone, no password. Pick a player name and walk out to bat.',
    icon: <path d="M13 2 3 14h9l-1 8 10-12h-9z" />,
  },
];

const PIN_COPY = {
  new: {
    title: (n) => `Hi ${n}! Pick your role & a PIN`,
    help: 'Use it to get back in from any phone, even if this browser forgets you.',
    submit: 'Create player',
  },
  login: {
    title: (n) => `Welcome back, ${n}`,
    help: 'Enter your 4-digit PIN to pick up where you left off.',
    submit: 'Sign in',
  },
  claim: {
    title: (n) => `Welcome back, ${n}`,
    help: 'Set a 4-digit PIN to lock your name. You’ll need it next time you sign in.',
    submit: 'Set PIN & continue',
  },
};

const digits = (v) => v.replace(/\D/g, '').slice(0, 4);

export default function Welcome() {
  const { signIn } = usePlayer();
  const navigate = useNavigate();
  const nameRef = useRef(null);
  const pinRef = useRef(null);
  const confirmRef = useRef(null);
  const ballRef = useRef(null);
  const [name, setName] = useState('');
  const [step, setStep] = useState('name'); // 'name' | 'pin'
  const [mode, setMode] = useState('new'); // 'new' | 'login' | 'claim'
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [role, setRole] = useState('');
  const [needsRole, setNeedsRole] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [hammered, setHammered] = useState(false);

  const fail = (err) => {
    setError(err.message);
    ballRef.current?.hop(0.8);
  };

  const toPinStep = (nextMode, displayName, hasRole = true) => {
    const askRole = nextMode === 'new' || (nextMode === 'claim' && !hasRole);
    setMode(nextMode);
    setName(displayName);
    setNeedsRole(askRole);
    setRole('');
    setPin('');
    setConfirm('');
    setError('');
    setStep('pin');
    // Keep the role tiles visible: only pop the keyboard when there's no role to pick.
    if (!askRole) setTimeout(() => pinRef.current?.focus(), 0);
  };

  const backToName = () => {
    setStep('name');
    setPin('');
    setConfirm('');
    setError('');
    setTimeout(() => nameRef.current?.focus(), 0);
  };

  const onName = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    ballRef.current?.hop(1.4);
    try {
      const found = await lookupName(name);
      toPinStep(found.exists ? (found.hasPin ? 'login' : 'claim') : 'new', found.name, found.hasRole);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const submitPin = async (value = pin) => {
    if (needsRole && !role) return fail(new Error('Pick your playing role first.'));
    if (mode === 'new' && value !== confirm) {
      setConfirm('');
      confirmRef.current?.focus();
      return fail(new Error('PINs don’t match. Confirm it again.'));
    }
    setError('');
    setBusy(true);
    ballRef.current?.hop(1.4);
    try {
      const { player } =
        mode === 'new' ? await register(name, value, role) : await login(name, value, role || undefined);
      signIn(player);
      navigate('/home', { replace: true });
    } catch (err) {
      if (err.status === 409) {
        toPinStep('login', name, true); // someone registered the name meanwhile
      } else {
        setPin('');
        setConfirm('');
        setTimeout(() => pinRef.current?.focus(), 0);
      }
      fail(err);
      setBusy(false);
    }
  };

  // The input dips a little when the ball lands on it.
  const onLand = (impact) => {
    if (impact < 200) return;
    setHammered(true);
    setTimeout(() => setHammered(false), 90);
  };

  const startPlaying = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    (step === 'name' ? nameRef : pinRef).current?.focus({ preventScroll: true });
    ballRef.current?.hop(1.2);
  };

  const copy = PIN_COPY[mode];
  const pinReady = pin.length === 4 && (mode !== 'new' || confirm.length === 4) && (!needsRole || role);

  return (
    <div className="landing">
      <section className="hero">
        <div className="hero__inner">
          <div className="hero__content">
            <div className="hero__bg" aria-hidden="true" />

            <div className="hero__copy">
              <span className="hero__badge">
                <span className="hero__badge-mark" aria-hidden="true">
                  U
                </span>
                Backed by Unite Club
              </span>
              <h1 className="hero__title">
                <span className="hero__line hero__line--accent">Never short of players</span>
                <span className="hero__line">The place you find people to play</span>
              </h1>
              <p className="hero__subtitle">
                Build a squad, join a side, fill that last spot in your XI. Teams, join requests and the
                captain&rsquo;s call, all in one place, from group chat to game day.
              </p>
            </div>

            {step === 'name' ? (
              <form className="cta" onSubmit={onName} noValidate>
                <BallTrack ref={ballRef} onLand={onLand} />
                <div className={`cta__box${hammered ? ' is-hammered' : ''}`}>
                  <label htmlFor="player-name" className="sr-only">
                    Your player name
                  </label>
                  <input
                    id="player-name"
                    ref={nameRef}
                    className="cta__input"
                    type="text"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      setError('');
                      if (e.target.value.length > name.length) ballRef.current?.hop(0.55);
                    }}
                    placeholder="Enter your player name"
                    maxLength={30}
                    autoComplete="username"
                    autoCapitalize="words"
                    enterKeyHint="next"
                    aria-invalid={Boolean(error)}
                    aria-describedby="name-help"
                  />
                  <button type="submit" className="cta__primary" disabled={busy || name.trim().length < 2}>
                    {busy ? 'Checking…' : 'Let’s Play'}
                  </button>
                </div>
                <p id="name-help" className={error ? 'cta__help cta__help--error' : 'cta__help'}>
                  {error || 'New here or coming back? Just enter your name.'}
                </p>
              </form>
            ) : (
              <form
                className="cta"
                onSubmit={(e) => {
                  e.preventDefault();
                  submitPin();
                }}
                noValidate
              >
                <BallTrack ref={ballRef} onLand={onLand} />
                <div className={`cta__box${hammered ? ' is-hammered' : ''}`}>
                  {/* lets password managers save the name with the PIN */}
                  <input
                    className="sr-only"
                    type="text"
                    name="username"
                    autoComplete="username"
                    value={name}
                    readOnly
                    tabIndex={-1}
                    aria-hidden="true"
                  />
                  <p className="cta__title">{copy.title(name)}</p>
                  {needsRole && (
                    <>
                      <p className="cta__label">Your playing role</p>
                      <RolePicker
                        value={role}
                        onChange={(r) => {
                          setRole(r);
                          setError('');
                          ballRef.current?.hop(0.9);
                          if (!pin) pinRef.current?.focus();
                        }}
                      />
                      <p className="cta__label">4-digit PIN</p>
                    </>
                  )}
                  <label htmlFor="player-pin" className="sr-only">
                    {mode === 'new' ? 'Choose a 4-digit PIN' : '4-digit PIN'}
                  </label>
                  <input
                    id="player-pin"
                    ref={pinRef}
                    className="cta__input cta__pin"
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={4}
                    value={pin}
                    onChange={(e) => {
                      const v = digits(e.target.value);
                      if (v.length > pin.length) ballRef.current?.hop(0.55);
                      setPin(v);
                      setError('');
                      if (mode === 'login' && v.length === 4) submitPin(v);
                    }}
                    placeholder="PIN"
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    enterKeyHint="go"
                    aria-invalid={Boolean(error)}
                    aria-describedby="pin-help"
                    disabled={busy}
                  />
                  {mode === 'new' && (
                    <>
                      <label htmlFor="player-pin-confirm" className="sr-only">
                        Confirm PIN
                      </label>
                      <input
                        id="player-pin-confirm"
                        ref={confirmRef}
                        className="cta__input cta__pin"
                        type="password"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={4}
                        value={confirm}
                        onChange={(e) => {
                          const v = digits(e.target.value);
                          if (v.length > confirm.length) ballRef.current?.hop(0.55);
                          setConfirm(v);
                          setError('');
                        }}
                        placeholder="Confirm PIN"
                        autoComplete="new-password"
                        enterKeyHint="go"
                        disabled={busy}
                      />
                    </>
                  )}
                  <button type="submit" className="cta__primary" disabled={busy || !pinReady}>
                    {busy ? 'Walking out…' : copy.submit}
                  </button>
                </div>
                <p id="pin-help" className={error ? 'cta__help cta__help--error' : 'cta__help'}>
                  {error || copy.help}
                </p>
                <button type="button" className="cta__link" onClick={backToName}>
                  ← Not {name}? Use a different name
                </button>
              </form>
            )}
          </div>

          <div className="strip">
            <p className="strip__label">Made for</p>
            <span className="strip__divider" aria-hidden="true" />
            <div className="strip__marquee">
              <div className="strip__track">
                {[...FORMATS, ...FORMATS].map((f, i) => (
                  <span key={i} className="strip__item" aria-hidden={i >= FORMATS.length || undefined}>
                    <span className="strip__dot" aria-hidden="true" />
                    {f}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="boxes">
        <div className="boxes__inner">
          <header className="boxes__header">
            <h2>Everything you need to get a game on</h2>
            <p>From the first message to the first ball, play-unite keeps your squad together.</p>
          </header>
          <div className="boxes__grid">
            {FEATURES.map((f, i) => (
              <article key={f.title} className="box">
                <div className="box__top">
                  <span className="box__icon">
                    <Icon>{f.icon}</Icon>
                  </span>
                  <span className="box__num">{String(i + 1).padStart(2, '0')}</span>
                </div>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="final">
        <div className="final__inner">
          <div className="hero__bg" aria-hidden="true" />
          <h2>
            Your XI is <span className="text-accent">waiting</span>
          </h2>
          <p>Pick a name and find people to play with today.</p>
          <button type="button" className="cta__primary final__btn" onClick={startPlaying}>
            Get Started
          </button>
        </div>
      </section>

      <footer className="landing__foot">
        <span>© {new Date().getFullYear()} play-unite</span>
        <span>Backed by Unite Club</span>
      </footer>
    </div>
  );
}
