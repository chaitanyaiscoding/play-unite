import { useEffect, useMemo, useState } from 'react';
import { saveLineup } from '../api.js';
import LineupEditor from './LineupEditor.jsx';

// Captain's saved default XI for the team page; pre-fills new matches.
export default function LineupBoard({ team, onSaved }) {
  const initial = useMemo(
    () => ({ xi: team.lineup.playingXI.map((p) => p.name), bench: team.lineup.bench.map((p) => p.name) }),
    [team]
  );
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ text: '', error: false });

  useEffect(() => setValue(initial), [initial]);

  const members = useMemo(() => [team.captain, ...team.players], [team]);
  const dirty = value.xi.join('|') !== initial.xi.join('|') || !team.lineup.picked;

  const save = async () => {
    setSaving(true);
    setMessage({ text: '', error: false });
    try {
      onSaved(await saveLineup(team.name, value.xi));
      setMessage({ text: 'Default XI saved. New matches start from it.', error: false });
    } catch (err) {
      setMessage({ text: err.message, error: true });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card section">
      <LineupEditor
        title="Default playing XI"
        members={members}
        captain={team.captain.name}
        value={value}
        onChange={(v) => {
          setValue(v);
          setMessage({ text: '', error: false });
        }}
      />
      {message.text && <p className={message.error ? 'help help--error' : 'help help--ok'}>{message.text}</p>}
      <div className="section__foot">
        {dirty && team.lineup.picked && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setValue(initial)}>
            Reset
          </button>
        )}
        <button type="button" className="btn btn--sm" onClick={save} disabled={saving || !dirty}>
          {saving ? 'Saving…' : team.lineup.picked && !dirty ? 'XI saved' : 'Save XI'}
        </button>
      </div>
    </div>
  );
}
