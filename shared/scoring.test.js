import assert from 'node:assert/strict';
import { test } from 'node:test';
import { correctBall, lastOverBalls, replay, splitLog } from './scoring.js';

const config = {
  overs: 5,
  battingFirst: 'A',
  sides: [
    { team: 'A', xi: ['a1', 'a2', 'a3', 'a4'] },
    { team: 'B', xi: ['b1', 'b2', 'b3', 'b4'] },
  ],
};
const start = { inn: 0, type: 'start', striker: 'a1', nonStriker: 'a2', bowler: 'b1' };
const ball = (runs, extra = null, wicket = null) => ({ inn: 0, type: 'ball', runs, extra, wicket });
const inningsOf = (log) => replay(config, splitLog(log)).innings[0];

test('correcting the last ball of an over updates the score and keeps the bowler prompt', () => {
  const log = [start, ball(0), ball(0), ball(0), ball(0), ball(0), ball(6)];
  const inn = inningsOf(correctBall(log, 6, { type: 'ball', runs: 4, extra: null }));
  assert.equal(inn.runs, 4);
  assert.equal(inn.batters.a1.sixes, 0);
  assert.equal(inn.batters.a1.fours, 1);
  assert.deepEqual(inn.needs, ['bowler']);
});

test('correcting a ball to an odd number re-works the strike for the next over', () => {
  const log = [start, ball(0), ball(0), ball(0), ball(0), ball(0), ball(2)];
  const inn = inningsOf(correctBall(log, 6, { type: 'ball', runs: 1, extra: null }));
  assert.equal(inn.striker, 'a1'); // crossed on the single, then changed ends for the over
});

test('correcting the last ball to a wide re-opens the over', () => {
  const log = [start, ball(0), ball(0), ball(0), ball(0), ball(0), ball(1)];
  const inn = inningsOf(correctBall(log, 6, { type: 'ball', runs: 0, extra: 'wide' }));
  assert.equal(inn.legal, 5);
  assert.deepEqual(inn.needs, []);
  assert.equal(inn.bowler, 'b1');
});

test('removing a wicket also removes the new batter who came in for it', () => {
  const out = { how: 'bowled' };
  const log = [start, ball(0), ball(0), ball(0), ball(0), ball(0), ball(0, null, out), { inn: 0, type: 'batter', player: 'a3' }];
  const fixed = correctBall(log, 6, { type: 'ball', runs: 2, extra: null });
  assert.equal(fixed.length, log.length - 1);
  const inn = inningsOf(fixed);
  assert.equal(inn.wickets, 0);
  assert.equal(inn.batters.a3, undefined);
  assert.deepEqual(inn.needs, ['bowler']);
});

test('adding a wicket to the last ball asks for the new batter', () => {
  const log = [start, ball(0), ball(0), ball(0), ball(0), ball(0), ball(1)];
  const inn = inningsOf(correctBall(log, 6, { type: 'ball', runs: 0, extra: null, wicket: { how: 'bowled' } }));
  assert.equal(inn.wickets, 1);
  assert.deepEqual(inn.needs, ['batter', 'bowler']);
});

test('the corrected ball stays in its innings', () => {
  const log = [start, ball(1)];
  assert.equal(correctBall(log, 1, { type: 'ball', runs: 2, extra: null })[1].inn, 0);
});

test('correcting does not change the original log', () => {
  const log = [start, ball(1)];
  correctBall(log, 1, { type: 'ball', runs: 2, extra: null });
  assert.equal(log[1].runs, 1);
});

test('only a ball can be corrected', () => {
  assert.throws(() => correctBall([start, ball(1)], 0, { type: 'ball', runs: 2, extra: null }), /Only a ball/);
});

test('lastOverBalls lists the finished over with each ball\'s position in the log', () => {
  const log = [
    start,
    ball(1), ball(0), ball(0), ball(0), ball(0), ball(0), // over 1
    { inn: 0, type: 'bowler', bowler: 'b2' },
    ball(0, 'wide'), ball(1), { inn: 0, type: 'swap' }, ball(2), ball(0, 'noball'), ball(3), ball(4), ball(6), ball(0), // over 2
  ];
  const balls = lastOverBalls(log, inningsOf(log), 0);
  assert.deepEqual(balls.map((b) => b.index), [8, 9, 11, 12, 13, 14, 15, 16]);
  assert.deepEqual(balls.map((b) => b.label), ['Wd', '1', '2', 'Nb', '3', '4', '6', '•']);
  assert.equal(balls[0].over, '1.1');
  assert.equal(balls[0].bowler, 'b2');
});
