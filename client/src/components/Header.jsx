import { Link } from 'react-router-dom';
import { usePlayer } from '../PlayerContext.jsx';
import { useNotifications } from '../NotificationsContext.jsx';
import CricketBall from './CricketBall.jsx';

const NAV = ['Live Scores', 'Schedule', 'Matches', 'Teams', 'Players', 'Stats'];
const NAV_LINKS = { 'Live Scores': '/matches', Matches: '/matches' };

export default function Header() {
  const { player, signOut } = usePlayer();
  const { count } = useNotifications();

  return (
    <header className="header">
      <div className="header__inner">
        <Link to="/" className="logo" aria-label="Play-Unite home">
          <CricketBall size={22} className="logo__ball" />
          <span>
            play<span className="logo__dash">-</span>unite
          </span>
        </Link>

        {player && (
          <nav className="nav" aria-label="Main">
            {NAV.map((item) =>
              NAV_LINKS[item] ? (
                <Link key={item} to={NAV_LINKS[item]} className="nav__item nav__item--link">
                  {item}
                </Link>
              ) : (
                <span key={item} className="nav__item" title="Coming soon">
                  {item}
                </span>
              )
            )}
          </nav>
        )}

        {player && (
          <div className="header__user">
            <Link
              to="/notifications"
              className="bell"
              aria-label={count ? `Notifications (${count} new)` : 'Notifications'}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z"
                />
              </svg>
              {count > 0 && <span className="bell__count">{count > 9 ? '9+' : count}</span>}
            </Link>
            <Link to={`/players/${encodeURIComponent(player.name)}`} className="header__me" aria-label="Your profile">
              <span className="avatar" aria-hidden="true">
                {player.name[0].toUpperCase()}
              </span>
              <span className="header__name">{player.name}</span>
            </Link>
            <button className="link-btn" onClick={signOut}>
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
