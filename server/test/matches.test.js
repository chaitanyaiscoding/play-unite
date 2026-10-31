// End-to-end tests of the scoring API against an in-memory MongoDB.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import matchesRouter from '../src/routes/matches.js';
import { Match } from '../src/models/Match.js';
import { Player } from '../src/models/Player.js';
import { Session } from '../src/models/Session.js';
import { Team } from '../src/models/Team.js';

let db;
let server;
let base;
let cookie;
let otherCookie;

const login = async (player) => {
  const token = crypto.randomBytes(16).toString('hex');
  await Session.create({
    _id: crypto.createHash('sha256').update(token).digest('hex'),
    player,
    expiresAt: new Date(Date.now() + 86400000),
  });
  return `pu_session=${token}`;
};

before(async () => {
  db = await MongoMemoryServer.create({ instance: { launchTimeout: 60000 } });
  await mongoose.connect(db.getUri('test'));
  const app = express();
  app.use(express.json());
  app.use('/api/matches', matchesRouter);
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}/api/matches`;
});

after(async () => {
  server.close();
  await mongoose.disconnect();
  await db.stop();
});

async function post(path, body = {}, as = cookie) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: as },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}
const get = async (path) => (await fetch(`${base}${path}`, { headers: { cookie } })).json();

const NAMES = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3', 'outsider'];

beforeEach(async () => {
  await Promise.all([Match.deleteMany({}), Player.deleteMany({}), Team.deleteMany({}), Session.deleteMany({})]);
  await Player.insertMany(NAMES.map((n) => ({ _id: n, name: n, role: 'batter' })));
  cookie = await login('a1');
  otherCookie = await login('outsider');
});

// A live match between two three-player sides, with both teams locked.
async function liveMatch(overs = 2) {
  const match = await Match.create({
    createdBy: 'a1',
    status: 'live',
    overs,
    battingFirst: 'ta',
    log: [],
    toss: { call: 'heads', outcome: 'heads', winner: 'ta', decision: 'bat', at: new Date() },
    sides: [
      { team: 'ta', name: 'TA', playingXI: ['a1', 'a2', 'a3'], bench: [] },
      { team: 'tb', name: 'TB', playingXI: ['b1', 'b2', 'b3'], bench: [] },
    ],
  });
  const lock = { inMatch: true, matchStartedAt: match.startedAt, currentMatch: match._id };
  await Team.create({ _id: 'ta', name: 'TA', captain: 'a1', players: ['a2', 'a3'], ...lock });
  await Team.create({ _id: 'tb', name: 'TB', captain: 'b1', players: ['b2', 'b3'], ...lock });
  return String(match._id);
}

// Sends events one at a time, as the scorer's device does; returns the last response.
async function score(id, events) {
  let last;
  for (const event of events) {
    const { log } = await get(`/${id}`);
    last = await post(`/${id}/events`, { event, at: log.length });
    assert.equal(last.status, 200, JSON.stringify(last.body));
  }
  return last;
}

const ball = (runs, extra = null, wicket = null) => ({ type: 'ball', runs, extra, wicket });
const dots = (n) => Array.from({ length: n }, () => ball(0));
const openers = (s, n, bowler) => ({ type: 'start', striker: s, nonStriker: n, bowler });
// First innings: 12 runs off two overs (a six off the last ball of the match's first innings).
const firstInnings = [openers('a1', 'a2', 'b1'), ball(6), ...dots(5), { type: 'bowler', bowler: 'b2' }, ...dots(5), ball(6)];

async function untilChase(overs = 2) {
  const id = await liveMatch(overs);
  await score(id, firstInnings);
  return id;
}

test('the match completes by itself when the target is chased down', async () => {
  const id = await untilChase();
  const { body } = await score(id, [openers('b1', 'b2', 'a1'), ball(6), ball(6), ball(1)]);
  assert.equal(body.status, 'completed');
  assert.equal(body.outcome.text, 'TB won by 2 wkts');
  assert.ok(body.endedAt);

  const teams = await Team.find({});
  assert.ok(teams.every((t) => !t.inMatch && t.currentMatch === null));
  assert.equal((await Player.findById('b1')).matchesPlayed, 1);
});

test('the match completes by itself when the chasing side is all out', async () => {
  const id = await untilChase();
  const out = { how: 'bowled' };
  const { body } = await score(id, [
    openers('b1', 'b2', 'a1'),
    ball(1),
    ball(0, null, { how: 'bowled' }),
    { type: 'batter', player: 'b3' },
    ball(0, null, out),
  ]);
  assert.equal(body.status, 'completed');
  assert.equal(body.outcome.text, 'TA won by 11 runs');
});

test('the match list shows a finished match as a result, not as live', async () => {
  const id = await untilChase();
  await score(id, [openers('b1', 'b2', 'a1'), ball(6), ball(6), ball(1)]);
  const live = await get('?status=live');
  assert.equal(live.length, 0);
  const done = await get('?status=completed');
  assert.equal(done[0].line, 'TB won by 2 wkts');
  assert.equal(done[0].winner, 'TB');
});

test('a mid-match ball leaves the match live', async () => {
  const id = await untilChase();
  const { body } = await score(id, [openers('b1', 'b2', 'a1'), ball(6)]);
  assert.equal(body.status, 'live');
});

test('a match stuck as live after its last ball can still be finished', async () => {
  const id = await untilChase();
  await score(id, [openers('b1', 'b2', 'a1'), ball(6), ball(6)]);
  // How a match scored before auto-completion looks: over, but still live.
  await Match.updateOne({ _id: id }, { $push: { log: { inn: 1, type: 'ball', runs: 1, extra: null } } });
  const { log } = await get(`/${id}`);
  const { status, body } = await post(`/${id}/complete`, { at: log.length });
  assert.equal(status, 200);
  assert.equal(body.status, 'completed');
});

test('the scorer can correct the last ball of an over from the bowler prompt', async () => {
  const id = await liveMatch();
  const { body: before } = await score(id, [openers('a1', 'a2', 'b1'), ...dots(5), ball(6)]);
  const index = before.log.length - 1;
  const { status, body } = await post(`/${id}/correct`, { at: before.log.length, index, event: ball(4) });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.log.length, before.log.length);
  assert.equal(body.log[index].runs, 4);
  assert.equal(body.status, 'live');
});

test('a correction that clashes with later balls is refused and changes nothing', async () => {
  const id = await liveMatch();
  const { body: before } = await score(id, [openers('a1', 'a2', 'b1'), ball(0), ...dots(4), ball(1)]);
  const { status, body } = await post(`/${id}/correct`, { at: before.log.length, index: 1, event: ball(0, null, { how: 'bowled' }) });
  assert.equal(status, 400);
  assert.match(body.error, /Undo/);
  assert.deepEqual((await get(`/${id}`)).log, before.log);
});

test('a first-innings ball can\'t be corrected once the second innings is on', async () => {
  const id = await untilChase();
  const { log } = await get(`/${id}`);
  const { status } = await post(`/${id}/correct`, { at: log.length, index: 1, event: ball(4) });
  assert.equal(status, 400);
});

test('a stale device can\'t correct a ball', async () => {
  const id = await liveMatch();
  const { body: before } = await score(id, [openers('a1', 'a2', 'b1'), ball(1)]);
  const { status } = await post(`/${id}/correct`, { at: before.log.length - 1, index: 1, event: ball(4) });
  assert.equal(status, 409);
});

test('only the match creator can correct a ball', async () => {
  const id = await liveMatch();
  const { body: before } = await score(id, [openers('a1', 'a2', 'b1'), ball(1)]);
  const { status } = await post(`/${id}/correct`, { at: before.log.length, index: 1, event: ball(4) }, otherCookie);
  assert.equal(status, 403);
});

test('a correction that reaches the target completes the match', async () => {
  const id = await untilChase();
  const { body: before } = await score(id, [openers('b1', 'b2', 'a1'), ball(6), ball(6), ball(0)]);
  assert.equal(before.status, 'live');
  const { body } = await post(`/${id}/correct`, { at: before.log.length, index: before.log.length - 1, event: ball(1) });
  assert.equal(body.status, 'completed');
  assert.equal(body.outcome.winner, 'TB');
});

test('reopening a finished match removes the last ball and reverses its stats', async () => {
  const id = await untilChase();
  const { body: done } = await score(id, [openers('b1', 'b2', 'a1'), ball(6), ball(6), ball(1)]);
  assert.equal(done.canReopen, true);
  const mvp = await Player.findOne({ mvpCount: 1 });
  assert.ok(mvp);

  const { status, body } = await post(`/${id}/reopen`);
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.status, 'live');
  assert.equal(body.log.length, done.log.length - 1);
  assert.equal(body.outcome, null);
  assert.equal(body.mvp, null);
  assert.equal(body.performances.length, 0);
  assert.equal(body.innings.length, 0);

  assert.equal((await Player.findById(mvp._id)).mvpCount, 0);
  assert.equal((await Player.findById('b1')).matchesPlayed, 0);
  const teams = await Team.find({});
  assert.ok(teams.every((t) => t.inMatch && String(t.currentMatch) === id));
});

test('a reopened match can be finished again without double-counting', async () => {
  const id = await untilChase();
  await score(id, [openers('b1', 'b2', 'a1'), ball(6), ball(6), ball(1)]);
  await post(`/${id}/reopen`);
  const { body } = await score(id, [ball(2)]);
  assert.equal(body.status, 'completed');
  assert.equal((await Player.findById('b1')).matchesPlayed, 1);
});

test('a match can\'t be reopened while one of its teams is in another match', async () => {
  const id = await untilChase();
  await score(id, [openers('b1', 'b2', 'a1'), ball(6), ball(6), ball(1)]);
  await Team.updateOne({ _id: 'tb' }, { inMatch: true, currentMatch: new mongoose.Types.ObjectId() });
  const { status, body } = await post(`/${id}/reopen`);
  assert.equal(status, 409);
  assert.match(body.error, /TB/);
  assert.equal((await Match.findById(id)).status, 'completed');
  assert.equal((await Team.findById('ta')).inMatch, false);
});

test('a match can\'t be reopened while one of its players is in another match', async () => {
  const id = await untilChase();
  await score(id, [openers('b1', 'b2', 'a1'), ball(6), ball(6), ball(1)]);
  await Match.create({
    createdBy: 'outsider',
    status: 'live',
    sides: [
      { team: 'tc', name: 'TC', playingXI: ['a3'], bench: [] },
      { team: 'td', name: 'TD', playingXI: ['outsider'], bench: [] },
    ],
  });
  const { status } = await post(`/${id}/reopen`);
  assert.equal(status, 409);
  assert.equal((await Team.findById('ta')).inMatch, false);
});

test('only the creator can reopen a match', async () => {
  const id = await untilChase();
  const { body } = await score(id, [openers('b1', 'b2', 'a1'), ball(6), ball(6), ball(1)]);
  assert.equal(body.canReopen, true);
  const { status } = await post(`/${id}/reopen`, {}, otherCookie);
  assert.equal(status, 403);
});

test('a no-result match can\'t be reopened', async () => {
  const id = await untilChase();
  const { log } = await get(`/${id}`);
  const { body } = await post(`/${id}/complete`, { at: log.length, noResult: true });
  assert.equal(body.canReopen, false);
  const { status } = await post(`/${id}/reopen`);
  assert.equal(status, 409);
});

test('a match can\'t be reopened a day after it ended', async () => {
  const id = await untilChase();
  await score(id, [openers('b1', 'b2', 'a1'), ball(6), ball(6), ball(1)]);
  await Match.updateOne({ _id: id }, { endedAt: new Date(Date.now() - 25 * 3600 * 1000) });
  assert.equal((await get(`/${id}`)).canReopen, false);
  const { status } = await post(`/${id}/reopen`);
  assert.equal(status, 409);
});
