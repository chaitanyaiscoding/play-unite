import { Player } from '../models/Player.js';
import { sideOf, otherSide } from '../models/Match.js';
import { buildPerformances, emptyPerformance, matchResult, pickMvp, scorePerformance } from '../../../shared/cricket.js';
import { replay, splitLog, summarize } from '../../../shared/scoring.js';

// The engine's view of a match: overs, who bats first and both XIs.
export const scoringConfig = (match) => ({
  overs: match.overs,
  battingFirst: match.battingFirst,
  sides: match.sides.map((s) => ({ team: s.team, xi: s.playingXI })),
});

// Replays the stored ball log (throws ScoringError if it's invalid).
export const replayMatch = (match, log = match.log ?? []) => replay(scoringConfig(match), splitLog(log));

// Turns a replayed match into the stored scorecard: innings summaries, every
// player's MVP points, the result and the MVP. A no-result has no MVP.
export async function finalizeMatch(match, state, noResult) {
  const first = sideOf(match, match.battingFirst);
  const second = otherSide(match, match.battingFirst);
  const innings = state.innings.filter((inn) => !inn.needs.includes('openers')).map(summarize);

  const allKeys = [...first.playingXI, ...second.playingXI];
  const players = await Player.find({ _id: { $in: allKeys } }, { role: 1 });
  const roleOf = new Map(players.map((p) => [p._id, p.role ?? null]));
  const teamOf = new Map([
    ...first.playingXI.map((k) => [k, first.team]),
    ...second.playingXI.map((k) => [k, second.team]),
  ]);

  const stats = buildPerformances(innings);
  const performances = allKeys.map((key) => {
    const perf = stats.get(key) ?? emptyPerformance();
    const role = roleOf.get(key) ?? null;
    return { player: key, team: teamOf.get(key), role, ...perf, ...scorePerformance(perf, role) };
  });

  const sideName = (teamKey) => (teamKey === first.team ? first.name : second.name);
  const outcome = matchResult(innings, { noResult, sideName });
  const mvp = outcome.type === 'no_result' ? null : pickMvp(performances);
  return { innings, performances, outcome, mvp };
}
