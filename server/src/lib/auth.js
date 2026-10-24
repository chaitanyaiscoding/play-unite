import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { Session } from '../models/Session.js';

const scrypt = promisify(crypto.scrypt);

export const COOKIE = 'pu_session';
export const SESSION_DAYS = 365;
export const PIN_PATTERN = /^\d{4}$/;
export const MAX_PIN_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;

const DAY_MS = 24 * 60 * 60 * 1000;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export async function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = (await scrypt(pin, salt, 32)).toString('hex');
  return { pinHash: hash, pinSalt: salt };
}

export async function verifyPin(pin, { pinHash, pinSalt }) {
  if (!pinHash || !pinSalt) return false;
  const hash = await scrypt(pin, pinSalt, 32);
  return crypto.timingSafeEqual(hash, Buffer.from(pinHash, 'hex'));
}

export function readCookie(req, name) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function setCookie(req, res, value, maxAgeMs) {
  const attrs = [
    `${COOKIE}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  if (req.secure) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

// Starts a session for a player on this device and sets the cookie.
export async function startSession(req, res, playerKey) {
  const token = crypto.randomBytes(32).toString('base64url');
  await Session.create({
    _id: sha256(token),
    player: playerKey,
    expiresAt: new Date(Date.now() + SESSION_DAYS * DAY_MS),
  });
  setCookie(req, res, token, SESSION_DAYS * DAY_MS);
}

// Returns the session for the request's cookie, extending it at most once a day.
export async function findSession(req, res) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const session = await Session.findById(sha256(token));
  if (!session || session.expiresAt < new Date()) return null;

  const renewed = Date.now() + SESSION_DAYS * DAY_MS;
  if (renewed - session.expiresAt.getTime() > DAY_MS) {
    session.expiresAt = new Date(renewed);
    await session.save();
    setCookie(req, res, token, SESSION_DAYS * DAY_MS);
  }
  return session;
}

export async function endSession(req, res) {
  const token = readCookie(req, COOKIE);
  if (token) await Session.deleteOne({ _id: sha256(token) });
  setCookie(req, res, '', 0);
}
