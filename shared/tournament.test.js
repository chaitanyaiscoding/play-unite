import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addMatchBlocker, bestPlayers, champion, completeBlocker, finalBlocker, resolveEntries, standings } from './tournament.js';

const side = (team) => ({ team, name: team.toUpperCase() });
const match = (id, a, b, winner, extra = {}) => ({
  _id: id,
  status: 'completed',
  sides: [side(a), side(b)],
  outcome: { winner, type: winner ? 'runs' : 'tie' },
  ...extra,
});
const mapOf = (...ms) => new Map(ms.map((m) => [String(m._id), m]));
const entry = (number, m, more = {}) => ({ number, match: m, sources: [], final: false, ...more });
const linked = (number, a, takeA, b, takeB) =>
  entry(number, null, { sources: [{ number: a, take: takeA }, { number: b, take: takeB }] });

const twoPlayed = mapOf(match('m1', 'a', 'b', 'a'), match('m2', 'c', 'd', 'd'));
const twoEntries = [entry(1, 'm1'), entry(2, 'm2')];

test('a connected match takes the winner or loser picked for each side', () => {
  const cases = [
    ['winner', 'winner', ['a', 'd']],
    ['winner', 'loser', ['a', 'c']],
    ['loser', 'winner', ['b', 'd']],
    ['loser', 'loser', ['b', 'c']],
  ];
  for (const [takeA, takeB, want] of cases) {
    const c = resolveEntries([...twoEntries, linked(3, 1, takeA, 2, takeB)], twoPlayed)[2];
    assert.equal(c.state, 'ready');
    assert.deepEqual(c.teams.map((t) => t.team), want);
  }
});

test('a connected match waits until both earlier matches are finished', () => {
  const ms = mapOf(match('m1', 'a', 'b', 'a'), match('m2', 'c', 'd', null, { status: 'live', outcome: {} }));
  const c = resolveEntries([...twoEntries, linked(3, 1, 'winner', 2, 'winner')], ms)[2];
  assert.equal(c.state, 'waiting');
  assert.deepEqual(c.teams.map((t) => t?.team ?? null), ['a', null]);
});

test('a connected match is a no result when an earlier match has no winner', () => {
  for (const other of [
    match('m2', 'c', 'd', null), // tie
    match('m2', 'c', 'd', null, { outcome: { winner: null, type: 'no_result' } }),
    match('m2', 'c', 'd', null, { status: 'abandoned', outcome: {} }),
  ]) {
    const ms = mapOf(match('m1', 'a', 'b', 'a'), other);
    const c = resolveEntries([...twoEntries, linked(3, 1, 'winner', 2, 'loser')], ms)[2];
    assert.equal(c.state, 'no_result');
  }
});

test('a no result carries on down a chain of connected matches', () => {
  const ms = mapOf(match('m1', 'a', 'b', null), match('m2', 'c', 'd', 'c'), match('m5', 'e', 'f', 'e'));
  const chain = [...twoEntries, linked(3, 1, 'winner', 2, 'winner'), entry(4, 'm5'), linked(5, 3, 'winner', 4, 'winner')];
  assert.equal(resolveEntries(chain, ms)[4].state, 'no_result');
});

test('a connected match that would put a team against itself is a no result', () => {
  const ms = mapOf(match('m1', 'a', 'b', 'a'), match('m2', 'a', 'c', 'c'));
  const c = resolveEntries([...twoEntries, linked(3, 1, 'winner', 2, 'loser')], ms)[2];
  assert.equal(c.state, 'no_result');
});

test('a connected match with its match created follows that match', () => {
  const ms = mapOf(match('m1', 'a', 'b', 'a'), match('m2', 'c', 'd', 'd'), match('m3', 'a', 'd', null, { status: 'live', outcome: {} }));
  const c = resolveEntries([...twoEntries, { ...linked(3, 1, 'winner', 2, 'winner'), match: 'm3' }], ms)[2];
  assert.equal(c.state, 'live');
  assert.deepEqual(c.teams.map((t) => t.team), ['a', 'd']);
});

test('the table ranks by wins, counts no results, and skips abandoned matches and the final', () => {
  const ms = mapOf(
    match('m1', 'a', 'b', 'a'),
    match('m2', 'a', 'c', 'a'),
    match('m3', 'b', 'c', 'b'),
    match('m4', 'b', 'c', null),
    match('m5', 'a', 'b', null, { status: 'abandoned', outcome: {} }),
    match('m6', 'a', 'b', 'b')
  );
  const entries = [entry(1, 'm1'), entry(2, 'm2'), entry(3, 'm3'), entry(4, 'm4'), entry(5, 'm5'), entry(6, 'm6', { final: true })];
  const rows = standings(resolveEntries(entries, ms), ms);
  assert.deepEqual(rows, [
    { team: 'a', name: 'A', played: 2, won: 2, lost: 0, noResult: 0 },
    { team: 'b', name: 'B', played: 3, won: 1, lost: 1, noResult: 1 },
    { team: 'c', name: 'C', played: 3, won: 0, lost: 2, noResult: 1 },
  ]);
});

test('teams level on wins follow the organiser order, which never overrules wins', () => {
  const ms = mapOf(match('m1', 'a', 'x', 'a'), match('m2', 'b', 'y', 'b'), match('m3', 'c', 'z', 'c'), match('m4', 'c', 'y', 'c'));
  const res = resolveEntries([entry(1, 'm1'), entry(2, 'm2'), entry(3, 'm3'), entry(4, 'm4')], ms);
  const names = (order) => standings(res, ms, order).slice(0, 3).map((r) => r.team);
  assert.deepEqual(names([]), ['c', 'a', 'b']);
  assert.deepEqual(names(['b', 'a', 'c']), ['c', 'b', 'a']);
});

test('best batsman has the most runs and best bowler the most wickets across matches', () => {
  const perf = (player, runs, balls, wickets, conceded, bowled) => ({
    player,
    batting: { runs, balls },
    bowling: { wickets, runs: conceded, balls: bowled },
  });
  const list = [
    { status: 'completed', performances: [perf('ravi', 40, 30, 0, 0, 0), perf('kiran', 10, 10, 2, 20, 24)] },
    { status: 'completed', performances: [perf('ravi', 30, 20, 1, 5, 6), perf('sam', 60, 50, 2, 8, 12), perf('kiran', 0, 0, 1, 10, 12)] },
    { status: 'live', performances: [perf('sam', 99, 10, 9, 0, 6)] },
  ];
  const best = bestPlayers(list);
  assert.deepEqual(best.batsman, { player: 'ravi', runs: 70, balls: 50 });
  assert.deepEqual(best.bowler, { player: 'kiran', wickets: 3, runs: 30, balls: 36 });
});

test('level batsmen and bowlers are split by fewer balls and fewer runs conceded', () => {
  const perf = (player, runs, balls, wickets, conceded) => ({ player, batting: { runs, balls }, bowling: { wickets, runs: conceded, balls: 6 } });
  const best = bestPlayers([{ status: 'completed', performances: [perf('slow', 20, 30, 1, 20), perf('fast', 20, 10, 1, 5)] }]);
  assert.equal(best.batsman.player, 'fast');
  assert.equal(best.bowler.player, 'fast');
});

test('no awards before anyone has scored or taken a wicket', () => {
  assert.deepEqual(bestPlayers([]), { batsman: null, bowler: null });
});

test('the final waits for every other match and needs two teams in the table', () => {
  const live = mapOf(match('m1', 'a', 'b', 'a'), match('m2', 'c', 'd', null, { status: 'live', outcome: {} }));
  let res = resolveEntries(twoEntries, live);
  assert.match(finalBlocker(res, standings(res, live)), /finish/i);

  const done = mapOf(match('m1', 'a', 'b', 'a'), match('m2', 'c', 'd', 'd'));
  res = resolveEntries([...twoEntries, linked(3, 1, 'winner', 2, 'winner')], done);
  assert.match(finalBlocker(res, standings(res, done)), /finish/i);

  res = resolveEntries(twoEntries, done);
  assert.equal(finalBlocker(res, standings(res, done)), null);
  assert.match(finalBlocker([], []), /two teams/i);
});

test('only one final, unless the last one had no winner', () => {
  const withWinner = mapOf(match('m1', 'a', 'b', 'a'), match('f', 'a', 'b', 'b'));
  const entries = [entry(1, 'm1'), entry(2, 'f', { final: true })];
  let res = resolveEntries(entries, withWinner);
  assert.match(finalBlocker(res, standings(res, withWinner)), /already/i);
  assert.match(addMatchBlocker(res), /final/i);

  const tied = mapOf(match('m1', 'a', 'b', 'a'), match('f', 'a', 'b', null));
  res = resolveEntries(entries, tied);
  assert.equal(finalBlocker(res, standings(res, tied)), null);
  assert.equal(addMatchBlocker(res), null);
});

test('a tournament can only end once nothing is in progress or waiting', () => {
  const live = mapOf(match('m1', 'a', 'b', null, { status: 'live', outcome: {} }));
  assert.match(completeBlocker(resolveEntries([entry(1, 'm1')], live)), /finish/i);
  assert.match(completeBlocker([]), /at least one/i);

  const played = mapOf(match('m1', 'a', 'b', 'a'), match('m2', 'c', 'd', 'd'));
  assert.match(completeBlocker(resolveEntries([...twoEntries, linked(3, 1, 'winner', 2, 'winner')], played)), /finish|remove/i);
  assert.equal(completeBlocker(resolveEntries(twoEntries, played)), null);
});

test('the champion is the final winner, otherwise the top of the table', () => {
  const ms = mapOf(match('m1', 'a', 'b', 'a'), match('f', 'a', 'b', 'b'));
  let res = resolveEntries([entry(1, 'm1'), entry(2, 'f', { final: true })], ms);
  assert.deepEqual(champion(res, standings(res, ms), ms), { team: 'b', name: 'B' });

  res = resolveEntries([entry(1, 'm1')], ms);
  assert.deepEqual(champion(res, standings(res, ms), ms), { team: 'a', name: 'A' });

  const tiedFinal = mapOf(match('m1', 'a', 'b', 'a'), match('f', 'a', 'b', null));
  res = resolveEntries([entry(1, 'm1'), entry(2, 'f', { final: true })], tiedFinal);
  assert.deepEqual(champion(res, standings(res, tiedFinal), tiedFinal), { team: 'a', name: 'A' });
});
