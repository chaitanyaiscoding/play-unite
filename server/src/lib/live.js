// Pushes "this match changed" to everyone watching it (Server-Sent Events),
// so followers see each ball as soon as the scorer taps it in.
const watchers = new Map(); // matchId -> Set<res>
const KEEPALIVE_MS = 25000;

export function watch(matchId, req, res) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('retry: 3000\n\n');

  const key = String(matchId);
  if (!watchers.has(key)) watchers.set(key, new Set());
  watchers.get(key).add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), KEEPALIVE_MS);

  req.on('close', () => {
    clearInterval(ping);
    const set = watchers.get(key);
    set?.delete(res);
    if (set && !set.size) watchers.delete(key);
  });
}

export function publish(matchId, payload) {
  const set = watchers.get(String(matchId));
  if (!set) return;
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of set) res.write(data);
}
