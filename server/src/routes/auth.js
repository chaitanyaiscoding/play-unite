import { Router } from 'express';
import { Player, cleanName, nameError, nameKey } from '../models/Player.js';
import {
  PIN_PATTERN,
  MAX_PIN_ATTEMPTS,
  LOCK_MINUTES,
  hashPin,
  verifyPin,
  startSession,
  endSession,
} from '../lib/auth.js';
import { requirePlayer } from '../middleware/currentPlayer.js';
import { ROLES, ROLE_VALUES } from '../../../shared/cricket.js';

const router = Router();
const PIN_ERROR = 'PIN must be exactly 4 digits.';
const SECRET_FIELDS = '+pinHash +pinSalt +failedPins +lockedUntil';
const ROLE_ERROR = `Pick a role: ${ROLES.map((r) => r.label).join(', ')}.`;
const validRole = (role) => ROLE_VALUES.includes(role);

// GET /api/auth/lookup?name= — is this name new, or a returning player?
router.get('/lookup', async (req, res, next) => {
  const name = cleanName(req.query.name);
  const error = nameError(name);
  if (error) return res.status(400).json({ error });
  try {
    const player = await Player.findById(nameKey(name)).select('+pinHash');
    res.json({
      name: player?.name ?? name,
      exists: Boolean(player),
      hasPin: Boolean(player?.pinHash),
      hasRole: Boolean(player?.role),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/register { name, pin, role } — new player; signs this device in
router.post('/register', async (req, res, next) => {
  const name = cleanName(req.body?.name);
  const pin = String(req.body?.pin ?? '');
  const role = req.body?.role;
  const error =
    nameError(name) ?? (PIN_PATTERN.test(pin) ? null : PIN_ERROR) ?? (validRole(role) ? null : ROLE_ERROR);
  if (error) return res.status(400).json({ error });

  try {
    const player = await Player.create({ _id: nameKey(name), name, role, ...(await hashPin(pin)) });
    await startSession(req, res, player._id);
    res.status(201).json({ player });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ error: 'That name is taken. If it’s you, sign in with your PIN.' });
    }
    next(err);
  }
});

// POST /api/auth/login { name, pin, role? } — returning player on any device.
// Players created before PINs existed set their PIN (and role) here the first time.
router.post('/login', async (req, res, next) => {
  const name = cleanName(req.body?.name);
  const pin = String(req.body?.pin ?? '');
  if (!PIN_PATTERN.test(pin)) return res.status(400).json({ error: PIN_ERROR });

  try {
    const key = nameKey(name);
    const player = await Player.findById(key).select(SECRET_FIELDS);
    if (!player) return res.status(404).json({ error: 'No player with that name.' });

    if (player.lockedUntil && player.lockedUntil > new Date()) {
      const mins = Math.ceil((player.lockedUntil - Date.now()) / 60000);
      return res.status(429).json({ error: `Too many wrong PINs. Try again in ${mins} min.` });
    }

    if (!player.pinHash) {
      // Legacy player: claim the name by setting a PIN now.
      Object.assign(player, await hashPin(pin), { failedPins: 0, lockedUntil: null });
      if (validRole(req.body?.role)) player.role = req.body.role;
      await player.save();
      await startSession(req, res, key);
      return res.json({ player, pinSet: true });
    }

    if (!(await verifyPin(pin, player))) {
      const updated = await Player.findByIdAndUpdate(key, { $inc: { failedPins: 1 } }, { new: true }).select(
        SECRET_FIELDS
      );
      if (updated.failedPins >= MAX_PIN_ATTEMPTS) {
        await Player.updateOne(
          { _id: key },
          { failedPins: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60000) }
        );
        return res.status(429).json({ error: `Too many wrong PINs. Try again in ${LOCK_MINUTES} min.` });
      }
      const left = MAX_PIN_ATTEMPTS - updated.failedPins;
      return res.status(401).json({ error: `Wrong PIN. ${left} ${left === 1 ? 'try' : 'tries'} left.` });
    }

    await Player.updateOne({ _id: key }, { failedPins: 0, lockedUntil: null });
    await startSession(req, res, key);
    res.json({ player });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me — the signed-in player for this device
router.get('/me', requirePlayer, (req, res) => res.json({ player: req.player }));

// PATCH /api/auth/me { role } — change your playing role
router.patch('/me', requirePlayer, async (req, res, next) => {
  const role = req.body?.role;
  if (!validRole(role)) return res.status(400).json({ error: ROLE_ERROR });
  try {
    req.player.role = role;
    await req.player.save();
    res.json({ player: req.player });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/logout — sign this device out
router.post('/logout', async (req, res, next) => {
  try {
    await endSession(req, res);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
