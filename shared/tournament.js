// Tournament rules shared by the API and the client: how connected matches fill
// in their teams, the wins table, the awards, and when the final and the end of
// the tournament are allowed.

export const TAKES = ['winner', 'loser'];

const BUSY = ['toss', 'live', 'waiting', 'ready'];
const plainSide = (s) => ({ team: s.team, name: s.name });

// The team a source hands on: a side, null while its match is undecided, or
// NO_TEAM when that match ended with no winner.
const NO_TEAM = Symbol('no team');
function teamFrom(source, take) {
  if (!source || source.state === 'no_result' || source.state === 'abandoned') return NO_TEAM;
  if (source.state !== 'completed') return null;
  return source[take] ?? NO_TEAM;
}

function resolveMatchEntry(base, match) {
  const sides = match?.sides ?? [];
  const winnerKey = match?.status === 'completed' ? match.outcome?.winner : null;
  const winner = winnerKey ? sides.find((s) => s.team === winnerKey) : null;
  const loser = winnerKey ? sides.find((s) => s.team !== winnerKey) : null;
  return {
    ...base,
    state: match?.status ?? 'abandoned',
    teams: sides.map(plainSide),
    winner: winner ? plainSide(winner) : null,
    loser: loser ? plainSide(loser) : null,
  };
}

// Entries in number order, each with its `state`: the match's status once it
// has a match, otherwise waiting | ready | no_result. Sources are always earlier
// entries, so one pass carries results (and no-results) down a chain.
export function resolveEntries(entries, matches) {
  const byNumber = new Map();
  return [...entries]
    .sort((a, b) => a.number - b.number)
    .map((e) => {
      const base = {
        number: e.number,
        final: Boolean(e.final),
        match: e.match ? String(e.match) : null,
        sources: (e.sources ?? []).map((s) => ({ number: s.number, take: s.take })),
      };
      let resolved;
      if (base.match) {
        resolved = resolveMatchEntry(base, matches.get(base.match));
      } else {
        const picks = base.sources.map((s) => teamFrom(byNumber.get(s.number), s.take));
        const noTeam = picks.includes(NO_TEAM);
        const known = picks.filter((p) => p && p !== NO_TEAM);
        const sameTeam = known.length === 2 && known[0].team === known[1].team;
        let state = 'ready';
        if (noTeam || sameTeam) state = 'no_result';
        else if (known.length < 2) state = 'waiting';
        resolved = { ...base, state, teams: picks.map((p) => (p && p !== NO_TEAM ? plainSide(p) : null)), winner: null, loser: null };
      }
      byNumber.set(e.number, resolved);
      return resolved;
    });
}

// The wins table. Finished matches count, except the final; abandoned matches
// don't. Teams level on wins follow `order` (the organiser's call), then name.
export function standings(resolved, matches, order = []) {
  const rows = new Map();
  const row = (s) => {
    if (!rows.has(s.team)) rows.set(s.team, { team: s.team, name: s.name, played: 0, won: 0, lost: 0, noResult: 0 });
    return rows.get(s.team);
  };
  for (const e of resolved) {
    if (e.final || !e.match || e.state !== 'completed') continue;
    for (const side of matches.get(e.match)?.sides ?? []) {
      const r = row(side);
      r.played += 1;
      if (!e.winner) r.noResult += 1;
      else if (e.winner.team === side.team) r.won += 1;
      else r.lost += 1;
    }
  }
  const rank = (team) => {
    const i = order.indexOf(team);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...rows.values()].sort((a, b) => b.won - a.won || rank(a.team) - rank(b.team) || a.name.localeCompare(b.name));
}

// Most runs (fewest balls breaks a tie) and most wickets (fewest runs conceded
// breaks a tie) across the finished matches.
export function bestPlayers(matchList) {
  const totals = new Map();
  for (const m of matchList) {
    if (m.status !== 'completed') continue;
    for (const p of m.performances ?? []) {
      const t = totals.get(p.player) ?? { player: p.player, runs: 0, balls: 0, wickets: 0, conceded: 0, bowled: 0 };
      t.runs += p.batting?.runs ?? 0;
      t.balls += p.batting?.balls ?? 0;
      t.wickets += p.bowling?.wickets ?? 0;
      t.conceded += p.bowling?.runs ?? 0;
      t.bowled += p.bowling?.balls ?? 0;
      totals.set(p.player, t);
    }
  }
  const all = [...totals.values()];
  const [bat] = all.filter((t) => t.runs > 0).sort((a, b) => b.runs - a.runs || a.balls - b.balls || a.player.localeCompare(b.player));
  const [bowl] = all.filter((t) => t.wickets > 0).sort((a, b) => b.wickets - a.wickets || a.conceded - b.conceded || a.player.localeCompare(b.player));
  return {
    batsman: bat ? { player: bat.player, runs: bat.runs, balls: bat.balls } : null,
    bowler: bowl ? { player: bowl.player, wickets: bowl.wickets, runs: bowl.conceded, balls: bowl.bowled } : null,
  };
}

// A final still counts unless it ended with no winner or was abandoned.
const decidingFinal = (resolved) =>
  resolved.find((e) => e.final && (['toss', 'live'].includes(e.state) || e.winner));

const anyBusy = (resolved) => resolved.some((e) => BUSY.includes(e.state));

export function addMatchBlocker(resolved) {
  return decidingFinal(resolved) ? 'The final has been created, so no more matches can be added.' : null;
}

export function finalBlocker(resolved, rows) {
  if (decidingFinal(resolved)) return 'The final has already been created.';
  if (anyBusy(resolved)) return 'Finish or remove the matches still in progress or waiting first.';
  if (rows.length < 2) return 'The final needs two teams in the table.';
  return null;
}

export function completeBlocker(resolved) {
  if (anyBusy(resolved)) return 'Finish or remove the matches still in progress or waiting first.';
  if (!resolved.some((e) => e.state === 'completed')) return 'Play at least one match first.';
  return null;
}

// The final's winner; with no decided final, the top of the table.
export function champion(resolved, rows) {
  const final = resolved.find((e) => e.final && e.winner);
  if (final) return { team: final.winner.team, name: final.winner.name };
  return rows[0] ? { team: rows[0].team, name: rows[0].name } : null;
}
