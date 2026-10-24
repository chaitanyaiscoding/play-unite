import { Router } from 'express';
import { Team } from '../models/Team.js';
import { JoinRequest } from '../models/JoinRequest.js';
import { requirePlayer } from '../middleware/currentPlayer.js';

const router = Router();
router.use(requirePlayer);

// GET /api/notifications
//   incoming: pending join requests for teams the current player captains
//   updates:  decisions on the current player's own requests not yet seen
router.get('/', async (req, res, next) => {
  try {
    const me = req.player._id;
    const myTeams = await Team.find({ captain: me }, { _id: 1 });

    const [incoming, updates] = await Promise.all([
      JoinRequest.find({ team: { $in: myTeams.map((t) => t._id) }, status: 'pending' })
        .sort({ createdAt: -1 })
        .populate([
          { path: 'player', select: 'name' },
          { path: 'team', select: 'name' },
        ]),
      JoinRequest.find({ player: me, status: { $ne: 'pending' }, seen: false })
        .sort({ updatedAt: -1 })
        .populate({ path: 'team', select: 'name' }),
    ]);

    res.json({
      incoming: incoming
        .filter((r) => r.player && r.team)
        .map((r) => ({ id: r._id, player: r.player.name, team: r.team.name, createdAt: r.createdAt })),
      updates: updates
        .filter((r) => r.team)
        .map((r) => ({ id: r._id, team: r.team.name, status: r.status, updatedAt: r.updatedAt })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/notifications/seen — dismiss all decision updates
router.post('/seen', async (req, res, next) => {
  try {
    await JoinRequest.updateMany(
      { player: req.player._id, status: { $ne: 'pending' }, seen: false },
      { seen: true }
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
