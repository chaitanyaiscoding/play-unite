import { Link } from 'react-router-dom';
import { MAX_STARS, ROLES, roleInfo } from '../../../shared/cricket.js';

export const playerPath = (name) => `/players/${encodeURIComponent(name)}`;

// ★★☆☆☆ — the player's level from MVP awards.
export function Stars({ count = 0, size = 'sm' }) {
  return (
    <span className={`stars stars--${size}`} role="img" aria-label={`${count} of ${MAX_STARS} stars`}>
      {Array.from({ length: MAX_STARS }, (_, i) => (
        <svg key={i} viewBox="0 0 24 24" className={i < count ? 'is-on' : ''} aria-hidden="true">
          <path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z" />
        </svg>
      ))}
    </span>
  );
}

export function RoleBadge({ role }) {
  const info = roleInfo(role);
  if (!info) return null;
  return (
    <span className={`role role--${info.value}`} title={info.label}>
      {info.short}
    </span>
  );
}

// Name + role + stars, linking to the player's profile.
export function PlayerName({ player, captain = false }) {
  return (
    <span className="pname">
      <Link to={playerPath(player.name)} className="pname__name">
        {player.name}
      </Link>
      {captain && <span className="badge badge--ok pname__c">C</span>}
      <RoleBadge role={player.role} />
      {player.stars > 0 && <Stars count={player.stars} />}
    </span>
  );
}

const ROLE_ICONS = {
  batter: (
    <path d="M14.5 3.5l6 6-9.8 9.8a2 2 0 0 1-2.8 0l-3.2-3.2a2 2 0 0 1 0-2.8zM4.5 19.5l-2 2M16.5 5.5l2 2" />
  ),
  bowler: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8 4.8c2.6 4.4 2.6 10 0 14.4M16 4.8c-2.6 4.4-2.6 10 0 14.4" />
    </>
  ),
  allrounder: (
    <>
      <circle cx="16.5" cy="7.5" r="4" />
      <path d="M10.5 9.5l-7 7a1.5 1.5 0 0 0 0 2.1l1.9 1.9a1.5 1.5 0 0 0 2.1 0l7-7" />
    </>
  ),
  wicketkeeper: (
    <>
      <path d="M6 20V8M12 20V8M18 20V8" />
      <path d="M5 6.5h6M13 6.5h6" />
    </>
  ),
};

// Four big tiles to choose a playing role.
export function RolePicker({ value, onChange, name = 'role' }) {
  return (
    <div className="role-picker" role="radiogroup" aria-label="Playing role">
      {ROLES.map((r) => (
        <label key={r.value} className={`role-tile${value === r.value ? ' is-selected' : ''}`}>
          <input
            type="radio"
            name={name}
            value={r.value}
            checked={value === r.value}
            onChange={() => onChange(r.value)}
            className="sr-only"
          />
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
            {ROLE_ICONS[r.value]}
          </svg>
          <span>{r.label}</span>
        </label>
      ))}
    </div>
  );
}
