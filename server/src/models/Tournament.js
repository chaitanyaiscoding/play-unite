import mongoose from 'mongoose';
import { TAKES } from '../../../shared/tournament.js';

export const TOURNAMENT_NAME_MIN = 2;
export const TOURNAMENT_NAME_MAX = 40;

// One numbered match slot. A plain or brought-in match has `match` from the
// start; a connected one has `sources` and gets `match` once its teams are known.
const entrySchema = new mongoose.Schema(
  {
    number: { type: Number, required: true },
    match: { type: mongoose.Schema.Types.ObjectId, ref: 'Match', default: null },
    sources: {
      type: [{ _id: false, number: { type: Number, required: true }, take: { type: String, enum: TAKES, required: true } }],
      default: [],
    },
    final: { type: Boolean, default: false },
  },
  { _id: false }
);

const tournamentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: TOURNAMENT_NAME_MIN, maxlength: TOURNAMENT_NAME_MAX },
    createdBy: { type: String, ref: 'Player', required: true }, // the organiser
    status: { type: String, enum: ['running', 'completed'], default: 'running' },
    entries: { type: [entrySchema], default: [] },
    order: { type: [String], default: [] }, // organiser's order for teams level on wins
    champion: { team: { type: String, default: null }, name: { type: String, default: null } },
    endedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false }
);

tournamentSchema.index({ status: 1, createdAt: -1 });

// A finished match can't go back to live if that would change something already
// settled: a completed tournament, a connected match it fed, or the final.
export function reopenBlocked(match, tournament) {
  if (!tournament) return false;
  if (tournament.status === 'completed') return true;
  const entry = tournament.entries.find((e) => String(e.match) === String(match._id));
  if (!entry) return false;
  return tournament.entries.some(
    (e) => e.match && e.number !== entry.number && (e.final || e.sources.some((s) => s.number === entry.number))
  );
}

export const Tournament = mongoose.model('Tournament', tournamentSchema, 'tournaments');
