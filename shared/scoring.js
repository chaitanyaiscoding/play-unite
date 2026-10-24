// Ball-by-ball scoring engine shared by the API (validation) and the client
// (scorer screen, live view). Each innings is a log of events; replaying the
// log gives the full state: score, batters, bowlers, strike, overs, fall of
// wickets and commentary. Undo = drop the last event.
//
// Player and team ids are opaque strings (keys on the server, names on the client).
//
// Events:
//   { type: 'start', striker, nonStriker, bowler }       openers + opening bowler
//   { type: 'ball', runs, extra?, wicket? }               one delivery
//       extra: null | 'wide' | 'noball' | 'bye' | 'legbye'
//       runs:  off the bat (normal / no ball), runs taken (wide / bye / leg bye)
//       wicket: { how, out?, fielder? }  (out defaults to the striker)
//   { type: 'batter', player }                            new batter into the empty end
//   { type: 'bowler', bowler }                            bowler for the next over
//   { type: 'swap' }                                      change strike
//   { type: 'retire', player }                            retired hurt (not out, can return)
//   { type: 'endInnings' }                                scorer closes the innings early
import { BOWLER_CREDITED } from './cricket.js';

export const EXTRA_TYPES = ['wide', 'noball', 'bye', 'legbye'];
export const WICKET_TYPES = [
  { value: 'bowled', label: 'Bowled' },
  { value: 'caught', label: 'Caught' },
  { value: 'lbw', label: 'LBW' },
  { value: 'runout', label: 'Run out' },
  { value: 'stumped', label: 'Stumped' },
  { value: 'hitwicket', label: 'Hit wicket' },
];
// Which dismissals are possible off each kind of delivery (Laws of Cricket).
export const WICKETS_ON = {
  none: WICKET_TYPES.map((w) => w.value),
  wide: ['stumped', 'runout', 'hitwicket'],
  noball: ['runout'],
  bye: ['runout'],
  legbye: ['runout'],
};
export const OVERS_MIN = 1;
export const OVERS_MAX = 50;

export class ScoringError extends Error {}
const fail = (msg) => {
  throw new ScoringError(msg);
};

const blankBatter = (order) => ({ runs: 0, balls: 0, fours: 0, sixes: 0, how: 'notout', bowler: null, fielder: null, order });
const blankBowler = (order) => ({ balls: 0, runs: 0, wickets: 0, maidens: 0, dots: 0, order });

function newInnings(batting, bowling) {
  return {
    batting: batting.team,
    bowling: bowling.team,
    battingXI: batting.xi,
    bowlingXI: bowling.xi,
    runs: 0,
    wickets: 0,
    legal: 0, // legal deliveries bowled
    extras: { wides: 0, noBalls: 0, byes: 0, legByes: 0 },
    batters: {}, // id -> figures (only players who came in)
    bowlers: {},
    striker: null,
    nonStriker: null,
    bowler: null,
    lastOverBowler: null,
    overRuns: 0, // runs conceded by the bowler this over (maidens)
    overTotal: 0, // all runs scored this over, extras included
    thisOver: [], // ball labels in the current over
    overs: [], // completed overs: { number, bowler, runs, wickets, balls }
    overWickets: 0,
    fow: [], // fall of wickets: { score, wicket, over, player }
    partnership: { runs: 0, balls: 0 },
    commentary: [], // newest last
    needs: ['openers'],
    complete: false,
    endReason: null,
  };
}

export const oversText = (legal) => `${Math.floor(legal / 6)}.${legal % 6}`.replace(/\.0$/, '');
const ballNumber = (legal) => `${Math.floor(legal / 6)}.${(legal % 6) + 1}`; // for the delivery about to be bowled

const isBatting = (inn, id) => inn.striker === id || inn.nonStriker === id;

// Players who can still come in to bat (never batted, or retired hurt).
export function availableBatters(inn) {
  return inn.battingXI.filter((id) => !isBatting(inn, id) && (!inn.batters[id] || inn.batters[id].how === 'retired'));
}

// Bowlers allowed for the next over (no one bowls consecutive overs).
export function availableBowlers(inn) {
  return inn.bowlingXI.filter((id) => id !== inn.lastOverBowler);
}

function addBatter(inn, id) {
  if (!inn.batters[id]) inn.batters[id] = blankBatter(Object.keys(inn.batters).length);
  else inn.batters[id].how = 'notout'; // a retired batter returning
}
function addBowler(inn, id) {
  if (!inn.bowlers[id]) inn.bowlers[id] = blankBowler(Object.keys(inn.bowlers).length);
}

// After an event: is the innings over, and what does the scorer need to pick next?
function settle(state, idx) {
  const inn = state.innings[idx];
  const allOut = inn.wickets >= inn.battingXI.length - 1;
  const oversDone = inn.legal >= state.overs * 6;
  const chased = idx === 1 && inn.runs >= state.target;
  const empty = inn.striker === null || inn.nonStriker === null;
  const noOneLeft = empty && availableBatters(inn).length === 0;
  if (allOut || oversDone || chased || noOneLeft) {
    inn.complete = true;
    inn.endReason = chased ? 'target' : oversDone ? 'overs' : 'allout';
    inn.needs = [];
    return;
  }
  inn.needs = [];
  if (empty) inn.needs.push('batter');
  if (inn.bowler === null) inn.needs.push('bowler');
}

function ballLabel(extra, runs, extraRuns, wicket) {
  let label;
  if (extra === 'wide') label = extraRuns > 1 ? `${extraRuns}Wd` : 'Wd';
  else if (extra === 'noball') label = runs ? `Nb+${runs}` : 'Nb';
  else if (extra === 'bye') label = `${runs}B`;
  else if (extra === 'legbye') label = `${runs}Lb`;
  else label = runs === 0 ? '•' : String(runs);
  if (wicket) label = label === '•' ? 'W' : `${label}+W`;
  return label;
}

function applyBall(state, idx, e) {
  const inn = state.innings[idx];
  const extra = e.extra ?? null;
  if (extra !== null && !EXTRA_TYPES.includes(extra)) fail(`Unknown extra "${extra}".`);
  const runs = Number(e.runs ?? 0);
  const maxRuns = extra === 'wide' || extra === 'bye' || extra === 'legbye' ? 4 : 6;
  const minRuns = extra === 'bye' || extra === 'legbye' ? 1 : 0;
  if (!Number.isInteger(runs) || runs < minRuns || runs > maxRuns) {
    fail(`Runs must be ${minRuns}–${maxRuns} for ${extra ? extra.replace('noball', 'a no ball') : 'a delivery'}.`);
  }

  const striker = inn.striker;
  const bat = inn.batters[striker];
  const bowl = inn.bowlers[inn.bowler];
  const legal = extra !== 'wide' && extra !== 'noball';

  let batRuns = 0;
  let conceded = 0;
  let total = 0;
  let extraRuns = 0;
  if (extra === null) [batRuns, conceded, total] = [runs, runs, runs];
  else if (extra === 'wide') {
    extraRuns = 1 + runs;
    inn.extras.wides += extraRuns;
    [conceded, total] = [extraRuns, extraRuns];
  } else if (extra === 'noball') {
    inn.extras.noBalls += 1;
    [batRuns, conceded, total] = [runs, 1 + runs, 1 + runs];
  } else {
    inn.extras[extra === 'bye' ? 'byes' : 'legByes'] += runs;
    total = runs;
  }

  // Wicket checks before anything changes.
  let wicket = null;
  if (e.wicket) {
    const how = e.wicket.how;
    const allowed = WICKETS_ON[extra ?? 'none'];
    if (!allowed.includes(how)) fail(`Can't be out ${how} off ${extra ? `a ${extra}` : 'this ball'}.`);
    const out = e.wicket.out ?? striker;
    if (!isBatting(inn, out)) fail('The dismissed batter must be one of the two at the crease.');
    if (how !== 'runout' && out !== striker) fail('Only the striker can be out that way.');
    const fielder = e.wicket.fielder ?? null;
    if ((how === 'caught' || how === 'stumped') && !fielder) fail(`Pick the ${how === 'caught' ? 'catcher' : 'wicketkeeper'}.`);
    if (fielder && !inn.bowlingXI.includes(fielder)) fail('The fielder must be from the bowling side.');
    wicket = { how, out, fielder };
  }

  bat.runs += batRuns;
  if (extra !== 'wide') bat.balls += 1;
  if (extra === null || extra === 'noball') {
    if (batRuns === 4) bat.fours += 1;
    if (batRuns === 6) bat.sixes += 1;
  }
  bowl.runs += conceded;
  inn.overRuns += conceded;
  inn.overTotal += total;
  if (legal) {
    bowl.balls += 1;
    if (conceded === 0) bowl.dots += 1;
  }
  inn.runs += total;
  inn.partnership.runs += total;
  if (legal) inn.partnership.balls += 1;

  const label = ballLabel(extra, runs, extraRuns, wicket);
  const over = ballNumber(inn.legal);
  if (legal) inn.legal += 1;
  inn.thisOver.push(label);
  inn.commentary.push({ over, bowler: inn.bowler, batter: striker, label, extra, runs, total, wicket });

  // Odd runs taken (off the bat, or run on a wide/bye/leg bye) -> batters crossed.
  if (runs % 2 === 1) [inn.striker, inn.nonStriker] = [inn.nonStriker, inn.striker];

  if (wicket) {
    const b = inn.batters[wicket.out];
    b.how = wicket.how;
    b.bowler = BOWLER_CREDITED.includes(wicket.how) ? inn.bowler : null;
    b.fielder = wicket.fielder;
    if (BOWLER_CREDITED.includes(wicket.how)) bowl.wickets += 1;
    inn.wickets += 1;
    inn.overWickets += 1;
    inn.fow.push({ score: inn.runs, wicket: inn.wickets, over: oversText(inn.legal), player: wicket.out });
    inn.partnership = { runs: 0, balls: 0 };
    if (inn.striker === wicket.out) inn.striker = null;
    else inn.nonStriker = null;
  }

  // End of the over: change ends, record it, need a new bowler.
  if (legal && inn.legal % 6 === 0) {
    if (inn.overRuns === 0) bowl.maidens += 1;
    inn.overs.push({
      number: inn.legal / 6,
      bowler: inn.bowler,
      runs: inn.overTotal,
      wickets: inn.overWickets,
      balls: inn.thisOver,
    });
    [inn.striker, inn.nonStriker] = [inn.nonStriker, inn.striker];
    inn.lastOverBowler = inn.bowler;
    inn.bowler = null;
    inn.overRuns = 0;
    inn.overTotal = 0;
    inn.overWickets = 0;
    inn.thisOver = [];
  }
}

function apply(state, idx, e) {
  const inn = state.innings[idx];
  if (inn.complete) fail('This innings is over.');
  const needs = inn.needs;

  switch (e?.type) {
    case 'start': {
      if (needs[0] !== 'openers') fail('The openers are already in.');
      const { striker, nonStriker, bowler } = e;
      if (!inn.battingXI.includes(striker) || !inn.battingXI.includes(nonStriker)) fail('Pick both openers from the batting side.');
      if (striker === nonStriker) fail('Pick two different openers.');
      if (!inn.bowlingXI.includes(bowler)) fail('Pick the opening bowler from the bowling side.');
      addBatter(inn, striker);
      addBatter(inn, nonStriker);
      addBowler(inn, bowler);
      Object.assign(inn, { striker, nonStriker, bowler });
      break;
    }
    case 'ball':
      if (needs.length) fail(needs[0] === 'openers' ? 'Pick the openers first.' : `Pick the new ${needs[0]} first.`);
      applyBall(state, idx, e);
      break;
    case 'batter': {
      if (!needs.includes('batter')) fail('No batter is needed right now.');
      if (!availableBatters(inn).includes(e.player)) fail('That player can’t come in to bat.');
      addBatter(inn, e.player);
      if (inn.striker === null) inn.striker = e.player;
      else inn.nonStriker = e.player;
      break;
    }
    case 'bowler': {
      if (!needs.includes('bowler')) fail('No bowler is needed right now.');
      if (!inn.bowlingXI.includes(e.bowler)) fail('Pick a bowler from the bowling side.');
      if (e.bowler === inn.lastOverBowler) fail('A bowler can’t bowl two overs in a row.');
      addBowler(inn, e.bowler);
      inn.bowler = e.bowler;
      break;
    }
    case 'swap':
      if (needs.includes('openers') || needs.includes('batter')) fail('Both batters must be in to change strike.');
      [inn.striker, inn.nonStriker] = [inn.nonStriker, inn.striker];
      break;
    case 'retire': {
      if (!isBatting(inn, e.player)) fail('Only a batter at the crease can retire.');
      inn.batters[e.player].how = 'retired';
      if (inn.striker === e.player) inn.striker = null;
      else inn.nonStriker = null;
      inn.partnership = { runs: 0, balls: 0 };
      break;
    }
    case 'endInnings':
      if (needs.includes('openers')) fail('The innings hasn’t started.');
      inn.complete = true;
      inn.endReason = 'declared';
      inn.needs = [];
      return;
    default:
      fail(`Unknown scoring event "${e?.type}".`);
  }
  settle(state, idx);
}

// config: { overs, battingFirst, sides: [{ team, xi: [ids] }, { team, xi }] }
// logs:   [events of innings 1, events of innings 2]
export function replay(config, logs = []) {
  const first = config.sides.find((s) => s.team === config.battingFirst);
  const second = config.sides.find((s) => s.team !== config.battingFirst);
  const state = { overs: config.overs, target: null, innings: [newInnings(first, second)], current: 0, finished: false };

  (logs[0] ?? []).forEach((e, i) => {
    try {
      apply(state, 0, e);
    } catch (err) {
      if (err instanceof ScoringError) err.at = { innings: 0, index: i };
      throw err;
    }
  });
  if (state.innings[0].complete) {
    state.target = state.innings[0].runs + 1;
    state.innings.push(newInnings(second, first));
    state.current = 1;
    (logs[1] ?? []).forEach((e, i) => {
      try {
        apply(state, 1, e);
      } catch (err) {
        if (err instanceof ScoringError) err.at = { innings: 1, index: i };
        throw err;
      }
    });
    if (state.innings[1].complete) {
      state.finished = true;
      state.current = null;
    }
  } else if (logs[1]?.length) {
    fail('The first innings isn’t over yet.');
  }
  return state;
}

// Splits a flat log of { inn, ...event } entries into per-innings arrays.
export function splitLog(log = []) {
  const out = [[], []];
  for (const { inn, ...e } of log) out[inn].push(e);
  return out;
}

// Current run rate, and for a chase: runs needed, balls left, required rate.
export function rates(state, idx = state.current ?? state.innings.length - 1) {
  const inn = state.innings[idx];
  const crr = inn.legal ? (inn.runs / (inn.legal / 6)).toFixed(2) : '0.00';
  if (idx !== 1) return { crr };
  const need = Math.max(0, state.target - inn.runs);
  const ballsLeft = state.overs * 6 - inn.legal;
  return { crr, need, ballsLeft, rrr: ballsLeft > 0 ? (need / (ballsLeft / 6)).toFixed(2) : '–' };
}

// Innings in the shape the scorecard/MVP code uses (cricket.js buildPerformances).
export function summarize(inn) {
  const batted = Object.entries(inn.batters)
    .sort((a, b) => a[1].order - b[1].order)
    .map(([player, b]) => ({ player, runs: b.runs, balls: b.balls, fours: b.fours, sixes: b.sixes, how: b.how, bowler: b.bowler, fielder: b.fielder }));
  const dnb = inn.battingXI
    .filter((id) => !inn.batters[id])
    .map((player) => ({ player, runs: 0, balls: 0, fours: 0, sixes: 0, how: 'dnb', bowler: null, fielder: null }));
  const bowlers = Object.entries(inn.bowlers)
    .sort((a, b) => a[1].order - b[1].order)
    .filter(([, w]) => w.balls || w.runs)
    .map(([player, w]) => ({ player, balls: w.balls, runs: w.runs, maidens: w.maidens, dots: w.dots }));
  return {
    batting: inn.batting,
    bowling: inn.bowling,
    batters: [...batted, ...dnb],
    extras: { ...inn.extras },
    bowlers,
    total: { runs: inn.runs, wickets: inn.wickets, balls: inn.legal },
    fow: inn.fow,
  };
}

// "Bumrah to Head, FOUR" style line for a commentary entry. `name` maps id -> name.
export function describeBall(c, name = (x) => x) {
  const who = `${name(c.bowler)} to ${name(c.batter)}`;
  let what;
  if (c.extra === 'wide') what = c.total > 1 ? `wide, ${c.total} runs` : 'wide';
  else if (c.extra === 'noball') what = c.runs === 4 ? 'no ball, FOUR' : c.runs === 6 ? 'no ball, SIX' : c.runs ? `no ball, ${c.runs} run${c.runs > 1 ? 's' : ''}` : 'no ball';
  else if (c.extra === 'bye') what = `${c.runs} bye${c.runs > 1 ? 's' : ''}`;
  else if (c.extra === 'legbye') what = `${c.runs} leg bye${c.runs > 1 ? 's' : ''}`;
  else what = c.runs === 0 ? 'no run' : c.runs === 4 ? 'FOUR' : c.runs === 6 ? 'SIX' : `${c.runs} run${c.runs > 1 ? 's' : ''}`;
  if (c.wicket) {
    const how = WICKET_TYPES.find((w) => w.value === c.wicket.how)?.label ?? c.wicket.how;
    what = `OUT! ${name(c.wicket.out)} ${how.toLowerCase()}${c.wicket.fielder ? ` (${name(c.wicket.fielder)})` : ''}${what === 'no run' ? '' : `, ${what}`}`;
  }
  return `${who}, ${what}`;
}
