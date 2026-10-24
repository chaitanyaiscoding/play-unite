import { Router } from 'express';
import { Player, nameKey } from '../models/Player.js';
import {
  Team,
  MIN_PLAYERS,
  MAX_PLAYERS,
  cleanTeamName,
  teamKey,
  teamNameError,
  isMember,
  teamStatus,
  effectiveXI,
  benchOf,
  SQUAD_SIZE,
  STATUSES,
} from '../models/Team.js';
import { Match, isLegacy, sideOf, resultFor, opponentFor } from '../models/Match.js';
import { JoinRequest } from '../models/JoinRequest.js';
import { requirePlayer } from '../middleware/currentPlayer.js';
import { levelFor } from '../../../shared/cricket.js';

const router = Router();
router.use(requirePlayer);

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MEMBER_FIELDS = 'name role mvpCount';
const POPULATE = [
  { path: 'captain', select: MEMBER_FIELDS },
  { path: 'players', select: MEMBER_FIELDS },
];
const RECENT_MATCHES = 5;

const member = (p) => ({
  name: p.name,
  role: p.role ?? null,
  mvpCount: p.mvpCount ?? 0,
  stars: levelFor(p.mvpCount).stars,
});

function summary(team, me, pendingTeams) {
  return {
    name: team.name,
    captain: team.captain.name,
    playerCount: team.players.length,
    ...teamStatus(team),
    isMember: isMember(team, me),
    isCaptain: team.captain._id === me,
    requested: pendingTeams.has(team._id),
  };
}

async function detail(team, me) {
  const isCaptain = team.captain._id === me;
  const byKey = new Map([team.captain, ...team.players].map((p) => [p._id, p]));
  const toMembers = (keys) => keys.filter((k) => byKey.has(k)).map((k) => member(byKey.get(k)));

  const xi = effectiveXI(team);
  const [requested, current, recent] = await Promise.all([
    JoinRequest.exists({ team: team._id, player: me, status: 'pending' }),
    team.inMatch && team.currentMatch ? Match.findById(team.currentMatch) : null,
    Match.find({ $or: [{ team: team._id }, { 'sides.team': team._id }], status: 'completed' })
      .sort({ endedAt: -1 })
      .limit(RECENT_MATCHES)
      .populate({ path: 'mvp', select: 'name' }),
  ]);

  const out = {
    name: team.name,
    captain: member(team.captain),
    players: team.players.map(member),
    maxPlayers: MAX_PLAYERS,
    squadTarget: SQUAD_SIZE,
    ...teamStatus(team),
    matchStartedAt: team.matchStartedAt,
    lineup: { picked: Array.isArray(team.playingXI), playingXI: toMembers(xi), bench: toMembers(benchOf(team, xi)) },
    currentMatch: current && {
      id: current._id,
      status: current.status,
      legacy: isLegacy(current),
      opponent: opponentFor(current, team._id),
      startedAt: current.startedAt,
      playingXI: toMembers(isLegacy(current) ? current.playingXI : sideOf(current, team._id).playingXI),
      bench: toMembers(isLegacy(current) ? current.bench : sideOf(current, team._id).bench),
    },
    recentMatches: recent.map((m) => ({
      id: m._id,
      opponent: opponentFor(m, team._id),
      result: resultFor(m, team._id),
      summary: m.outcome?.text ?? null,
      endedAt: m.endedAt,
      mvp: m.mvp ? { name: m.mvp.name, points: m.mvpPoints } : null,
    })),
    isCaptain,
    isMember: isMember(team, me),
    requested: Boolean(requested),
    createdAt: team.createdAt,
  };
  if (isCaptain) {
    const pending = await JoinRequest.find({ team: team._id, status: 'pending' })
      .sort({ createdAt: 1 })
      .populate({ path: 'player', select: 'name' });
    out.requests = pending.map((r) => ({ id: r._id, player: r.player?.name, createdAt: r.createdAt }));
  }
  return out;
}

// Turns a list of player names into existing player keys, excluding the captain.
async function resolvePlayers(names, captainKey) {
  if (!Array.isArray(names)) return { error: 'players must be a list of player names.' };
  const keys = [...new Set(names.map(nameKey))].filter((k) => k && k !== captainKey);
  const found = await Player.find({ _id: { $in: keys } }, { _id: 1 });
  if (found.length !== keys.length) {
    const known = new Set(found.map((p) => p._id));
    return { error: `Unknown player: ${names.find((n) => !known.has(nameKey(n)))}.` };
  }
  return { keys };
}

async function loadTeam(name) {
  return Team.findById(teamKey(name)).populate(POPULATE);
}

// Loads a team for a captain-only action, or answers 404/403 and returns null.
async function loadForCaptain(req, res, action) {
  const team = await Team.findById(teamKey(req.params.name));
  if (!team) {
    res.status(404).json({ error: 'Team not found.' });
    return null;
  }
  if (team.captain !== req.player._id) {
    res.status(403).json({ error: `Only the team captain can ${action}.` });
    return null;
  }
  return team;
}

// GET /api/teams?q=&status= — all teams, optionally filtered by name and status
router.get('/', async (req, res, next) => {
  const status = req.query.status;
  if (status && !STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${STATUSES.join(', ')}.` });
  }
  try {
    const q = cleanTeamName(req.query.q);
    const filter = q ? { name: { $regex: escapeRegex(q), $options: 'i' } } : {};
    const [teams, pending] = await Promise.all([
      Team.find(filter).sort({ name: 1 }).populate({ path: 'captain', select: 'name' }),
      JoinRequest.find({ player: req.player._id, status: 'pending' }, { team: 1 }),
    ]);
    const pendingTeams = new Set(pending.map((r) => r.team));
    const out = teams.map((t) => summary(t, req.player._id, pendingTeams));
    res.json(status ? out.filter((t) => t.status === status) : out);
  } catch (err) {
    next(err);
  }
});

// GET /api/teams/mine — teams the current player captains or plays in
router.get('/mine', async (req, res, next) => {
  try {
    const me = req.player._id;
    const teams = await Team.find({ $or: [{ captain: me }, { players: me }] })
      .sort({ name: 1 })
      .populate({ path: 'captain', select: 'name' });
    res.json(teams.map((t) => summary(t, me, new Set())));
  } catch (err) {
    next(err);
  }
});

// GET /api/teams/availability?name= — is this team name free and valid?
router.get('/availability', async (req, res, next) => {
  const name = cleanTeamName(req.query.name);
  const error = teamNameError(name);
  if (error) return res.json({ name, available: false, error });
  try {
    const taken = await Team.exists({ _id: teamKey(name) });
    res.json({ name, available: !taken, error: taken ? 'That team name is already taken.' : null });
  } catch (err) {
    next(err);
  }
});

// POST /api/teams { name, players: [names] } — create a team; the caller is captain
router.post('/', async (req, res, next) => {
  const name = cleanTeamName(req.body?.name);
  const error = teamNameError(name);
  if (error) return res.status(400).json({ error });

  try {
    const resolved = await resolvePlayers(req.body?.players ?? [], req.player._id);
    if (resolved.error) return res.status(400).json({ error: resolved.error });
    if (resolved.keys.length < MIN_PLAYERS || resolved.keys.length > MAX_PLAYERS) {
      return res.status(400).json({ error: `Add between ${MIN_PLAYERS} and ${MAX_PLAYERS} players.` });
    }

    await Team.create({ _id: teamKey(name), name, captain: req.player._id, players: resolved.keys });
    res.status(201).json(await detail(await loadTeam(name), req.player._id));
  } catch (err) {
    if (err?.code === 11000) return res.status(409).json({ error: 'That team name is already taken.' });
    next(err);
  }
});

// GET /api/teams/:name — team details (captain also gets pending join requests)
router.get('/:name', async (req, res, next) => {
  try {
    const team = await loadTeam(req.params.name);
    if (!team) return res.status(404).json({ error: 'Team not found.' });
    res.json(await detail(team, req.player._id));
  } catch (err) {
    next(err);
  }
});

// POST /api/teams/:name/players { players: [names] } — captain adds players
router.post('/:name/players', async (req, res, next) => {
  try {
    const team = await loadForCaptain(req, res, 'add players');
    if (!team) return;

    const resolved = await resolvePlayers(req.body?.players ?? [], team.captain);
    if (resolved.error) return res.status(400).json({ error: resolved.error });
    const toAdd = resolved.keys.filter((k) => !team.players.includes(k));
    if (!toAdd.length) return res.status(400).json({ error: 'Pick at least one new player.' });
    const spots = MAX_PLAYERS - team.players.length;
    if (toAdd.length > spots) {
      return res.status(400).json({
        error: `A team can have at most ${MAX_PLAYERS} players (${spots} spot${spots === 1 ? '' : 's'} left).`,
      });
    }

    // Guard against concurrent adds pushing the squad past the limit.
    const updated = await Team.updateOne(
      { _id: team._id, [`players.${MAX_PLAYERS - toAdd.length}`]: { $exists: false } },
      { $addToSet: { players: { $each: toAdd } } }
    );
    if (!updated.modifiedCount) return res.status(409).json({ error: 'The team is full.' });

    // Anyone added directly no longer needs their pending request.
    await JoinRequest.updateMany(
      { team: team._id, player: { $in: toAdd }, status: 'pending' },
      { status: 'accepted' }
    );
    res.json(await detail(await loadTeam(team._id), req.player._id));
  } catch (err) {
    next(err);
  }
});

// PUT /api/teams/:name/lineup { playingXI: [names] } — captain saves the team's
// default XI (batting order); it pre-fills the XI when a match is created.
router.put('/:name/lineup', async (req, res, next) => {
  try {
    const team = await loadForCaptain(req, res, 'pick the playing XI');
    if (!team) return;

    const names = req.body?.playingXI;
    if (!Array.isArray(names)) return res.status(400).json({ error: 'playingXI must be a list of player names.' });
    const keys = names.map(nameKey);
    if (new Set(keys).size !== keys.length) return res.status(400).json({ error: 'A player is listed twice.' });
    if (keys.length > SQUAD_SIZE) {
      return res.status(400).json({ error: `A playing XI has at most ${SQUAD_SIZE} players.` });
    }
    const outsider = names.find((n) => !isMember(team, nameKey(n)));
    if (outsider) return res.status(400).json({ error: `${outsider} is not in this team.` });

    team.playingXI = keys;
    await team.save();
    res.json(await detail(await loadTeam(team._id), req.player._id));
  } catch (err) {
    next(err);
  }
});

// POST /api/teams/:name/requests — ask to join; notifies the captain
router.post('/:name/requests', async (req, res, next) => {
  try {
    const team = await Team.findById(teamKey(req.params.name));
    if (!team) return res.status(404).json({ error: 'Team not found.' });
    if (isMember(team, req.player._id)) {
      return res.status(400).json({ error: 'You are already in this team.' });
    }
    if (team.players.length >= MAX_PLAYERS) return res.status(400).json({ error: 'This team is full.' });

    await JoinRequest.create({ team: team._id, player: req.player._id });
    res.status(201).json({ ok: true });
  } catch (err) {
    if (err?.code === 11000) return res.status(409).json({ error: 'You already asked to join this team.' });
    next(err);
  }
});

export default router;
