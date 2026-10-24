import { useEffect, useMemo, useState } from 'react';
import { listPlayers } from '../api.js';
import SearchSelect from './SearchSelect.jsx';

// Lets the captain pick players from all registered users.
// exclude: names that can't be picked (captain, current members).
export default function PlayerPicker({ selected, onChange, exclude = [], max }) {
  const [players, setPlayers] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    listPlayers()
      .then(setPlayers)
      .catch((err) => setError(err.message));
  }, []);

  const options = useMemo(() => {
    const taken = new Set([...exclude, ...selected].map((n) => n.toLowerCase()));
    const full = selected.length >= max;
    return players
      .filter((p) => !taken.has(p.name.toLowerCase()))
      .map((p) => ({ value: p.name, label: p.name, disabled: full, meta: full ? 'Team full' : null }));
  }, [players, exclude, selected, max]);

  return (
    <div className="picker">
      <SearchSelect
        label="Search players"
        options={options}
        placeholder={selected.length >= max ? `Maximum ${max} players reached` : 'Search players to add…'}
        emptyText={players.length ? 'No other players match' : 'No players registered yet'}
        onSelect={(o) => onChange([...selected, o.value])}
      />
      {error && <p className="help help--error">{error}</p>}

      {selected.length > 0 && (
        <ul className="chips">
          {selected.map((name) => (
            <li key={name} className="chip">
              <span className="avatar avatar--sm" aria-hidden="true">
                {name[0].toUpperCase()}
              </span>
              {name}
              <button
                type="button"
                className="chip__x"
                aria-label={`Remove ${name}`}
                onClick={() => onChange(selected.filter((n) => n !== name))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
