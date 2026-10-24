import mongoose from 'mongoose';
import { cleanName } from './Player.js';

export const TEAM_NAME_MIN = 2;
export const TEAM_NAME_MAX = 30;
export const TEAM_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._'-]*$/;
// Players the captain adds (the captain is a member on top of these).
export const MIN_PLAYERS = 1;
export const MAX_PLAYERS = 15;
// Players needed to take the field (captain included).
export const SQUAD_SIZE = 11;
export const STATUSES = ['in_match', 'needs_players', 'idle'];

export const cleanTeamName = cleanName;

// The primary key: team names are unique case-insensitively.
export function teamKey(name) {
  return cleanTeamName(name).toLowerCase();
}

export function teamNameError(name) {
  if (name.length < TEAM_NAME_MIN) return `Team name must be at least ${TEAM_NAME_MIN} characters.`;
  if (name.length > TEAM_NAME_MAX) return `Team name must be at most ${TEAM_NAME_MAX} characters.`;
  if (!TEAM_NAME_PATTERN.test(name)) {
    return "Use letters, numbers, spaces, dots, dashes, apostrophes or underscores, starting with a letter or number.";
  }
  return null;
}

const teamSchema = new mongoose.Schema(
  {
    _id: { type: String }, // normalized team name key — the primary key
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: TEAM_NAME_MIN,
      maxlength: TEAM_NAME_MAX,
      match: TEAM_NAME_PATTERN,
    },
    captain: { type: String, ref: 'Player', required: true }, // player key of the creator
    players: {
      type: [{ type: String, ref: 'Player' }],
      validate: {
        validator: (v) => v.length >= MIN_PLAYERS && v.length <= MAX_PLAYERS,
        message: `A team needs ${MIN_PLAYERS}–${MAX_PLAYERS} players besides the captain.`,
      },
    },
    inMatch: { type: Boolean, default: false },
    matchStartedAt: { type: Date, default: null },
    currentMatch: { type: mongoose.Schema.Types.ObjectId, ref: 'Match', default: null },
    // Captain's chosen playing XI in batting order (null = never picked).
    playingXI: { type: [{ type: String, ref: 'Player' }], default: null },
  },
  { timestamps: true, versionKey: false }
);

// "Which teams am I in?" — one player can be in many teams.
teamSchema.index({ players: 1 });
teamSchema.index({ captain: 1 });

export function isMember(team, playerKey) {
  const id = (p) => (typeof p === 'string' ? p : p._id);
  return id(team.captain) === playerKey || team.players.some((p) => id(p) === playerKey);
}

export const squadSize = (team) => team.players.length + 1; // + captain

const memberIds = (team) => [team.captain, ...team.players].map((p) => (typeof p === 'string' ? p : p._id));

// The XI that will take the field: the captain's pick (minus anyone who left),
// or the first 11 members if the captain hasn't picked one yet.
export function effectiveXI(team) {
  const members = memberIds(team);
  if (!team.playingXI) return members.slice(0, SQUAD_SIZE);
  const set = new Set(members);
  return team.playingXI.map((p) => (typeof p === 'string' ? p : p._id)).filter((k) => set.has(k));
}

export function benchOf(team, xi = effectiveXI(team)) {
  const picked = new Set(xi);
  return memberIds(team).filter((k) => !picked.has(k));
}

// in_match while a match is on; otherwise needs_players below 11, else idle.
export function teamStatus(team) {
  const size = squadSize(team);
  if (team.inMatch) return { status: 'in_match', size, playersNeeded: 0 };
  if (size < SQUAD_SIZE) return { status: 'needs_players', size, playersNeeded: SQUAD_SIZE - size };
  return { status: 'idle', size, playersNeeded: 0 };
}

export const Team = mongoose.model('Team', teamSchema, 'teams');
