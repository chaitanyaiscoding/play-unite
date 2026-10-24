import mongoose from 'mongoose';
import { ROLE_VALUES, levelFor } from '../../../shared/cricket.js';

export const NAME_MIN = 2;
export const NAME_MAX = 30;
export const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/;

// Collapse inner whitespace so "Virat  Kohli" and "Virat Kohli" are the same name.
export function cleanName(raw) {
  return String(raw ?? '').trim().replace(/\s+/g, ' ');
}

// The primary key: names are unique case-insensitively ("Virat" == "virat").
export function nameKey(name) {
  return cleanName(name).toLowerCase();
}

export function nameError(name) {
  if (name.length < NAME_MIN) return `Name must be at least ${NAME_MIN} characters.`;
  if (name.length > NAME_MAX) return `Name must be at most ${NAME_MAX} characters.`;
  if (!NAME_PATTERN.test(name)) {
    return 'Use letters, numbers, spaces, dots, dashes or underscores, starting with a letter or number.';
  }
  return null;
}

const playerSchema = new mongoose.Schema(
  {
    _id: { type: String }, // normalized name key — the primary key
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: NAME_MIN,
      maxlength: NAME_MAX,
      match: NAME_PATTERN,
    },
    role: { type: String, enum: ROLE_VALUES },
    mvpCount: { type: Number, default: 0 }, // drives the 1–5 star level
    matchesPlayed: { type: Number, default: 0 },
    // PIN that proves a returning player owns this name (scrypt hash, never sent out).
    pinHash: { type: String, select: false },
    pinSalt: { type: String, select: false },
    failedPins: { type: Number, default: 0, select: false },
    lockedUntil: { type: Date, select: false },
  },
  { timestamps: true, versionKey: false }
);

playerSchema.set('toJSON', {
  transform: (_doc, ret) => ({
    name: ret.name,
    role: ret.role ?? null,
    mvpCount: ret.mvpCount ?? 0,
    matchesPlayed: ret.matchesPlayed ?? 0,
    level: levelFor(ret.mvpCount),
    createdAt: ret.createdAt,
  }),
});

export const Player = mongoose.model('Player', playerSchema, 'users');
