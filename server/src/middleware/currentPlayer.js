import { Player } from '../models/Player.js';
import { findSession } from '../lib/auth.js';

// Identifies the signed-in player from the session cookie.
export async function requirePlayer(req, res, next) {
  try {
    const session = await findSession(req, res);
    const player = session && (await Player.findById(session.player));
    if (!player) return res.status(401).json({ error: 'Please sign in again.' });
    req.player = player;
    next();
  } catch (err) {
    next(err);
  }
}
