export const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'needs_players', label: 'Need players' },
  { value: 'idle', label: 'Idle' },
  { value: 'in_match', label: 'In a match' },
];

export function statusLabel(team) {
  if (team.status === 'in_match') return 'In a match';
  if (team.status === 'needs_players') {
    return `Needs ${team.playersNeeded} player${team.playersNeeded === 1 ? '' : 's'}`;
  }
  return 'Idle';
}

// Team status pill: in a match (live), needs players, or idle (11+ and not playing).
export default function TeamStatus({ team }) {
  return (
    <span className={`status status--${team.status}`}>
      <span className="status__dot" aria-hidden="true" />
      {statusLabel(team)}
    </span>
  );
}
