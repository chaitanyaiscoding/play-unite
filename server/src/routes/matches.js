import crypto from 'node:crypto';
import { Router } from 'express';
import mongoose from 'mongoose';
import { Player, nameKey } from '../models/Player.js';
import { Team, isMember } from '../models/Team.js';
import { Match, isLegacy, sideOf, otherSide } from '../models/Match.js';
import { Tournament, reopenBlocked } from '../models/Tournament.js';
import { requirePlayer } from '../middleware/currentPlayer.js';
import { finalizeMatch, replayMatch } from '../lib/scorecard.js';
import { ACTIVE, FREE, createTwoTeamMatch } from '../lib/matchSetup.js';
import { matchCard } from '../lib/matchCard.js';
import { watch, publish } from '../lib/live.js';
import { COIN_SIDES, TOSS_DECISIONS, dismissalText, levelFor } from '../../../shared/cricket.js';
import { ScoringError, OVERS_MIN, OVERS_MAX, correctBall } from '../../../shared/scoring.js';

const router = Router();
router.use(requirePlayer);

const REOPEN_WINDOW_MS = 24 * 60 * 60 * 1000;

// A finished match can go back to live for a day, to fix its last ball.
const canReopen = (match) =>
  match.status === 'completed' &&
  match.outcome?.type !== 'no_result' &&
  (match.log?.length ?? 0) > 0 &&
  Boolean(match.endedAt) &&
  Date.now() - match.endedAt.getTime() < REOPEN_WINDOW_MS;

const tournamentOf = (match) => (match.tournament ? Tournament.findById(match.tournament) : null);

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
  const tournament = await tournamentOf(match);

  return {
    id: match._id,
    version: 2,
    status: match.status,
    createdBy: name(match.createdBy),
    canControl: match.createdBy === me,
    canReopen: match.createdBy === me && canReopen(match) && !reopenBlocked(match, tournament),
    isParticipant,
    tournament: tournament ? { id: tournament._id, name: tournament.name } : null,
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

// POST /api/matches { team: { name, playingXI }, opponent: { name, playingXI } }
// Any member of `team` can create a match against another team.
router.post('/', async (req, res, next) => {
  try {
    const me = req.player._id;
    const { match, status, error } = await createTwoTeamMatch({ me, team: req.body?.team, opponent: req.body?.opponent });
    if (error) return res.status(status).json({ error });
    res.status(201).json(await view(match, me));
  } catch (err) {
    next(err);
  }
});

const LIST_LIMIT = 50;

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

// Records the result: scorecard, MVP, stars; both teams are free again.
// False if the log changed or the match was completed in the meantime.
async function recordResult(match, state, noResult, logSize) {
  const done = await finalizeMatch(match, state, noResult);
  const saved = await Match.updateOne(
    { _id: match._id, status: 'live', log: { $size: logSize } },
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
  if (!saved.modifiedCount) return false;

  const everyone = match.sides.flatMap((s) => s.playingXI);
  await Player.bulkWrite([
    { updateMany: { filter: { _id: { $in: everyone } }, update: { $inc: { matchesPlayed: 1 } } } },
    ...(done.mvp ? [{ updateOne: { filter: { _id: done.mvp.player }, update: { $inc: { mvpCount: 1 } } } }] : []),
  ]);
  await Team.updateMany({ currentMatch: match._id }, FREE);
  publish(match._id, { status: 'completed' });
  return true;
}

// After the log changed: closes the match if that ended it, and tells followers.
// If closing fails the ball stays saved, and the scorer can still tap Finish match.
async function afterScoring(match, state, logSize) {
  if (state.finished) {
    try {
      if (await recordResult(match, state, false, logSize)) return;
    } catch (err) {
      console.error(err);
    }
  }
  publish(match._id, { at: logSize });
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
    await afterScoring(match, state, log.length + 1);
    res.json(await view(await Match.findById(match._id), req.player._id));
  } catch (err) {
    next(err);
  }
});

// POST /api/matches/:id/correct { index, event, at } — re-records one ball of the
// current innings. Everything scored after it must still make sense.
router.post('/:id/correct', async (req, res, next) => {
  try {
    const match = await loadForScoring(req, res);
    if (!match) return;
    const log = match.log ?? [];
    const index = Number(req.body?.index);
    const old = log[index];
    if (old?.type !== 'ball' || old.inn !== replayMatch(match).current) {
      return res.status(400).json({ error: 'Only a ball from the current innings can be changed.' });
    }
    const event = readEvent(req.body?.event);
    if (event.type !== 'ball') return res.status(400).json({ error: 'A ball can only be changed to another ball.' });

    let fixed;
    let state;
    try {
      fixed = correctBall(log, index, event);
      state = replayMatch(match, fixed);
    } catch (err) {
      if (!(err instanceof ScoringError)) throw err;
      const ballAt = log.slice(0, index).filter((e) => e.inn === old.inn).length;
      const later = err.at && err.at.index !== ballAt;
      return res.status(400).json({
        error: later ? `That change clashes with what was scored after this ball (${err.message}) Undo back to this ball instead.` : err.message,
      });
    }

    const saved = await Match.updateOne({ _id: match._id, status: 'live', log: { $size: log.length } }, { log: fixed });
    if (!saved.modifiedCount) {
      return res.status(409).json({ error: 'The scorecard changed on another device. Reloading…', stale: true });
    }
    await afterScoring(match, state, fixed.length);
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

// POST /api/matches/:id/complete { at, noResult? } — ends the match as a no-result
// at any time, or records the result if closing it automatically didn't go through.
router.post('/:id/complete', async (req, res, next) => {
  try {
    const match = await loadForScoring(req, res);
    if (!match) return;
    const noResult = Boolean(req.body?.noResult);
    const state = replayMatch(match);
    if (!state.finished && !noResult) {
      return res.status(409).json({ error: 'The match isn’t over yet. Keep scoring, or end it as a no result.' });
    }
    if (!(await recordResult(match, state, noResult, (match.log ?? []).length))) {
      return res.status(409).json({ error: 'This match was already completed.' });
    }
    res.json(await view(await Match.findById(match._id), req.player._id));
  } catch (err) {
    next(err);
  }
});

// POST /api/matches/:id/reopen — the final ball was wrong: takes it back and puts
// the match live again, reversing the result and its stats.
router.post('/:id/reopen', async (req, res, next) => {
  try {
    const match = await loadForCreator(req, res, 'reopen this match');
    if (!match) return;
    if (!canReopen(match) || reopenBlocked(match, await tournamentOf(match))) {
      return res.status(409).json({ error: 'This match can no longer be reopened.' });
    }

    const everyone = match.sides.flatMap((s) => s.playingXI);
    const busy = await Match.findOne({ _id: { $ne: match._id }, status: { $in: ACTIVE }, 'sides.playingXI': { $in: everyone } });
    if (busy) {
      const k = busy.sides.flatMap((s) => s.playingXI).find((x) => everyone.includes(x));
      const p = await Player.findById(k, { name: 1 });
      return res.status(409).json({ error: `${p?.name ?? k} is already playing in ${busy.sides[0].name} vs ${busy.sides[1].name}.` });
    }

    for (const side of match.sides) {
      const locked = await Team.updateOne(
        { _id: side.team, inMatch: false },
        { inMatch: true, matchStartedAt: match.startedAt, currentMatch: match._id }
      );
      if (!locked.modifiedCount) {
        await Team.updateMany({ currentMatch: match._id }, FREE);
        return res.status(409).json({ error: `${side.name} is already playing a match.` });
      }
    }

    const saved = await Match.updateOne(
      { _id: match._id, status: 'completed', log: { $size: match.log.length } },
      {
        $pop: { log: 1 },
        $set: {
          status: 'live',
          endedAt: null,
          innings: [],
          performances: [],
          outcome: { winner: null, type: null, margin: null, text: null },
          mvp: null,
          mvpPoints: null,
        },
      }
    );
    if (!saved.modifiedCount) {
      await Team.updateMany({ currentMatch: match._id }, FREE);
      return res.status(409).json({ error: 'This match was already reopened.' });
    }

    await Player.bulkWrite([
      { updateMany: { filter: { _id: { $in: everyone } }, update: { $inc: { matchesPlayed: -1 } } } },
      ...(match.mvp ? [{ updateOne: { filter: { _id: match.mvp }, update: { $inc: { mvpCount: -1 } } } }] : []),
    ]);
    publish(match._id, { at: match.log.length - 1 });
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
