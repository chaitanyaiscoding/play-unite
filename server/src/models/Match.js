import mongoose from 'mongoose';
import { RESULT_VALUES, DISMISSAL_VALUES, COIN_SIDES, TOSS_DECISIONS } from '../../../shared/cricket.js';

const num = { type: Number, default: 0, min: 0 };

const performanceSchema = new mongoose.Schema(
  {
    player: { type: String, ref: 'Player', required: true },
    team: { type: String, default: null }, // side the player played for
    role: { type: String, default: null }, // role at the time of the match
    batting: { runs: num, balls: num, fours: num, sixes: num, out: { type: Boolean, default: false } },
    bowling: { balls: num, runs: num, wickets: num, maidens: num, dots: num },
    fielding: { catches: num, stumpings: num, runOuts: num },
    points: { type: Number, default: 0 },
    breakdown: [{ _id: false, label: String, points: Number }],
  },
  { _id: false }
);

const sideSchema = new mongoose.Schema(
  {
    team: { type: String, ref: 'Team', required: true },
    name: { type: String, required: true }, // display name at match time
    playingXI: [{ type: String, ref: 'Player' }],
    bench: [{ type: String, ref: 'Player' }],
  },
  { _id: false }
);

const inningsSchema = new mongoose.Schema(
  {
    batting: { type: String, required: true }, // team key
    bowling: { type: String, required: true },
    batters: [
      {
        _id: false,
        player: String,
        runs: num,
        balls: num,
        fours: num,
        sixes: num,
        how: { type: String, enum: DISMISSAL_VALUES, default: 'dnb' },
        bowler: { type: String, default: null },
        fielder: { type: String, default: null },
      },
    ],
    extras: { wides: num, noBalls: num, byes: num, legByes: num },
    bowlers: [{ _id: false, player: String, balls: num, runs: num, maidens: num, dots: num }],
    total: { runs: num, wickets: num, balls: num },
    fow: [{ _id: false, score: Number, wicket: Number, over: String, player: String }],
  },
  { _id: false }
);

// A match between two teams: sides (XI + bench) -> toss -> two innings -> result.
// Matches created before two-team matches have `team`/`opponent`/`playingXI`
// instead of `sides`; they are read-only history.
const matchSchema = new mongoose.Schema(
  {
    createdBy: { type: String, ref: 'Player', default: null },
    sides: { type: [sideSchema], default: undefined },
    status: { type: String, enum: ['toss', 'live', 'completed', 'abandoned'], default: 'toss' },
    toss: {
      call: { type: String, enum: [...COIN_SIDES, null], default: null },
      outcome: { type: String, enum: [...COIN_SIDES, null], default: null },
      winner: { type: String, default: null },
      decision: { type: String, enum: [...TOSS_DECISIONS, null], default: null },
      at: { type: Date, default: null },
    },
    battingFirst: { type: String, default: null },
    overs: { type: Number, default: null }, // overs per innings, set with the toss decision
    // Ball-by-ball log: { inn: 0 | 1, type, ... } events (see shared/scoring.js).
    log: { type: [mongoose.Schema.Types.Mixed], default: undefined },
    innings: { type: [inningsSchema], default: undefined },
    outcome: {
      winner: { type: String, default: null },
      type: { type: String, default: null },
      margin: { type: Number, default: null },
      text: { type: String, default: null },
    },
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date, default: null },
    performances: [performanceSchema],
    mvp: { type: String, ref: 'Player', default: null },
    mvpPoints: { type: Number, default: null },

    // Legacy single-team matches
    team: { type: String, ref: 'Team' },
    opponent: { type: String, trim: true, maxlength: 40 },
    playingXI: { type: [{ type: String, ref: 'Player' }], default: undefined },
    bench: { type: [{ type: String, ref: 'Player' }], default: undefined },
    result: { type: String, enum: [...RESULT_VALUES, null], default: null },
  },
  { timestamps: true, versionKey: false }
);

matchSchema.index({ 'sides.team': 1, endedAt: -1 });
matchSchema.index({ status: 1, 'sides.playingXI': 1 });
matchSchema.index({ team: 1, endedAt: -1 });
matchSchema.index({ 'performances.player': 1, endedAt: -1 });

export const isLegacy = (m) => !m.sides?.length;
const id = (v) => (v && typeof v === 'object' ? v._id : v);
export const sideOf = (m, teamKey) => m.sides?.find((s) => id(s.team) === teamKey) ?? null;
export const otherSide = (m, teamKey) => m.sides?.find((s) => id(s.team) !== teamKey) ?? null;

// Result from one team's point of view: won | lost | tied | no_result.
export function resultFor(m, teamKey) {
  if (isLegacy(m)) return m.result;
  const t = m.outcome?.type;
  if (t === 'tie') return 'tied';
  if (!m.outcome?.winner) return 'no_result';
  return m.outcome.winner === teamKey ? 'won' : 'lost';
}

export const opponentFor = (m, teamKey) => (isLegacy(m) ? m.opponent || '' : (otherSide(m, teamKey)?.name ?? ''));

export const Match = mongoose.model('Match', matchSchema, 'matches');
