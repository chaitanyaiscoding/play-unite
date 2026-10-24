// The session lives in an httpOnly cookie the browser sends automatically.
// When it's missing or expired the API answers 401 and we sign the user out.
let onUnauthorized = null;
export const setUnauthorizedHandler = (fn) => {
  onUnauthorized = fn;
};

async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized?.();
    const err = new Error(data.error || 'Request failed.');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

const post = (path, body) => request(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
const enc = encodeURIComponent;

export const lookupName = (name) => request(`/auth/lookup?name=${enc(name)}`);
export const register = (name, pin, role) => post('/auth/register', { name, pin, role });
export const login = (name, pin, role) => post('/auth/login', { name, pin, role });
export const getMe = () => request('/auth/me');
export const updateMe = (changes) => request('/auth/me', { method: 'PATCH', body: JSON.stringify(changes) });
export const logout = () => post('/auth/logout');

export const listPlayers = () => request('/players');
export const getPlayerProfile = (name) => request(`/players/${enc(name)}`);

export const listTeams = ({ q = '', status = '' } = {}) => {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  const qs = params.toString();
  return request(`/teams${qs ? `?${qs}` : ''}`);
};
export const myTeams = () => request('/teams/mine');
export const checkTeamName = (name) => request(`/teams/availability?name=${enc(name)}`);
export const createTeam = (name, players) => post('/teams', { name, players });
export const getTeam = (name) => request(`/teams/${enc(name)}`);
export const addTeamPlayers = (name, players) => post(`/teams/${enc(name)}/players`, { players });
export const requestToJoin = (name) => post(`/teams/${enc(name)}/requests`);
export const saveLineup = (name, playingXI) =>
  request(`/teams/${enc(name)}/lineup`, { method: 'PUT', body: JSON.stringify({ playingXI }) });

export const createMatch = (team, opponent) => post('/matches', { team, opponent });
export const getMatch = (id) => request(`/matches/${id}`);
export const listMatches = ({ status = '', limit = 20 } = {}) =>
  request(`/matches?${new URLSearchParams({ ...(status ? { status } : {}), limit: String(limit) })}`);
export const callToss = (id, call) => post(`/matches/${id}/toss`, { call });
export const chooseToss = (id, decision, overs) => post(`/matches/${id}/decision`, { decision, overs });
// Ball-by-ball scoring: `at` is how many events this device has seen.
export const addMatchEvent = (id, event, at) => post(`/matches/${id}/events`, { event, at });
export const undoMatchEvent = (id, at) => post(`/matches/${id}/undo`, { at });
export const finishMatch = (id, at, noResult = false) => post(`/matches/${id}/complete`, { at, noResult });
export const abandonMatch = (id) => post(`/matches/${id}/abandon`);

export const acceptRequest = (id) => post(`/requests/${id}/accept`);
export const rejectRequest = (id) => post(`/requests/${id}/reject`);

export const getNotifications = () => request('/notifications');
export const markNotificationsSeen = () => post('/notifications/seen');
