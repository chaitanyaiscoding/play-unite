import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { getNotifications } from './api.js';
import { usePlayer } from './PlayerContext.jsx';

const POLL_MS = 15000;
const EMPTY = { incoming: [], updates: [] };
const NotificationsContext = createContext(null);

// Polls the API so captains see new join requests without reloading.
export function NotificationsProvider({ children }) {
  const { player } = usePlayer();
  const [data, setData] = useState(EMPTY);

  const refresh = useCallback(async () => {
    if (!player) return setData(EMPTY);
    try {
      setData(await getNotifications());
    } catch {
      // Keep the last known notifications if a poll fails.
    }
  }, [player]);

  useEffect(() => {
    refresh();
    if (!player) return;
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [player, refresh]);

  const count = data.incoming.length + data.updates.length;

  return (
    <NotificationsContext.Provider value={{ ...data, count, refresh }}>
      {children}
    </NotificationsContext.Provider>
  );
}

export const useNotifications = () => useContext(NotificationsContext);
