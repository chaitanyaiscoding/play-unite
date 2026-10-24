import { useEffect, useState } from 'react';
import { API_VERSION } from '../../../shared/version.js';

// Warns when the API server is running older code than this client expects
// (e.g. it was started with plain `node index.js` and never restarted).
export default function StaleApiBanner() {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((h) => setStale(h.apiVersion !== API_VERSION))
      .catch(() => {});
  }, []);

  if (!stale) return null;
  return (
    <div className="stale-api" role="alert">
      <strong>The API server is running old code.</strong> Stop it and start it again from the{' '}
      <code>server</code> folder with <code>npm run dev</code>, then reload this page.
    </div>
  );
}
