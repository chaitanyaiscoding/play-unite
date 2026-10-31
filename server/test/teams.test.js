// Squad size limits, against an in-memory MongoDB.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import teamsRouter from '../src/routes/teams.js';
import { Player } from '../src/models/Player.js';
import { Session } from '../src/models/Session.js';
import { Team } from '../src/models/Team.js';

let db;
let server;
let base;
let cookie;

before(async () => {
  db = await MongoMemoryServer.create({ instance: { launchTimeout: 60000 } });
  await mongoose.connect(db.getUri('test'));
  const app = express();
  app.use(express.json());
  app.use('/api/teams', teamsRouter);
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}/api/teams`;
});

after(async () => {
  server.close();
  await mongoose.disconnect();
  await db.stop();
});

const names = (n, from = 1) => Array.from({ length: n }, (_, i) => `player${from + i}`);

async function post(path, body) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

beforeEach(async () => {
  await Promise.all([Player.deleteMany({}), Team.deleteMany({}), Session.deleteMany({})]);
  await Player.insertMany(['captain', ...names(25)].map((n) => ({ _id: n, name: n, role: 'batter' })));
  const token = crypto.randomBytes(16).toString('hex');
  await Session.create({
    _id: crypto.createHash('sha256').update(token).digest('hex'),
    player: 'captain',
    expiresAt: new Date(Date.now() + 86400000),
  });
  cookie = `pu_session=${token}`;
});

test('a full squad is an XI of 11 plus a bench of 10', async () => {
  const { status, body } = await post('', { name: 'Full Side', players: names(20) });
  assert.equal(status, 201, JSON.stringify(body));
  assert.equal(body.maxPlayers, 20);
  assert.equal(body.size, 21);
  assert.equal(body.lineup.playingXI.length, 11);
  assert.equal(body.lineup.bench.length, 10);
});

test('a team can\'t be created with more than 20 players besides the captain', async () => {
  const { status, body } = await post('', { name: 'Too Many', players: names(21) });
  assert.equal(status, 400);
  assert.match(body.error, /between 1 and 20/);
});

test('a captain can add players up to 20, but not past it', async () => {
  await post('', { name: 'Growing', players: names(15) });
  const added = await post('/Growing/players', { players: names(5, 16) });
  assert.equal(added.status, 200, JSON.stringify(added.body));
  assert.equal(added.body.players.length, 20);

  const full = await post('/Growing/players', { players: names(1, 21) });
  assert.equal(full.status, 400);
  assert.match(full.body.error, /at most 20/);
});
