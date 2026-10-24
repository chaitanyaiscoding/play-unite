import { Router } from 'express';
import mongoose from 'mongoose';
import { Team, MAX_PLAYERS } from '../models/Team.js';
import { JoinRequest } from '../models/JoinRequest.js';
import { requirePlayer } from '../middleware/currentPlayer.js';

const router = Router();
router.use(requirePlayer);

// Loads a pending request that the current player (as captain) may decide on.
async function loadForCaptain(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(404).json({ error: 'Request not found.' });
    return null;
  }
  const request = await JoinRequest.findById(req.params.id);
  const team = request && (await Team.findById(request.team));
  if (!request || !team) {
    res.status(404).json({ error: 'Request not found.' });
    return null;
  }
  if (team.captain !== req.player._id) {
    res.status(403).json({ error: 'Only the team captain can respond to join requests.' });
    return null;
  }
  if (request.status !== 'pending') {
    res.status(409).json({ error: `This request was already ${request.status}.` });
    return null;
  }
  return { request, team };
}

// POST /api/requests/:id/accept — captain accepts; the player joins the team
router.post('/:id/accept', async (req, res, next) => {
  try {
    const found = await loadForCaptain(req, res);
    if (!found) return;
    const { request, team } = found;

    if (!team.players.includes(request.player)) {
      const updated = await Team.updateOne(
        { _id: team._id, [`players.${MAX_PLAYERS - 1}`]: { $exists: false } },
        { $addToSet: { players: request.player } }
      );
      if (!updated.modifiedCount) {
        return res.status(409).json({ error: `The team is full (${MAX_PLAYERS} players).` });
      }
    }
    request.status = 'accepted';
    await request.save();
    res.json({ ok: true, status: request.status });
  } catch (err) {
    next(err);
  }
});

// POST /api/requests/:id/reject — captain rejects the request
router.post('/:id/reject', async (req, res, next) => {
  try {
    const found = await loadForCaptain(req, res);
    if (!found) return;
    found.request.status = 'rejected';
    await found.request.save();
    res.json({ ok: true, status: found.request.status });
  } catch (err) {
    next(err);
  }
});

export default router;
