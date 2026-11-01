// End-to-end tests of the tournament API against an in-memory MongoDB.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import matchesRouter from '../src/routes/matches.js';
import tournamentsRouter from '../src/routes/tournaments.js';
import { Match } from '../src/models/Match.js';
import { Player } from '../src/models/Player.js';
import { Session } from '../src/models/Session.js';
import { Team } from '../src/models/Team.js';
import { Tournament } from '../src/models/Tournament.js';

let db;
let server;
let base;
let organiser;
let someoneElse;

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
  app.use('/api/tournaments', tournamentsRouter);
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  server.close();
  await mongoose.disconnect();
  await db.stop();
});

async function call(method, path, body, as = organiser) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', cookie: as },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}
const post = (path, body = {}, as) => call('POST', path, body, as);
const get = async (path, as) => (await call('GET', path, undefined, as)).body;

const TEAMS = ['a', 'b', 'c', 'd'];
const xi = (t) => [`${t}1`, `${t}2`];
const sides = (x, y) => [
  { team: x, name: x.toUpperCase(), playingXI: xi(x), bench: [] },
  { team: y, name: y.toUpperCase(), playingXI: xi(y), bench: [] },
];

beforeEach(async () => {
  await Promise.all([Match.deleteMany({}), Player.deleteMany({}), Team.deleteMany({}), Session.deleteMany({}), Tournament.deleteMany({})]);
  const names = [...TEAMS.flatMap(xi), 'org', 'other'];
  await Player.insertMany(names.map((n) => ({ _id: n, name: n, role: 'batter' })));
  // Straight to the collection: one-letter names keep these tests readable, but aren't valid team names.
  await Team.collection.insertMany(
    TEAMS.map((t) => ({ _id: t, name: t.toUpperCase(), captain: `${t}1`, players: [`${t}2`], inMatch: false, currentMatch: null, matchStartedAt: null }))
  );
  organiser = await login('org');
  someoneElse = await login('other');
});

// A finished match with a stored result, outside any tournament unless given one.
const played = (x, y, winner, more = {}) =>
  Match.create({
    createdBy: 'other',
    status: 'completed',
    sides: sides(x, y),
    log: [{ inn: 0, type: 'start' }],
    outcome: { winner, type: winner ? 'runs' : 'tie', margin: winner ? 5 : null, text: winner ? `${winner.toUpperCase()} won` : 'Match tied' },
    endedAt: new Date(),
    performances: [],
    ...more,
  });

const newTournament = async (name = 'Sunday Cup') => {
  const { status, body } = await post('/tournaments', { name });
  assert.equal(status, 201, JSON.stringify(body));
  return body.id;
};
const addExisting = async (id, match) => {
  const res = await post(`/tournaments/${id}/matches/existing`, { match: String(match._id) });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
};
const finish = (x, y) => ({ team: { name: x.toUpperCase(), playingXI: xi(x) }, opponent: { name: y.toUpperCase(), playingXI: xi(y) } });

test('anyone can create a tournament, and it shows as running to everyone', async () => {
  const id = await newTournament();
  const list = await get('/tournaments', someoneElse);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, id);
  assert.equal(list[0].status, 'running');
  assert.equal(list[0].organiser, 'org');
});

test('a tournament needs a name', async () => {
  const { status } = await post('/tournaments', { name: ' ' });
  assert.equal(status, 400);
});

test('the organiser creates and scores a match between teams they are not in', async () => {
  const id = await newTournament();
  const res = await post(`/tournaments/${id}/matches`, finish('a', 'b'));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const [entry] = res.body.entries;
  assert.equal(entry.number, 1);
  assert.equal(entry.state, 'toss');

  const match = await get(`/matches/${entry.match.id}`);
  assert.equal(match.canControl, true);
  assert.equal(match.tournament.id, id);
  assert.equal((await Team.findById('a')).inMatch, true);
});

test('only the organiser can change a tournament', async () => {
  const id = await newTournament();
  const m = await played('a', 'b', 'a');
  const attempts = [
    post(`/tournaments/${id}/matches`, finish('a', 'b'), someoneElse),
    post(`/tournaments/${id}/matches/existing`, { match: String(m._id) }, someoneElse),
    post(`/tournaments/${id}/connected`, { sources: [] }, someoneElse),
    call('PUT', `/tournaments/${id}/order`, { teams: [] }, someoneElse),
    post(`/tournaments/${id}/complete`, {}, someoneElse),
    call('DELETE', `/tournaments/${id}/entries/1`, undefined, someoneElse),
  ];
  for (const r of await Promise.all(attempts)) assert.equal(r.status, 403);
  assert.equal((await get(`/tournaments/${id}`, someoneElse)).canManage, false);
});

test('a running or completed match can be added, once, and stays with its own scorer', async () => {
  const id = await newTournament();
  const running = await Match.create({ createdBy: 'other', status: 'live', sides: sides('c', 'd'), log: [], overs: 2, battingFirst: 'c' });
  const done = await played('a', 'b', 'a');
  const abandoned = await Match.create({ createdBy: 'other', status: 'abandoned', sides: sides('a', 'c') });

  const eligible = await get(`/tournaments/${id}/eligible`);
  assert.deepEqual(eligible.map((m) => m.id).sort(), [String(running._id), String(done._id)].sort());

  const view = await addExisting(id, running);
  assert.equal(view.entries[0].state, 'live');
  assert.equal(view.entries[0].match.createdBy, 'other');
  assert.equal((await post(`/tournaments/${id}/matches/existing`, { match: String(abandoned._id) })).status, 409);

  const other = await newTournament('Other Cup');
  assert.equal((await post(`/tournaments/${other}/matches/existing`, { match: String(running._id) })).status, 409);
  assert.deepEqual((await get(`/tournaments/${other}/eligible`)).map((m) => m.id), [String(done._id)]);
});

test('a connected match fills in its teams and only accepts those teams', async () => {
  const id = await newTournament();
  const first = await played('a', 'b', 'a');
  const second = await Match.create({ createdBy: 'other', status: 'live', sides: sides('c', 'd'), log: [] });
  await addExisting(id, first);
  await addExisting(id, second);

  const { status, body } = await post(`/tournaments/${id}/connected`, {
    sources: [{ number: 1, take: 'winner' }, { number: 2, take: 'loser' }],
  });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.entries[2].state, 'waiting');
  assert.equal((await post(`/tournaments/${id}/matches`, { ...finish('a', 'c'), entry: 3 })).status, 409);

  await Match.updateOne({ _id: second._id }, { status: 'completed', outcome: { winner: 'd', type: 'runs' }, endedAt: new Date() });
  const ready = (await get(`/tournaments/${id}`)).entries[2];
  assert.equal(ready.state, 'ready');
  assert.deepEqual(ready.teams.map((t) => t.name), ['A', 'C']);

  assert.equal((await post(`/tournaments/${id}/matches`, { ...finish('a', 'd'), entry: 3 })).status, 400);
  const created = await post(`/tournaments/${id}/matches`, { ...finish('a', 'c'), entry: 3 });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.equal(created.body.entries[2].state, 'toss');
  assert.equal(created.body.entries.length, 3);
});

test('a connected match needs two different earlier matches and winner or loser', async () => {
  const id = await newTournament();
  await addExisting(id, await played('a', 'b', 'a'));
  await addExisting(id, await played('c', 'd', 'c'));
  const bad = [
    [{ number: 1, take: 'winner' }, { number: 1, take: 'loser' }],
    [{ number: 1, take: 'winner' }, { number: 9, take: 'winner' }],
    [{ number: 1, take: 'winner' }, { number: 2, take: 'both' }],
    [{ number: 1, take: 'winner' }],
  ];
  for (const sources of bad) {
    assert.equal((await post(`/tournaments/${id}/connected`, { sources })).status, 400, JSON.stringify(sources));
  }
});

test('a connected match becomes a no result when an earlier match is tied', async () => {
  const id = await newTournament();
  await addExisting(id, await played('a', 'b', null));
  await addExisting(id, await played('c', 'd', 'c'));
  const { body } = await post(`/tournaments/${id}/connected`, {
    sources: [{ number: 1, take: 'winner' }, { number: 2, take: 'winner' }],
  });
  assert.equal(body.entries[2].state, 'no_result');
  assert.equal((await post(`/tournaments/${id}/complete`)).status, 200);
});

test('the organiser can only reorder teams level on wins', async () => {
  const id = await newTournament();
  await addExisting(id, await played('a', 'b', 'a'));
  await addExisting(id, await played('c', 'd', 'c'));
  await addExisting(id, await played('a', 'd', 'a'));
  let t = await get(`/tournaments/${id}`);
  assert.deepEqual(t.standings.map((r) => r.name), ['A', 'C', 'B', 'D']);

  const res = await call('PUT', `/tournaments/${id}/order`, { teams: ['A', 'C', 'D', 'B'] });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.standings.map((r) => r.name), ['A', 'C', 'D', 'B']);

  t = (await call('PUT', `/tournaments/${id}/order`, { teams: ['D', 'B', 'C', 'A'] })).body;
  assert.deepEqual(t.standings.map((r) => r.name), ['A', 'C', 'D', 'B']);

  assert.equal((await call('PUT', `/tournaments/${id}/order`, { teams: ['Nobody'] })).status, 400);
});

test('the final is between the top two, and stays out of the table', async () => {
  const id = await newTournament();
  await addExisting(id, await played('a', 'b', 'a'));
  await addExisting(id, await played('c', 'd', 'c'));
  await addExisting(id, await played('a', 'd', 'a'));

  const before = await get(`/tournaments/${id}`);
  assert.deepEqual(before.finalTeams.map((t) => t.name), ['A', 'C']);

  assert.equal((await post(`/tournaments/${id}/matches`, { ...finish('a', 'b'), final: true })).status, 400);
  const res = await post(`/tournaments/${id}/matches`, { ...finish('a', 'c'), final: true });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const final = res.body.entries.at(-1);
  assert.equal(final.final, true);

  assert.equal((await post(`/tournaments/${id}/matches`, finish('b', 'd'))).status, 409);

  await Match.updateOne({ _id: final.match.id }, { status: 'completed', outcome: { winner: 'c', type: 'runs' }, endedAt: new Date() });
  await Team.updateMany({}, { inMatch: false, currentMatch: null });
  const after = await post(`/tournaments/${id}/complete`);
  assert.equal(after.status, 200, JSON.stringify(after.body));
  assert.equal(after.body.champion.name, 'C');
  assert.deepEqual(after.body.standings.find((r) => r.name === 'C').won, 1);
});

test('awards and match MVPs cover every match in the tournament', async () => {
  const id = await newTournament();
  const perf = (player, team, runs, wickets) => ({ player, team, batting: { runs, balls: 10 }, bowling: { wickets, runs: 10, balls: 12 } });
  await addExisting(id, await played('a', 'b', 'a', { mvp: 'a1', mvpPoints: 50, performances: [perf('a1', 'a', 30, 0), perf('b1', 'b', 5, 2)] }));
  await addExisting(id, await played('a', 'c', 'c', { mvp: 'c1', mvpPoints: 40, performances: [perf('a1', 'a', 15, 0), perf('b1', 'b', 0, 1)] }));
  const t = await get(`/tournaments/${id}`);
  assert.deepEqual(t.awards.batsman, { name: 'a1', runs: 45, balls: 20 });
  assert.deepEqual(t.awards.bowler, { name: 'b1', wickets: 3, runs: 20, balls: 24 });
  assert.deepEqual(t.entries.map((e) => e.match.mvp?.name), ['a1', 'c1']);
});

test('a tournament cannot end while a match is in progress', async () => {
  const id = await newTournament();
  await addExisting(id, await Match.create({ createdBy: 'other', status: 'live', sides: sides('a', 'b'), log: [] }));
  const res = await post(`/tournaments/${id}/complete`);
  assert.equal(res.status, 409);
  assert.match(res.body.error, /finish/i);
});

test('a completed tournament can never change', async () => {
  const id = await newTournament();
  const m = await played('a', 'b', 'a');
  await addExisting(id, m);
  await addExisting(id, await played('c', 'd', 'c'));
  assert.equal((await post(`/tournaments/${id}/complete`)).status, 200);

  const spare = await played('a', 'c', 'a');
  const attempts = [
    post(`/tournaments/${id}/matches`, finish('a', 'b')),
    post(`/tournaments/${id}/matches/existing`, { match: String(spare._id) }),
    post(`/tournaments/${id}/connected`, { sources: [{ number: 1, take: 'winner' }, { number: 2, take: 'winner' }] }),
    call('PUT', `/tournaments/${id}/order`, { teams: ['A'] }),
    call('DELETE', `/tournaments/${id}/entries/1`),
    post(`/tournaments/${id}/complete`),
  ];
  for (const r of await Promise.all(attempts)) assert.equal(r.status, 409);

  const asCreator = await login('other');
  assert.equal((await get(`/matches/${m._id}`, asCreator)).canReopen, false);
  assert.equal((await post(`/matches/${m._id}/reopen`, {}, asCreator)).status, 409);
});

test('a match feeding a started connected match cannot be reopened', async () => {
  const id = await newTournament();
  const m = await played('a', 'b', 'a');
  await addExisting(id, m);
  await addExisting(id, await played('c', 'd', 'c'));
  await post(`/tournaments/${id}/connected`, { sources: [{ number: 1, take: 'winner' }, { number: 2, take: 'winner' }] });

  const asCreator = await login('other');
  assert.equal((await get(`/matches/${m._id}`, asCreator)).canReopen, true);

  const created = await post(`/tournaments/${id}/matches`, { ...finish('a', 'c'), entry: 3 });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.equal((await get(`/matches/${m._id}`, asCreator)).canReopen, false);
  assert.equal((await post(`/matches/${m._id}/reopen`, {}, asCreator)).status, 409);
});

test('removing a match from a tournament frees it, unless a connected match depends on it', async () => {
  const id = await newTournament();
  const m = await played('a', 'b', 'a');
  await addExisting(id, m);
  await addExisting(id, await played('c', 'd', 'c'));
  await post(`/tournaments/${id}/connected`, { sources: [{ number: 1, take: 'winner' }, { number: 2, take: 'winner' }] });

  assert.equal((await call('DELETE', `/tournaments/${id}/entries/1`)).status, 409);
  const gone = await call('DELETE', `/tournaments/${id}/entries/3`);
  assert.equal(gone.status, 200, JSON.stringify(gone.body));
  assert.equal(gone.body.entries.length, 2);

  const res = await call('DELETE', `/tournaments/${id}/entries/1`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal((await Match.findById(m._id)).tournament, null);
  assert.equal((await Match.countDocuments({ _id: m._id })), 1);
});
