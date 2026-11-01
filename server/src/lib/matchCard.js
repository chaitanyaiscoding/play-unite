import { sideOf } from '../models/Match.js';
import { replayMatch } from './scorecard.js';
import { rates } from '../../../shared/scoring.js';

// A small "scores so far" card for match lists: each side's score, and a
// status line (toss, chase equation, or the result).
export function matchCard(m, name) {
  const sideName = (teamKey) => sideOf(m, teamKey)?.name ?? null;
  const scores = new Map(); // team name -> { runs, wickets, balls }
  let line = null;
  let batting = null;

  if (m.status === 'completed') {
    for (const inn of m.innings ?? []) scores.set(sideName(inn.batting), inn.total);
    line = m.outcome?.text ?? null;
  } else if (m.status === 'abandoned') {
    line = 'Abandoned';
  } else if (m.status === 'toss') {
    line = m.toss?.outcome ? `${sideName(m.toss.winner)} won the toss` : 'Toss coming up';
  } else {
    try {
      const state = replayMatch(m);
      for (const inn of state.innings) {
        if (!inn.needs.includes('openers') || inn.legal) scores.set(sideName(inn.batting), { runs: inn.runs, wickets: inn.wickets, balls: inn.legal });
      }
      const idx = state.current ?? state.innings.length - 1;
      const inn = state.innings[idx];
      batting = state.finished ? null : sideName(inn.batting);
      if (state.finished) line = 'Match over: result coming up';
      else if (idx === 1 && !inn.needs.includes('openers')) {
        const r = rates(state, idx);
        line = `${sideName(inn.batting)} need ${r.need} run${r.need === 1 ? '' : 's'} off ${r.ballsLeft} ball${r.ballsLeft === 1 ? '' : 's'}`;
      } else if (idx === 1) line = `Innings break: ${sideName(inn.batting)} need ${state.target} to win`;
      else line = `${sideName(m.toss.winner)} won the toss and opted to ${m.toss.decision}`;
    } catch {
      line = 'Live';
    }
  }

  return {
    id: m._id,
    status: m.status,
    overs: m.overs,
    createdBy: name(m.createdBy),
    batting,
    teams: m.sides.map((s) => ({ name: s.name, score: scores.get(s.name) ?? null })),
    line,
    winner: m.status === 'completed' ? sideName(m.outcome?.winner) : null,
    startedAt: m.startedAt,
    endedAt: m.endedAt,
  };
}
