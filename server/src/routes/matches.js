import crypto from 'node:crypto';
import { Router } from 'express';
import mongoose from 'mongoose';
import { Player, nameKey } from '../models/Player.js';
import { Team, teamKey, isMember } from '../models/Team.js';
import { Match, isLegacy, sideOf, otherSide } from '../models/Match.js';
import { requirePlayer } from '../middleware/currentPlayer.js';
import { finalizeMatch, replayMatch } from '../lib/scorecard.js';
import { watch, publish } from '../lib/live.js';
import { COIN_SIDES, TOSS_DECISIONS, XI_MIN, XI_MAX, dismissalText, levelFor } from '../../../shared/cricket.js';
import { ScoringError, OVERS_MIN, OVERS_MAX, rates } from '../../../shared/scoring.js';

const router = Router();
router.use(requirePlayer);

const ACTIVE = ['toss', 'live'];
const FREE = { inMatch: false, matchStartedAt: null, currentMatch: null };
const membersOf = (team) => [team.captain, ...team.players];

async function loadMatch(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(404).json({ error: 'Match not found.' });
    return null;
  }
  const match = await Match.findById(req.params.id);
  if (!match) res.status(404).json({ error: 'Match not found.' });
  return match;
}

// Only the player who created the match runs the toss and the scorecard.
async function loadForCreator(req, res, action) {
  const match = await loadMatch(req, res);
  if (!match) return null;
  if (isLegacy(match) || match.createdBy !== req.player._id) {
    res.status(403).json({ error: `Only the player who created this match can ${action}.` });
    return null;
  }
  return match;
}

// Player fields in a scoring event, mapped through `fn` (names <-> keys).
const PLAYER_FIELDS = ['striker', 'nonStriker', 'bowler', 'player'];
function mapEvent(e, fn) {
  const out = { ...e };
  for (const f of PLAYER_FIELDS) if (out[f] != null) out[f] = fn(out[f]);
  if (out.wicket) {
    out.wicket = { ...out.wicket };
    if (out.wicket.out != null) out.wicket.out = fn(out.wicket.out);
    if (out.wicket.fielder != null) out.wicket.fielder = fn(out.wicket.fielder);
  }
  return out;
}

// Only the fields an event can carry, with names turned into player keys.
function readEvent(raw) {
  const e = { type: String(raw?.type ?? '') };
  for (const f of PLAYER_FIELDS) if (raw?.[f] != null) e[f] = nameKey(raw[f]);
  if (e.type === 'ball') {
    e.runs = Number(raw.runs ?? 0);
    e.extra = raw.extra ?? null;
    if (raw.wicket) {
      e.wicket = { how: String(raw.wicket.how ?? '') };
      if (raw.wicket.out != null) e.wicket.out = nameKey(raw.wicket.out);
      if (raw.wicket.fielder != null) e.wicket.fielder = nameKey(raw.wicket.fielder);
    }
  }
  return e;
}

async function playerMap(keys) {
  const players = await Player.find({ _id: { $in: [...new Set(keys.filter(Boolean))] } }, { name: 1, role: 1, mvpCount: 1 });
  return new Map(players.map((p) => [p._id, p]));
}

async function view(match, me) {
  if (isLegacy(match)) return legacyView(match);

  const keys = [
    match.createdBy,
    match.mvp,
    ...match.sides.flatMap((s) => [...s.playingXI, ...s.bench]),
    ...match.performances.map((p) => p.player),
  ];
  const players = await playerMap(keys);
  const name = (k) => players.get(k)?.name ?? k;
  const person = (k) => {
    const p = players.get(k);
    return { name: p?.name ?? k, role: p?.role ?? null, stars: levelFor(p?.mvpCount).stars };
  };
  const sideName = (teamKey) => sideOf(match, teamKey)?.name ?? null;
  const perfByKey = new Map(match.performances.map((p) => [p.player, p]));
  const teams = await Team.find({ _id: { $in: match.sides.map((s) => s.team) } }, { captain: 1, players: 1 });
  const isParticipant = teams.some((t) => isMember(t, me));

  return {
    id: match._id,
    version: 2,
    status: match.status,
    createdBy: name(match.createdBy),
    canControl: match.createdBy === me,
    isParticipant,
    sides: match.sides.map((s) => ({
      team: s.name,
      captain: name(teams.find((t) => t._id === s.team)?.captain),
      playingXI: s.playingXI.map(person),
      bench: s.bench.map(person),
    })),
    toss: match.toss?.outcome
      ? {
          call: match.toss.call,
          outcome: match.toss.outcome,
          winner: sideName(match.toss.winner),
          decision: match.toss.decision,
          text: match.toss.decision
            ? `${sideName(match.toss.winner)} won the toss and opted to ${match.toss.decision}`
            : `${sideName(match.toss.winner)} won the toss`,
        }
      : null,
    battingFirst: sideName(match.battingFirst),
    overs: match.overs,
    // Ball-by-ball log with names, so the client can replay it with shared/scoring.js.
    log: (match.log ?? []).map((e) => mapEvent(e, name)),
    innings: (match.innings ?? []).map((inn) => ({
      batting: sideName(inn.batting),
      bowling: sideName(inn.bowling),
      batters: inn.batters.map((b) => ({
        ...person(b.player),
        runs: b.runs,
        balls: b.balls,
        fours: b.fours,
        sixes: b.sixes,
        how: b.how,
        dismissal: dismissalText(b, name),
      })),
      extras: inn.extras,
      bowlers: inn.bowlers.map((w) => ({
        ...person(w.player),
        balls: w.balls,
        runs: w.runs,
        maidens: w.maidens,
        dots: w.dots,
        wickets: perfByKey.get(w.player)?.bowling.wickets ?? 0,
      })),
      total: inn.total,
      fow: (inn.fow ?? []).map((f) => ({ score: f.score, wicket: f.wicket, over: f.over, player: name(f.player) })),
    })),
    outcome: match.outcome?.type
      ? {
          type: match.outcome.type,
          margin: match.outcome.margin,
          text: match.outcome.text,
          winner: sideName(match.outcome.winner),
        }
      : null,
    mvp: match.mvp ? { ...person(match.mvp), points: match.mvpPoints } : null,
    performances: [...match.performances]
      .sort((a, b) => b.points - a.points)
      .map((p) => ({
        ...person(p.player),
        team: sideName(p.team),
        batting: p.batting,
        bowling: p.bowling,
        fielding: p.fielding,
        points: p.points,
        breakdown: p.breakdown,
      })),
    startedAt: match.startedAt,
    endedAt: match.endedAt,
  };
}

// Matches recorded before two-team matches existed.
async function legacyView(match) {
  const team = await Team.findById(match.team, { name: 1 });
  const players = await playerMap([...(match.playingXI ?? []), ...(match.bench ?? []), match.mvp, ...match.performances.map((p) => p.player)]);
  const person = (k) => ({ name: players.get(k)?.name ?? k, role: players.get(k)?.role ?? null });
  return {
    id: match._id,
    version: 1,
    team: team?.name ?? match.team,
    opponent: match.opponent,
    status: match.status,
    result: match.result,
    startedAt: match.startedAt,
    endedAt: match.endedAt,
    playingXI: (match.playingXI ?? []).map(person),
    bench: (match.bench ?? []).map(person),
    mvp: match.mvp && { name: players.get(match.mvp)?.name, points: match.mvpPoints, stars: levelFor(players.get(match.mvp)?.mvpCount).stars },
    performances: [...match.performances]
      .sort((a, b) => b.points - a.points)
      .map((p) => ({ player: players.get(p.player)?.name ?? p.player, role: p.role, batting: p.batting, bowling: p.bowling, fielding: p.fielding, points: p.points, breakdown: p.breakdown })),
  };
}

// Checks one side's XI: 2–11 distinct members of the team.
function readXI(team, names) {
  if (!Array.isArray(names)) return { error: `Pick ${team.name}'s playing XI.` };
  const keys = names.map(nameKey);
  if (new Set(keys).size !== keys.length) return { error: `${team.name}: a player is listed twice.` };
  if (keys.length < XI_MIN || keys.length > XI_MAX) {
    return { error: `${team.name} needs ${XI_MIN}–${XI_MAX} players in the playing XI (${keys.length} picked).` };
  }
  const outsider = names.find((n) => !isMember(team, nameKey(n)));
  if (outsider) return { error: `${outsider} is not in ${team.name}.` };
  return { keys };
}

// POST /api/matches { team: { name, playingXI }, opponent: { name, playingXI } }
// Any member of `team` can create a match against another team.
router.post('/', async (req, res, next) => {
  try {
    const me = req.player._id;
    const [mine, theirs] = await Promise.all([
      Team.findById(teamKey(req.body?.team?.name ?? '')),
      Team.findById(teamKey(req.body?.opponent?.name ?? '')),
    ]);
    if (!mine) return res.status(404).json({ error: 'Pick your team.' });
    if (!theirs) return res.status(404).json({ error: 'Pick an opponent team.' });
    if (mine._id === theirs._id) return res.status(400).json({ error: 'A team can’t play against itself.' });
    if (!isMember(mine, me)) return res.status(403).json({ error: `You can only create a match for a team you’re in.` });
    for (const t of [mine, theirs]) {
      if (t.inMatch) return res.status(409).json({ error: `${t.name} is already playing a match.` });
    }

    const xiA = readXI(mine, req.body.team.playingXI);
    if (xiA.error) return res.status(400).json({ error: xiA.error });
    const xiB = readXI(theirs, req.body.opponent.playingXI);
    if (xiB.error) return res.status(400).json({ error: xiB.error });

    // A player can only turn out for one side.
    const clash = xiA.keys.find((k) => xiB.keys.includes(k));
    if (clash) {
      const p = await Player.findById(clash, { name: 1 });
      return res.status(400).json({ error: `${p?.name ?? clash} can only play for one team in a match.` });
    }
    // …and only in one match at a time.
    const all = [...xiA.keys, ...xiB.keys];
    const busy = await Match.findOne({ status: { $in: ACTIVE }, 'sides.playingXI': { $in: all } });
    if (busy) {
      const k = busy.sides.flatMap((s) => s.playingXI).find((x) => all.includes(x));
      const p = await Player.findById(k, { name: 1 });
      return res.status(409).json({
        error: `${p?.name ?? k} is already playing in ${busy.sides[0].name} vs ${busy.sides[1].name}.`,
      });
    }

    const playing = new Set(all);
    const bench = (team) => membersOf(team).filter((k) => !playing.has(k));
    const match = await Match.create({
      createdBy: me,
      status: 'toss',
      sides: [
        { team: mine._id, name: mine.name, playingXI: xiA.keys, bench: bench(mine) },
        { team: theirs._id, name: theirs.name, playingXI: xiB.keys, bench: bench(theirs) },
      ],
    });

    // Lock both teams; if either is taken meanwhile, undo and report it.
    const lock = (team) =>
      Team.updateOne(
        { _id: team._id, inMatch: false },
        { inMatch: true, matchStartedAt: match.startedAt, currentMatch: match._id }
      );
    const a = await lock(mine);
    const b = a.modifiedCount ? await lock(theirs) : { modifiedCount: 0 };
    if (!a.modifiedCount || !b.modifiedCount) {
      await Team.updateMany({ currentMatch: match._id }, FREE);
      await Match.deleteOne({ _id: match._id });
      const taken = a.modifiedCount ? theirs : mine;
      return res.status(409).json({ error: `${taken.name} is already playing a match.` });
    }

    res.status(201).json(await view(match, me));
  } catch (err) {
    next(err);
  }
});

const LIST_LIMIT = 50;

// A small "scores so far" card for match lists: each side's score, and a
// status line (toss, chase equation, or the result).
function matchCard(m, name) {
  const sideName = (teamKey) => sideOf(m, teamKey)?.name ?? null;
  const scores = new Map(); // team name -> { runs, wickets, balls }
  let line = null;
  let batting = null;

  if (m.status === 'completed') {
    for (const inn of m.innings ?? []) scores.set(sideName(inn.batting), inn.total);
    line = m.outcome?.text ?? null;
  } else if (m.status === 'toss') {
    line = m.toss?.outcome ? `${sideName(m.toss.winner)} won the toss` : 'Toss coming up';
  } else {
    try {
      const state = replayMatch(m);
      for (const inn of state.innings) {
        if (!inn.needs.includes('openers') || inn.legal) scores.set(sideName(inn.batting), { runs: inn.runs, wickets: inn.wickets, balls: inn.legal });
      }
      const idx = state.current ?? state.innings.length - 1;
      const inn = state.innings[idx];
      batting = state.finished ? null : sideName(inn.batting);
      if (state.finished) line = 'Match over: result coming up';
      else if (idx === 1 && !inn.needs.includes('openers')) {
        const r = rates(state, idx);
        line = `${sideName(inn.batting)} need ${r.need} run${r.need === 1 ? '' : 's'} off ${r.ballsLeft} ball${r.ballsLeft === 1 ? '' : 's'}`;
      } else if (idx === 1) line = `Innings break: ${sideName(inn.batting)} need ${state.target} to win`;
      else line = `${sideName(m.toss.winner)} won the toss and opted to ${m.toss.decision}`;
    } catch {
      line = 'Live';
    }
  }

  return {
    id: m._id,
    status: m.status,
    overs: m.overs,
    createdBy: name(m.createdBy),
    batting,
    teams: m.sides.map((s) => ({ name: s.name, score: scores.get(s.name) ?? null })),
    line,
    winner: m.status === 'completed' ? sideName(m.outcome?.winner) : null,
    startedAt: m.startedAt,
    endedAt: m.endedAt,
  };
}

// GET /api/matches?status=live|completed&limit= — matches anyone can follow:
// in progress (toss or live) and completed, newest first.
router.get('/', async (req, res, next) => {
  const status = req.query.status;
  if (status && !['live', 'completed'].includes(status)) {
    return res.status(400).json({ error: 'status must be live or completed.' });
  }
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), LIST_LIMIT);
  try {
    const filter = { 'sides.0': { $exists: true } }; // two-team matches
    if (status === 'live') filter.status = { $in: ACTIVE };
    else if (status === 'completed') filter.status = 'completed';
    else filter.status = { $in: [...ACTIVE, 'completed'] };
    const matches = await Match.find(filter)
      .sort(status === 'completed' ? { endedAt: -1 } : { startedAt: -1 })
      .limit(limit);
    const players = await playerMap(matches.map((m) => m.createdBy));
    const name = (k) => players.get(k)?.name ?? k;
    res.json(matches.map((m) => matchCard(m, name)));
  } catch (err) {
    next(err);
  }
});

// GET /api/matches/:id — match centre: sides, toss, innings, result, MVP
router.get('/:id', async (req, res, next) => {
  try {
    const match = await loadMatch(req, res);
    if (match) res.json(await view(match, req.player._id));
  } catch (err) {
    next(err);
  }
});

// POST /api/matches/:id/toss { call: 'heads' | 'tails' } — the server flips the coin.
router.post('/:id/toss', async (req, res, next) => {
  try {
    const match = await loadForCreator(req, res, 'call the toss');
    if (!match) return;
    const call = req.body?.call;
    if (!COIN_SIDES.includes(call)) return res.status(400).json({ error: 'Call heads or tails.' });
    if (match.status !== 'toss' || match.toss?.outcome) {
      return res.status(409).json({ error: 'The toss has already happened.' });
    }

    const outcome = COIN_SIDES[crypto.randomInt(2)];
    const [home, away] = match.sides;
    const winner = call === outcome ? home.team : away.team; // the creator calls for their own team
    const updated = await Match.updateOne(
      { _id: match._id, status: 'toss', 'toss.outcome': null },
      { toss: { call, outcome, winner, decision: null, at: new Date() } }
    );
    if (!updated.modifiedCount) return res.status(409).json({ error: 'The toss has already happened.' });
    res.json(await view(await Match.findById(match._id), req.player._id));
  } catch (err) {
    next(err);
  }
});

// POST /api/matches/:id/decision { decision: 'bat' | 'bowl', overs } — toss winner's
// choice and the overs per innings; the match goes live for ball-by-ball scoring.
router.post('/:id/decision', async (req, res, next) => {
  try {
    const match = await loadForCreator(req, res, 'choose to bat or bowl');
    if (!match) return;
    const decision = req.body?.decision;
    if (!TOSS_DECISIONS.includes(decision)) return res.status(400).json({ error: 'Choose bat or bowl.' });
    const overs = Number(req.body?.overs);
    if (!Number.isInteger(overs) || overs < OVERS_MIN || overs > OVERS_MAX) {
      return res.status(400).json({ error: `Overs must be a whole number from ${OVERS_MIN} to ${OVERS_MAX}.` });
    }
    if (!match.toss?.outcome) return res.status(409).json({ error: 'Do the toss first.' });
    if (match.status !== 'toss') return res.status(409).json({ error: 'The match has already started.' });

    const winner = match.toss.winner;
    const battingFirst = decision === 'bat' ? winner : otherSide(match, winner).team;
    const updated = await Match.updateOne(
      { _id: match._id, status: 'toss' },
      { 'toss.decision': decision, battingFirst, overs, log: [], status: 'live', startedAt: new Date() }
    );
    if (!updated.modifiedCount) return res.status(409).json({ error: 'The match has already started.' });
    publish(match._id, { at: 0 });
    res.json(await view(await Match.findById(match._id), req.player._id));
  } catch (err) {
    next(err);
  }
});

// Loads a live match for the scorer and checks the client saw the latest log
// (`at` = number of events it has), so two devices can't score over each other.
async function loadForScoring(req, res) {
  const match = await loadForCreator(req, res, 'score this match');
  if (!match) return null;
  if (match.status !== 'live') {
    res.status(409).json({ error: 'This match isn’t in progress.' });
    return null;
  }
  const at = Number(req.body?.at);
  if (at !== (match.log ?? []).length) {
    res.status(409).json({ error: 'The scorecard changed on another device. Reloading…', stale: true });
    return null;
  }
  return match;
}

// POST /api/matches/:id/events { event, at } — the scorer records one ball or action.
router.post('/:id/events', async (req, res, next) => {
  try {
    const match = await loadForScoring(req, res);
    if (!match) return;
    const log = match.log ?? [];

    let state = replayMatch(match);
    if (state.finished) return res.status(409).json({ error: 'The match is over. Finish it to record the result.' });
    const entry = { inn: state.current, ...readEvent(req.body?.event) };
    try {
      state = replayMatch(match, [...log, entry]);
    } catch (err) {
      if (err instanceof ScoringError) return res.status(400).json({ error: err.message });
      throw err;
    }

    // Append only if nobody else did in the meantime.
    const saved = await Match.updateOne(
      { _id: match._id, status: 'live', log: { $size: log.length } },
      { $push: { log: entry } }
    );
    if (!saved.modifiedCount) {
      return res.status(409).json({ error: 'The scorecard changed on another device. Reloading…', stale: true });
    }
    publish(match._id, { at: log.length + 1 });
    res.json(await view(await Match.findById(match._id), req.player._id));
  } catch (err) {
    next(err);
  }
});

// POST /api/matches/:id/undo { at } — removes the last ball or action.
router.post('/:id/undo', async (req, res, next) => {
  try {
    const match = await loadForScoring(req, res);
    if (!match) return;
    const n = (match.log ?? []).length;
    if (!n) return res.status(409).json({ error: 'Nothing to undo.' });
    const saved = await Match.updateOne({ _id: match._id, status: 'live', log: { $size: n } }, { $pop: { log: 1 } });
    if (!saved.modifiedCount) {
      return res.status(409).json({ error: 'The scorecard changed on another device. Reloading…', stale: true });
    }
    publish(match._id, { at: n - 1 });
    res.json(await view(await Match.findById(match._id), req.player._id));
  } catch (err) {
    next(err);
  }
});

// POST /api/matches/:id/complete { at, noResult? } — records the result once the
// match is over (or as a no-result at any time): scorecard, MVP, stars.
router.post('/:id/complete', async (req, res, next) => {
  try {
    const match = await loadForScoring(req, res);
    if (!match) return;
    const noResult = Boolean(req.body?.noResult);
    const state = replayMatch(match);
    if (!state.finished && !noResult) {
      return res.status(409).json({ error: 'The match isn’t over yet. Keep scoring, or end it as a no result.' });
    }

    const done = await finalizeMatch(match, state, noResult);
    const saved = await Match.updateOne(
      { _id: match._id, status: 'live', log: { $size: (match.log ?? []).length } },
      {
        status: 'completed',
        endedAt: new Date(),
        innings: done.innings,
        performances: done.performances,
        outcome: done.outcome,
        mvp: done.mvp?.player ?? null,
        mvpPoints: done.mvp?.points ?? null,
      }
    );
    if (!saved.modifiedCount) return res.status(409).json({ error: 'This match was already completed.' });

    const everyone = match.sides.flatMap((s) => s.playingXI);
    await Player.bulkWrite([
      { updateMany: { filter: { _id: { $in: everyone } }, update: { $inc: { matchesPlayed: 1 } } } },
      ...(done.mvp ? [{ updateOne: { filter: { _id: done.mvp.player }, update: { $inc: { mvpCount: 1 } } } }] : []),
    ]);
    await Team.updateMany({ currentMatch: match._id }, FREE);
    publish(match._id, { status: 'completed' });
    res.json(await view(await Match.findById(match._id), req.player._id));
  } catch (err) {
    next(err);
  }
});

// GET /api/matches/:id/live — Server-Sent Events: a message after every change.
router.get('/:id/live', async (req, res, next) => {
  try {
    const match = await loadMatch(req, res);
    if (match) watch(match._id, req, res);
  } catch (err) {
    next(err);
  }
});

// POST /api/matches/:id/abandon — cancel a match before it's completed (no stats)
router.post('/:id/abandon', async (req, res, next) => {
  try {
    const match = await loadMatch(req, res);
    if (!match) return;
    const me = req.player._id;
    let allowed = match.createdBy === me;
    if (isLegacy(match)) allowed = (await Team.findById(match.team, { captain: 1 }))?.captain === me;
    if (!allowed) return res.status(403).json({ error: 'Only the player who created this match can abandon it.' });

    const updated = await Match.updateOne(
      { _id: match._id, status: { $in: ACTIVE } },
      { status: 'abandoned', endedAt: new Date() }
    );
    if (!updated.modifiedCount) return res.status(409).json({ error: 'This match is already over.' });
    await Team.updateMany({ currentMatch: match._id }, FREE);
    publish(match._id, { status: 'abandoned' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
