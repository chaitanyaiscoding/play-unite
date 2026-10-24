import { useState } from 'react';
import { Link } from 'react-router-dom';
import MatchTile, { useMatchList } from '../components/MatchTile.jsx';

const TABS = [
  { value: 'live', label: 'Live' },
  { value: 'completed', label: 'Results' },
];

// Every match anyone can follow: live now, and completed results.
export default function Matches() {
  const [tab, setTab] = useState('live');
  const matches = useMatchList(tab, 50);

  return (
    <section className="stack">
      <Link to="/home" className="back">← Home</Link>
      <div className="card section">
        <h3>Matches</h3>
        <div className="filters" role="tablist" aria-label="Live or results">
          {TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={tab === t.value}
              className={`filter${tab === t.value ? ' is-active' : ''}`}
              onClick={() => setTab(t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>
        {matches && matches.length === 0 && (
          <p className="help empty">
            {tab === 'live' ? 'No matches in progress right now.' : 'No completed matches yet.'}{' '}
            <Link to="/matches/new">Create a match</Link>
          </p>
        )}
        {matches && matches.length > 0 && (
          <div className="match-list">
            {matches.map((m) => (
              <MatchTile key={m.id} match={m} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
