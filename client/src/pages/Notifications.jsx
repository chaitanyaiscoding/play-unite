import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { markNotificationsSeen } from '../api.js';
import { useNotifications } from '../NotificationsContext.jsx';
import { RequestActions } from './Team.jsx';
import { teamPath } from './Home.jsx';

export default function Notifications() {
  const { incoming, updates, refresh } = useNotifications();

  // Opening this page counts as seeing accept/reject decisions; they stay
  // listed until the next refresh so the player can read them.
  useEffect(() => {
    if (updates.length) markNotificationsSeen().catch(() => {});
  }, [updates.length]);

  const empty = incoming.length === 0 && updates.length === 0;

  return (
    <section className="stack">
      <Link to="/home" className="back">← Home</Link>
      <div className="card section">
        <h3>Notifications</h3>
        {empty && <p className="help">You&rsquo;re all caught up.</p>}
        <ul className="list">
          {incoming.map((n) => (
            <li key={n.id} className="list__row">
              <span className="avatar avatar--sm" aria-hidden="true">{n.player[0].toUpperCase()}</span>
              <span className="list__main">
                <span>
                  <strong>{n.player}</strong> wants to join{' '}
                  <Link to={teamPath(n.team)}>{n.team}</Link>
                </span>
                <span className="help">{new Date(n.createdAt).toLocaleString()}</span>
              </span>
              <RequestActions id={n.id} onDone={refresh} />
            </li>
          ))}
          {updates.map((n) => (
            <li key={n.id} className="list__row">
              <span className={`dot dot--${n.status}`} aria-hidden="true" />
              <span className="list__main">
                <span>
                  Your request to join <Link to={teamPath(n.team)}>{n.team}</Link> was{' '}
                  <strong className={n.status === 'accepted' ? 'text-ok' : 'text-bad'}>{n.status}</strong>.
                </span>
                <span className="help">{new Date(n.updatedAt).toLocaleString()}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
