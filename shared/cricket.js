// Cricket rules shared by the API and the client: playing roles, the MVP
// points formula and player star levels. Keep this file dependency-free.

export const ROLES = [
  { value: 'batter', label: 'Batter', short: 'BAT' },
  { value: 'bowler', label: 'Bowler', short: 'BOWL' },
  { value: 'allrounder', label: 'All-rounder', short: 'AR' },
  { value: 'wicketkeeper', label: 'Wicketkeeper', short: 'WK' },
];
export const ROLE_VALUES = ROLES.map((r) => r.value);
export const roleInfo = (value) => ROLES.find((r) => r.value === value) ?? null;

export const RESULTS = [
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
  { value: 'tied', label: 'Tied' },
  { value: 'no_result', label: 'No result' },
];
export const RESULT_VALUES = RESULTS.map((r) => r.value);

/* ------------------------------------------------------------------
   MVP points. Base: the IPL Most Valuable Player formula (four +2.5,
   six +3.5, wicket +3.5, dot ball +1, catch/stumping/run-out +2.5).
   IPL's formula ignores runs, strike rate and economy, so — like
   fantasy T20 scoring — runs count 1 each, a wicket ~ 25 runs, with
   milestone, strike-rate and economy bonuses on top.
   ------------------------------------------------------------------ */
export const POINTS = {
  run: 1,
  fourBonus: 2.5,
  sixBonus: 3.5,
  battingMilestones: [
    { at: 100, bonus: 16, label: 'Century' },
    { at: 50, bonus: 8, label: 'Half-century' },
    { at: 30, bonus: 4, label: '30+ runs' },
  ],
  duck: -2, // out for 0 after facing a ball (not applied to bowlers)
  strikeRateMinBalls: 10,
  strikeRate: [
    // [lower bound (exclusive), points]; first match wins, checked top down
    { above: 170, points: 6 },
    { above: 150, points: 4 },
    { above: 130, points: 2 },
    { above: 70, points: 0 },
    { above: 60, points: -2 },
    { above: 50, points: -4 },
    { above: -1, points: -6 },
  ],
  wicket: 25 + 3.5, // fantasy wicket value + IPL MVP wicket value
  dotBall: 1,
  maiden: 12,
  wicketHauls: [
    { at: 5, bonus: 16, label: '5-wicket haul' },
    { at: 4, bonus: 8, label: '4-wicket haul' },
    { at: 3, bonus: 4, label: '3-wicket haul' },
  ],
  economyMinBalls: 12,
  economy: [
    // [upper bound (exclusive), points]
    { below: 5, points: 6 },
    { below: 6, points: 4 },
    { below: 7, points: 2 },
    { below: 10, points: 0 },
    { below: 11, points: -2 },
    { below: 12, points: -4 },
    { below: Infinity, points: -6 },
  ],
  catch: 8 + 2.5,
  threeCatchBonus: 4,
  stumping: 12 + 2.5,
  runOut: 12 + 2.5,
};

export const STAT_LIMITS = {
  batting: { runs: 400, balls: 300, fours: 100, sixes: 100 },
  bowling: { balls: 300, runs: 500, wickets: 10, maidens: 50, dots: 300 },
  fielding: { catches: 10, stumpings: 10, runOuts: 10 },
};

export function emptyPerformance() {
  return {
    batting: { runs: 0, balls: 0, fours: 0, sixes: 0, out: false },
    bowling: { balls: 0, runs: 0, wickets: 0, maidens: 0, dots: 0 },
    fielding: { catches: 0, stumpings: 0, runOuts: 0 },
  };
}

// "3.4" overs -> 22 balls. Returns null for invalid input.
export function oversToBalls(overs) {
  const m = /^(\d{1,2})(?:\.([0-5]))?$/.exec(String(overs).trim());
  if (!m) return null;
  return Number(m[1]) * 6 + Number(m[2] ?? 0);
}
export const ballsToOvers = (balls) => `${Math.floor(balls / 6)}${balls % 6 ? `.${balls % 6}` : ''}`;

const round = (n) => Math.round(n * 10) / 10;

// Points for one player's match. Returns { points, breakdown: [{ label, points }] }.
export function scorePerformance(perf, role) {
  const { batting: bat, bowling: bowl, fielding: field } = perf;
  const items = [];
  const add = (label, points) => points && items.push({ label, points: round(points) });

  // Batting
  add(`${bat.runs} runs`, bat.runs * POINTS.run);
  add(`${bat.fours} × four`, bat.fours * POINTS.fourBonus);
  add(`${bat.sixes} × six`, bat.sixes * POINTS.sixBonus);
  const milestone = POINTS.battingMilestones.find((m) => bat.runs >= m.at);
  if (milestone) add(milestone.label, milestone.bonus);
  if (bat.out && bat.runs === 0 && bat.balls > 0 && role !== 'bowler') add('Duck', POINTS.duck);
  if (bat.balls >= POINTS.strikeRateMinBalls) {
    const sr = (bat.runs / bat.balls) * 100;
    const band = POINTS.strikeRate.find((b) => sr > b.above);
    if (band.points > 0 || role !== 'bowler') add(`Strike rate ${Math.round(sr)}`, band.points);
  }

  // Bowling
  add(`${bowl.wickets} wicket${bowl.wickets === 1 ? '' : 's'}`, bowl.wickets * POINTS.wicket);
  add(`${bowl.dots} dot ball${bowl.dots === 1 ? '' : 's'}`, bowl.dots * POINTS.dotBall);
  add(`${bowl.maidens} maiden${bowl.maidens === 1 ? '' : 's'}`, bowl.maidens * POINTS.maiden);
  const haul = POINTS.wicketHauls.find((h) => bowl.wickets >= h.at);
  if (haul) add(haul.label, haul.bonus);
  if (bowl.balls >= POINTS.economyMinBalls) {
    const econ = bowl.runs / (bowl.balls / 6);
    const band = POINTS.economy.find((b) => econ < b.below);
    add(`Economy ${econ.toFixed(1)}`, band.points);
  }

  // Fielding
  add(`${field.catches} catch${field.catches === 1 ? '' : 'es'}`, field.catches * POINTS.catch);
  if (field.catches >= 3) add('3+ catches', POINTS.threeCatchBonus);
  add(`${field.stumpings} stumping${field.stumpings === 1 ? '' : 's'}`, field.stumpings * POINTS.stumping);
  add(`${field.runOuts} run-out${field.runOuts === 1 ? '' : 's'}`, field.runOuts * POINTS.runOut);

  return { points: round(items.reduce((s, i) => s + i.points, 0)), breakdown: items };
}

// Highest points wins; ties go to more wickets, then more runs. No MVP if nobody scored.
export function pickMvp(scored) {
  const ranked = [...scored].sort(
    (a, b) =>
      b.points - a.points ||
      b.bowling.wickets - a.bowling.wickets ||
      b.batting.runs - a.batting.runs ||
      String(a.player).localeCompare(String(b.player))
  );
  return ranked[0] && ranked[0].points > 0 ? ranked[0] : null;
}

/* ------------------------------------------------------------------
   Player level: stars earned from total MVP awards.
   ------------------------------------------------------------------ */
export const STAR_LEVELS = [
  { stars: 1, mvps: 1, label: 'Rising' },
  { stars: 2, mvps: 5, label: 'Regular' },
  { stars: 3, mvps: 10, label: 'Match-winner' },
  { stars: 4, mvps: 20, label: 'Star' },
  { stars: 5, mvps: 40, label: 'Legend' },
];
export const MAX_STARS = 5;

export function levelFor(mvpCount = 0) {
  const reached = STAR_LEVELS.filter((l) => mvpCount >= l.mvps);
  const current = reached[reached.length - 1];
  const next = STAR_LEVELS[reached.length] ?? null;
  return {
    stars: current?.stars ?? 0,
    label: current?.label ?? 'Rookie',
    nextAt: next?.mvps ?? null, // total MVPs needed for the next star
  };
}

/* ------------------------------------------------------------------
   Two-team matches: dismissals, innings totals and the result.
   Wording follows Cricbuzz ("c Pant b Bumrah", "India won by 4 wkts").
   Player/team identifiers are opaque strings (names on the client,
   keys on the server).
   ------------------------------------------------------------------ */
export const DISMISSALS = [
  { value: 'dnb', label: 'Did not bat' },
  { value: 'notout', label: 'Not out' },
  { value: 'bowled', label: 'Bowled' },
  { value: 'caught', label: 'Caught' },
  { value: 'lbw', label: 'LBW' },
  { value: 'runout', label: 'Run out' },
  { value: 'stumped', label: 'Stumped' },
  { value: 'hitwicket', label: 'Hit wicket' },
  { value: 'retired', label: 'Retired hurt' },
];
export const DISMISSAL_VALUES = DISMISSALS.map((d) => d.value);
export const BOWLER_CREDITED = ['bowled', 'caught', 'lbw', 'stumped', 'hitwicket'];
export const NEEDS_FIELDER = ['caught', 'runout', 'stumped'];
export const isOut = (how) => !['dnb', 'notout', 'retired'].includes(how);
export const EXTRAS = [
  { value: 'wides', label: 'Wides', short: 'w' },
  { value: 'noBalls', label: 'No balls', short: 'nb' },
  { value: 'byes', label: 'Byes', short: 'b' },
  { value: 'legByes', label: 'Leg byes', short: 'lb' },
];
export const EXTRA_LIMIT = 100;

// "c Pant b Bumrah", "run out (Jadeja)", "not out" … `name` maps id -> display name.
export function dismissalText(batter, name = (x) => x) {
  const b = batter.bowler && name(batter.bowler);
  const f = batter.fielder && name(batter.fielder);
  switch (batter.how) {
    case 'bowled':
      return `b ${b}`;
    case 'caught':
      return f && f === b ? `c & b ${b}` : `c ${f} b ${b}`;
    case 'lbw':
      return `lbw b ${b}`;
    case 'runout':
      return f ? `run out (${f})` : 'run out';
    case 'stumped':
      return `st ${f} b ${b}`;
    case 'hitwicket':
      return `hit wicket b ${b}`;
    case 'retired':
      return 'retired hurt';
    case 'notout':
      return 'not out';
    default:
      return 'did not bat';
  }
}

export const extrasTotal = (e = {}) => EXTRAS.reduce((s, x) => s + (e[x.value] ?? 0), 0);

export function inningsTotals(inn) {
  const runs = inn.batters.reduce((s, b) => s + (b.runs ?? 0), 0) + extrasTotal(inn.extras);
  const wickets = inn.batters.filter((b) => isOut(b.how)).length;
  const balls = inn.bowlers.reduce((s, b) => s + (b.balls ?? 0), 0);
  return { runs, wickets, balls };
}

// Every player's bat/bowl/field numbers across both innings; wickets, catches,
// stumpings and run-outs are credited from the batters' dismissals.
export function buildPerformances(innings) {
  const perfs = new Map();
  const get = (id) => {
    if (!perfs.has(id)) perfs.set(id, emptyPerformance());
    return perfs.get(id);
  };
  for (const inn of innings) {
    for (const b of inn.batters) {
      const p = get(b.player);
      Object.assign(p.batting, {
        runs: b.runs ?? 0,
        balls: b.balls ?? 0,
        fours: b.fours ?? 0,
        sixes: b.sixes ?? 0,
        out: isOut(b.how),
      });
      if (BOWLER_CREDITED.includes(b.how) && b.bowler) get(b.bowler).bowling.wickets += 1;
      if (b.fielder) {
        const f = get(b.fielder).fielding;
        if (b.how === 'caught') f.catches += 1;
        if (b.how === 'stumped') f.stumpings += 1;
        if (b.how === 'runout') f.runOuts += 1;
      }
    }
    for (const w of inn.bowlers) {
      Object.assign(get(w.player).bowling, {
        balls: w.balls ?? 0,
        runs: w.runs ?? 0,
        maidens: w.maidens ?? 0,
        dots: w.dots ?? 0,
      });
    }
  }
  return perfs;
}

// { winner, type: 'runs' | 'wickets' | 'tie' | 'no_result', margin, text }
export function matchResult(innings, { noResult = false, sideName = (x) => x } = {}) {
  if (noResult || innings.length < 2) return { winner: null, type: 'no_result', margin: null, text: 'No result' };
  const [first, second] = innings.map(inningsTotals);
  if (first.runs === second.runs) return { winner: null, type: 'tie', margin: null, text: 'Match tied' };
  if (second.runs > first.runs) {
    // Wickets in hand for the chasing side (every XI member is listed as a batter).
    const margin = innings[1].batters.length - 1 - second.wickets;
    return {
      winner: innings[1].batting,
      type: 'wickets',
      margin,
      text: `${sideName(innings[1].batting)} won by ${margin} wkt${margin === 1 ? '' : 's'}`,
    };
  }
  const margin = first.runs - second.runs;
  return {
    winner: innings[0].batting,
    type: 'runs',
    margin,
    text: `${sideName(innings[0].batting)} won by ${margin} run${margin === 1 ? '' : 's'}`,
  };
}

// Box/gully cricket is often short-handed: a side fields 2–11 players.
export const XI_MIN = 2;
export const XI_MAX = 11;

export const COIN_SIDES = ['heads', 'tails'];
export const TOSS_DECISIONS = ['bat', 'bowl'];
