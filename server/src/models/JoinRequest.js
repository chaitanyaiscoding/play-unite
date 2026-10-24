import mongoose from 'mongoose';

// A player's request to join a team. Pending requests are the captain's
// notifications; decided ones notify the requesting player until seen.
const joinRequestSchema = new mongoose.Schema(
  {
    team: { type: String, ref: 'Team', required: true },
    player: { type: String, ref: 'Player', required: true },
    status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
    seen: { type: Boolean, default: false }, // requester has seen the decision
  },
  { timestamps: true, versionKey: false }
);

// At most one pending request per player per team.
joinRequestSchema.index(
  { team: 1, player: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } }
);
joinRequestSchema.index({ player: 1, status: 1, seen: 1 });

export const JoinRequest = mongoose.model('JoinRequest', joinRequestSchema, 'joinRequests');
