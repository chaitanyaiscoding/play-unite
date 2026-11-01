import { Player, nameKey } from '../models/Player.js';
import { Team, teamKey, isMember } from '../models/Team.js';
import { Match } from '../models/Match.js';
import { XI_MIN, XI_MAX } from '../../../shared/cricket.js';

export const ACTIVE = ['toss', 'live'];
export const FREE = { inMatch: false, matchStartedAt: null, currentMatch: null };
const membersOf = (team) => [team.captain, ...team.players];

// Checks one side's XI: 2–11 distinct members of the team.
function readXI(team, names) {
  if (!Array.isArray(names)) return { error: `Pick ${team.name}'s playing XI.` };
  const keys = names.map(nameKey);
  if (new Set(keys).size !== keys.length) return { error: `${team.name}: a player is listed twice.` };
  if (keys.length < XI_MIN || keys.length > XI_MAX) {
    return { error: `${team.name} needs ${XI_MIN}–${XI_MAX} players in the playing XI (${keys.length} picked).` };
  }
  const outsider = names.find((n) => !isMember(team, nameKey(n)));
  if (outsider) return { error: `${outsider} is not in ${team.name}.` };
  return { keys };
}

const failure = (status, error) => ({ status, error });

// Creates a match from { name, playingXI } sides and locks both teams. Returns
// { match }, or { status, error } when it can't be created. Tournament organisers
// can create matches for teams they aren't in (`requireMembership: false`).
export async function createTwoTeamMatch({ me, team, opponent, requireMembership = true, tournament = null }) {
  const [mine, theirs] = await Promise.all([Team.findById(teamKey(team?.name ?? '')), Team.findById(teamKey(opponent?.name ?? ''))]);
  if (!mine) return failure(404, 'Pick your team.');
  if (!theirs) return failure(404, 'Pick an opponent team.');
  if (mine._id === theirs._id) return failure(400, 'A team can’t play against itself.');
  if (requireMembership && !isMember(mine, me)) return failure(403, 'You can only create a match for a team you’re in.');
  for (const t of [mine, theirs]) {
    if (t.inMatch) return failure(409, `${t.name} is already playing a match.`);
  }

  const xiA = readXI(mine, team.playingXI);
  if (xiA.error) return failure(400, xiA.error);
  const xiB = readXI(theirs, opponent.playingXI);
  if (xiB.error) return failure(400, xiB.error);

  // A player can only turn out for one side.
  const clash = xiA.keys.find((k) => xiB.keys.includes(k));
  if (clash) {
    const p = await Player.findById(clash, { name: 1 });
    return failure(400, `${p?.name ?? clash} can only play for one team in a match.`);
  }
  // …and only in one match at a time.
  const all = [...xiA.keys, ...xiB.keys];
  const busy = await Match.findOne({ status: { $in: ACTIVE }, 'sides.playingXI': { $in: all } });
  if (busy) {
    const k = busy.sides.flatMap((s) => s.playingXI).find((x) => all.includes(x));
    const p = await Player.findById(k, { name: 1 });
    return failure(409, `${p?.name ?? k} is already playing in ${busy.sides[0].name} vs ${busy.sides[1].name}.`);
  }

  const playing = new Set(all);
  const bench = (t) => membersOf(t).filter((k) => !playing.has(k));
  const match = await Match.create({
    createdBy: me,
    status: 'toss',
    tournament,
    sides: [
      { team: mine._id, name: mine.name, playingXI: xiA.keys, bench: bench(mine) },
      { team: theirs._id, name: theirs.name, playingXI: xiB.keys, bench: bench(theirs) },
    ],
  });

  // Lock both teams; if either is taken meanwhile, undo and report it.
  const lock = (t) =>
    Team.updateOne({ _id: t._id, inMatch: false }, { inMatch: true, matchStartedAt: match.startedAt, currentMatch: match._id });
  const a = await lock(mine);
  const b = a.modifiedCount ? await lock(theirs) : { modifiedCount: 0 };
  if (!a.modifiedCount || !b.modifiedCount) {
    await discardMatch(match);
    return failure(409, `${(a.modifiedCount ? theirs : mine).name} is already playing a match.`);
  }
  return { match };
}

// Undoes a match that was only just created: frees its teams and deletes it.
export async function discardMatch(match) {
  await Team.updateMany({ currentMatch: match._id }, FREE);
  await Match.deleteOne({ _id: match._id });
}
