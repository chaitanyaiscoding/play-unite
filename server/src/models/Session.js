import mongoose from 'mongoose';

// A signed-in device. The raw token lives only in the player's httpOnly
// cookie; we store its SHA-256 so a database leak can't be replayed.
const sessionSchema = new mongoose.Schema(
  {
    _id: { type: String }, // sha256(token)
    player: { type: String, ref: 'Player', required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, versionKey: false }
);

sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // MongoDB deletes expired sessions
sessionSchema.index({ player: 1 });

export const Session = mongoose.model('Session', sessionSchema, 'sessions');
