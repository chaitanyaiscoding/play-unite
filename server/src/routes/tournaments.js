import { Router } from 'express';
import mongoose from 'mongoose';
import { Player, cleanName } from '../models/Player.js';
import { teamKey } from '../models/Team.js';
import { Match } from '../models/Match.js';
import { Tournament, TOURNAMENT_NAME_MIN, TOURNAMENT_NAME_MAX } from '../models/Tournament.js';
import { requirePlayer } from '../middleware/currentPlayer.js';
import { ACTIVE, createTwoTeamMatch, discardMatch } from '../lib/matchSetup.js';
import { matchCard } from '../lib/matchCard.js';
import {
  TAKES,
  addMatchBlocker,
  bestPlayers,
  champion,
  completeBlocker,
  finalBlocker,
  resolveEntries,
  standings,
} from '../../../shared/tournament.js';

const router = Router();
router.use(requirePlayer);

const LIST_LIMIT = 100;
const ELIGIBLE_LIMIT = 50;

async function load(req, res) {
  const tournament = mongoose.isValidObjectId(req.params.id) ? await Tournament.findById(req.params.id) : null;
  if (!tournament) res.status(404).json({ error: 'Tournament not found.' });
  return tournament;
}

// Only the organiser changes a tournament, and only while it's running.
async function loadForOrganiser(req, res) {
  const tournament = await load(req, res);
  if (!tournament) return null;
  if (tournament.createdBy !== req.player._id) {
    res.status(403).json({ error: 'Only the organiser can change this tournament.' });
    return null;
  }
  if (tournament.status !== 'running') {
    res.status(409).json({ error: 'This tournament is completed and can’t be changed.' });
    return null;
  }
  return tournament;
}

const matchIdsOf = (tournament) => tournament.entries.filter((e) => e.match).map((e) => e.match);

async function matchesById(tournaments) {
  const matches = await Match.find({ _id: { $in: tournaments.flatMap(matchIdsOf) } });
  return new Map(matches.map((m) => [String(m._id), m]));
}

// Everything worked out from a tournament's matches.
function work(tournament, matches) {
  const resolved = resolveEntries(tournament.entries, matches);
  const rows = standings(resolved, matches, tournament.order);
  const own = matchIdsOf(tournament).map((id) => matches.get(String(id))).filter(Boolean);
  return { resolved, rows, own, best: bestPlayers(own) };
}

async function nameLookup(keys) {
  const players = await Player.find({ _id: { $in: [...new Set(keys.filter(Boolean))] } }, { name: 1 });
  const names = new Map(players.map((p) => [p._id, p.name]));
  return (key) => names.get(key) ?? key;
}

function playerKeys(tournament, { own, best }) {
  return [tournament.createdBy, best.batsman?.player, best.bowler?.player, ...own.flatMap((m) => [m.createdBy, m.mvp])];
}

function awardsView({ best }, name) {
  const named = (award) => {
    if (!award) return null;
    const { player, ...stats } = award;
    return { name: name(player), ...stats };
  };
  return { batsman: named(best.batsman), bowler: named(best.bowler) };
}

const championView = (tournament) => (tournament.champion?.team ? { name: tournament.champion.name } : null);

function detail(tournament, matches, me, name) {
  const done = work(tournament, matches);
  const { resolved, rows } = done;
  const running = tournament.status === 'running';
  const canManage = tournament.createdBy === me && running;
  const fed = new Set(resolved.flatMap((e) => e.sources.map((s) => s.number)));
  const finalProblem = finalBlocker(resolved, rows);

  return {
    id: tournament._id,
    name: tournament.name,
    status: tournament.status,
    organiser: name(tournament.createdBy),
    canManage,
    champion: championView(tournament),
    endedAt: tournament.endedAt,
    entries: resolved.map((e) => {
      const match = e.match ? matches.get(e.match) : null;
      return {
        number: e.number,
        final: e.final,
        state: e.state,
        sources: e.sources,
        teams: e.teams.map((t) => (t ? { name: t.name } : null)),
        removable: canManage && !fed.has(e.number),
        match: match
          ? { ...matchCard(match, name), mvp: match.mvp ? { name: name(match.mvp), points: match.mvpPoints } : null }
          : null,
      };
    }),
    standings: rows.map(({ team, ...row }) => row),
    awards: awardsView(done, name),
    finalTeams: finalProblem ? null : rows.slice(0, 2).map((r) => ({ name: r.name })),
    blockers: {
      add: addMatchBlocker(resolved),
      final: finalProblem,
      complete: completeBlocker(resolved),
    },
  };
}

async function detailOf(id, me) {
  const tournament = await Tournament.findById(id);
  const matches = await matchesById([tournament]);
  const name = await nameLookup(playerKeys(tournament, work(tournament, matches)));
  return detail(tournament, matches, me, name);
}

const nextNumber = (tournament) => Math.max(0, ...tournament.entries.map((e) => e.number)) + 1;

// Adds an entry unless the tournament ended or the number was taken meanwhile.
async function pushEntry(tournament, entry) {
  const saved = await Tournament.updateOne(
    { _id: tournament._id, status: 'running', 'entries.number': { $ne: entry.number } },
    { $push: { entries: entry } }
  );
  return saved.modifiedCount > 0;
}

// GET /api/tournaments — every tournament, newest first; the client splits running and completed.
router.get('/', async (req, res, next) => {
  try {
    const tournaments = await Tournament.find().sort({ createdAt: -1 }).limit(LIST_LIMIT);
    const matches = await matchesById(tournaments);
    const worked = tournaments.map((t) => ({ t, done: work(t, matches) }));
    const name = await nameLookup(worked.flatMap(({ t, done }) => playerKeys(t, done)));
    res.json(
      worked.map(({ t, done }) => ({
        id: t._id,
        name: t.name,
        status: t.status,
        organiser: name(t.createdBy),
        teams: new Set(done.own.flatMap((m) => m.sides.map((s) => s.team))).size,
        total: done.resolved.length,
        played: done.resolved.filter((e) => e.state === 'completed').length,
        live: done.resolved.filter((e) => ACTIVE.includes(e.state)).map((e) => e.teams.map((s) => s.name).join(' vs ')),
        champion: championView(t),
        awards: awardsView(done, name),
      }))
    );
  } catch (err) {
    next(err);
  }
});

// POST /api/tournaments { name } — anyone can organise a tournament.
router.post('/', async (req, res, next) => {
  try {
    const name = cleanName(req.body?.name ?? '');
    if (name.length < TOURNAMENT_NAME_MIN || name.length > TOURNAMENT_NAME_MAX) {
      return res.status(400).json({ error: `Tournament name must be ${TOURNAMENT_NAME_MIN}–${TOURNAMENT_NAME_MAX} characters.` });
    }
    const tournament = await Tournament.create({ name, createdBy: req.player._id });
    res.status(201).json(await detailOf(tournament._id, req.player._id));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const tournament = await load(req, res);
    if (tournament) res.json(await detailOf(tournament._id, req.player._id));
  } catch (err) {
    next(err);
  }
});

// GET /api/tournaments/:id/eligible — running or completed matches in no tournament.
router.get('/:id/eligible', async (req, res, next) => {
  try {
    const tournament = await load(req, res);
    if (!tournament) return;
    const matches = await Match.find({
      'sides.0': { $exists: true },
      status: { $in: [...ACTIVE, 'completed'] },
      tournament: null,
    })
      .sort({ startedAt: -1 })
      .limit(ELIGIBLE_LIMIT);
    const name = await nameLookup(matches.map((m) => m.createdBy));
    res.json(matches.map((m) => matchCard(m, name)));
  } catch (err) {
    next(err);
  }
});

const sameTeams = (a, b) => {
  const keys = (list) => list.map((t) => teamKey(t?.name ?? '')).sort().join('|');
  return keys(a) === keys(b);
};

// POST /api/tournaments/:id/matches { team, opponent, entry?, final? } — the
// organiser creates a match, for any two teams. `entry` starts a connected match
// whose teams are known; `final` creates the final between the top two.
router.post('/:id/matches', async (req, res, next) => {
  try {
    const tournament = await loadForOrganiser(req, res);
    if (!tournament) return;
    const me = req.player._id;
    const { team, opponent } = req.body ?? {};
    const entryNumber = req.body?.entry == null ? null : Number(req.body.entry);
    const isFinal = Boolean(req.body?.final);

    const matches = await matchesById([tournament]);
    const { resolved, rows } = work(tournament, matches);

    let expected = null;
    if (entryNumber != null) {
      const entry = resolved.find((e) => e.number === entryNumber);
      if (!entry) return res.status(404).json({ error: 'That match isn’t in this tournament.' });
      if (entry.state !== 'ready') return res.status(409).json({ error: 'This match’s teams aren’t ready yet.' });
      expected = entry.teams;
    } else if (isFinal) {
      const problem = finalBlocker(resolved, rows);
      if (problem) return res.status(409).json({ error: problem });
      expected = rows.slice(0, 2);
    } else {
      const problem = addMatchBlocker(resolved);
      if (problem) return res.status(409).json({ error: problem });
    }
    if (expected && !sameTeams(expected, [team, opponent])) {
      return res.status(400).json({ error: `This match is ${expected.map((t) => t.name).join(' vs ')}.` });
    }

    const created = await createTwoTeamMatch({ me, team, opponent, requireMembership: false, tournament: tournament._id });
    if (created.error) return res.status(created.status).json({ error: created.error });

    let attached;
    if (entryNumber != null) {
      const saved = await Tournament.updateOne(
        { _id: tournament._id, status: 'running', entries: { $elemMatch: { number: entryNumber, match: null } } },
        { $set: { 'entries.$.match': created.match._id } }
      );
      attached = saved.modifiedCount > 0;
    } else {
      attached = await pushEntry(tournament, { number: nextNumber(tournament), match: created.match._id, final: isFinal });
    }
    if (!attached) {
      await discardMatch(created.match);
      return res.status(409).json({ error: 'The tournament changed on another device. Reload and try again.' });
    }
    res.json(await detailOf(tournament._id, me));
  } catch (err) {
    next(err);
  }
});

// POST /api/tournaments/:id/matches/existing { match } — brings in a running or
// completed match. A match belongs to one tournament, and keeps its own scorer.
router.post('/:id/matches/existing', async (req, res, next) => {
  try {
    const tournament = await loadForOrganiser(req, res);
    if (!tournament) return;
    const id = req.body?.match;
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ error: 'Match not found.' });

    const problem = addMatchBlocker(resolveEntries(tournament.entries, await matchesById([tournament])));
    if (problem) return res.status(409).json({ error: problem });

    const claimed = await Match.updateOne(
      { _id: id, 'sides.0': { $exists: true }, status: { $in: [...ACTIVE, 'completed'] }, tournament: null },
      { tournament: tournament._id }
    );
    if (!claimed.modifiedCount) {
      return res.status(409).json({ error: 'That match can’t be added: it’s already in a tournament, or it was abandoned.' });
    }
    if (!(await pushEntry(tournament, { number: nextNumber(tournament), match: id }))) {
      await Match.updateOne({ _id: id }, { tournament: null });
      return res.status(409).json({ error: 'The tournament changed on another device. Reload and try again.' });
    }
    res.json(await detailOf(tournament._id, req.player._id));
  } catch (err) {
    next(err);
  }
});

// POST /api/tournaments/:id/connected { sources: [{ number, take }, { number, take }] }
// A match whose teams are the winner or loser of two earlier matches.
router.post('/:id/connected', async (req, res, next) => {
  try {
    const tournament = await loadForOrganiser(req, res);
    if (!tournament) return;
    const sources = req.body?.sources;
    const usable = (s) => TAKES.includes(s?.take) && tournament.entries.some((e) => e.number === s?.number && !e.final);
    if (!Array.isArray(sources) || sources.length !== 2 || !sources.every(usable) || sources[0].number === sources[1].number) {
      return res.status(400).json({ error: 'Pick two different earlier matches, and the winner or loser of each.' });
    }
    const problem = addMatchBlocker(resolveEntries(tournament.entries, await matchesById([tournament])));
    if (problem) return res.status(409).json({ error: problem });

    const entry = {
      number: nextNumber(tournament),
      sources: sources.map((s) => ({ number: s.number, take: s.take })),
    };
    if (!(await pushEntry(tournament, entry))) {
      return res.status(409).json({ error: 'The tournament changed on another device. Reload and try again.' });
    }
    res.json(await detailOf(tournament._id, req.player._id));
  } catch (err) {
    next(err);
  }
});

// PUT /api/tournaments/:id/order { teams: [names] } — the organiser's order for
// teams level on wins. Wins always come first.
router.put('/:id/order', async (req, res, next) => {
  try {
    const tournament = await loadForOrganiser(req, res);
    if (!tournament) return;
    const teams = req.body?.teams;
    if (!Array.isArray(teams)) return res.status(400).json({ error: 'Send the teams in their new order.' });
    const { rows } = work(tournament, await matchesById([tournament]));
    const known = new Set(rows.map((r) => r.team));
    const order = teams.map((n) => teamKey(String(n)));
    if (!order.every((k) => known.has(k))) return res.status(400).json({ error: 'That team isn’t in this tournament’s table.' });

    await Tournament.updateOne({ _id: tournament._id, status: 'running' }, { order });
    res.json(await detailOf(tournament._id, req.player._id));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/tournaments/:id/entries/:number — takes a match out of the
// tournament. The match itself is kept; it just stops counting here.
router.delete('/:id/entries/:number', async (req, res, next) => {
  try {
    const tournament = await loadForOrganiser(req, res);
    if (!tournament) return;
    const number = Number(req.params.number);
    const entry = tournament.entries.find((e) => e.number === number);
    if (!entry) return res.status(404).json({ error: 'That match isn’t in this tournament.' });
    if (tournament.entries.some((e) => e.sources.some((s) => s.number === number))) {
      return res.status(409).json({ error: 'A connected match depends on this one. Remove that first.' });
    }
    await Tournament.updateOne({ _id: tournament._id, status: 'running' }, { $pull: { entries: { number } } });
    if (entry.match) await Match.updateOne({ _id: entry.match, tournament: tournament._id }, { tournament: null });
    res.json(await detailOf(tournament._id, req.player._id));
  } catch (err) {
    next(err);
  }
});

// POST /api/tournaments/:id/complete — ends it for good and records the champion.
router.post('/:id/complete', async (req, res, next) => {
  try {
    const tournament = await loadForOrganiser(req, res);
    if (!tournament) return;
    const { resolved, rows } = work(tournament, await matchesById([tournament]));
    const problem = completeBlocker(resolved);
    if (problem) return res.status(409).json({ error: problem });

    const saved = await Tournament.updateOne(
      { _id: tournament._id, status: 'running' },
      { status: 'completed', champion: champion(resolved, rows), endedAt: new Date() }
    );
    if (!saved.modifiedCount) return res.status(409).json({ error: 'This tournament is already completed.' });
    res.json(await detailOf(tournament._id, req.player._id));
  } catch (err) {
    next(err);
  }
});

export default router;
