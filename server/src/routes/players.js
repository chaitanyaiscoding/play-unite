import { Router } from 'express';
import { Player, nameKey } from '../models/Player.js';
import { Team } from '../models/Team.js';
import { Match, isLegacy, sideOf, resultFor, opponentFor } from '../models/Match.js';
import { requirePlayer } from '../middleware/currentPlayer.js';

// Registration and sign-in live in routes/auth.js.
const router = Router();
router.use(requirePlayer);

const RECENT = 10;

// GET /api/players — all players (for the captain's add-player dropdown)
router.get('/', async (_req, res, next) => {
  try {
    res.json(await Player.find().sort({ _id: 1 }));
  } catch (err) {
    next(err);
  }
});

// GET /api/players/:name — profile: role, star level, teams and recent match points
router.get('/:name', async (req, res, next) => {
  try {
    const key = nameKey(req.params.name);
    const player = await Player.findById(key);
    if (!player) return res.status(404).json({ error: 'Player not found.' });

    const [teams, matches] = await Promise.all([
      Team.find({ $or: [{ captain: key }, { players: key }] }, { name: 1, captain: 1 }).sort({ name: 1 }),
      Match.find({ status: 'completed', 'performances.player': key })
        .sort({ endedAt: -1 })
        .limit(RECENT)
        .populate({ path: 'team', select: 'name' }),
    ]);

    res.json({
      player,
      teams: teams.map((t) => ({ name: t.name, isCaptain: t.captain === key })),
      recentMatches: matches.map((m) => {
        const perf = m.performances.find((p) => p.player === key);
        const teamKey = isLegacy(m) ? m.team?._id : perf?.team;
        return {
          id: m._id,
          team: isLegacy(m) ? (m.team?.name ?? null) : (sideOf(m, teamKey)?.name ?? null),
          opponent: opponentFor(m, teamKey),
          result: resultFor(m, teamKey),
          endedAt: m.endedAt,
          points: perf?.points ?? 0,
          isMvp: m.mvp === key,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
