import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { getMe, logout, setUnauthorizedHandler } from './api.js';

const PlayerContext = createContext(null);

export function PlayerProvider({ children }) {
  const [player, setPlayer] = useState(null);
  const [ready, setReady] = useState(false);

  // Restore the session from the httpOnly cookie, if this device has one.
  useEffect(() => {
    setUnauthorizedHandler(() => setPlayer(null));
    getMe()
      .then(({ player }) => setPlayer(player))
      .catch(() => setPlayer(null))
      .finally(() => setReady(true));
  }, []);

  const signIn = useCallback((p) => setPlayer(p), []);

  const signOut = useCallback(async () => {
    try {
      await logout();
    } finally {
      setPlayer(null);
    }
  }, []);

  return (
    <PlayerContext.Provider value={{ player, ready, signIn, signOut }}>
      {children}
    </PlayerContext.Provider>
  );
}

export const usePlayer = () => useContext(PlayerContext);
