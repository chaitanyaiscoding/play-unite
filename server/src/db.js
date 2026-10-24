import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';

const DB_NAME = 'play-unite';
let embedded = null;

// Uses MONGODB_URI when provided; otherwise starts an embedded mongod whose
// data is persisted to server/.data so players survive restarts.
async function resolveUri() {
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
  if (process.env.NODE_ENV === 'production') {
    // The embedded MongoDB is for local development only.
    throw new Error('MONGODB_URI is not set. Production needs a real MongoDB connection string.');
  }

  const { MongoMemoryServer } = await import('mongodb-memory-server');
  const dbPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.data');
  fs.mkdirSync(dbPath, { recursive: true });

  embedded = await MongoMemoryServer.create({
    instance: { dbPath, dbName: DB_NAME, storageEngine: 'wiredTiger', port: 27018 },
  });
  console.log(`[db] Embedded MongoDB running, data in ${dbPath}`);
  return embedded.getUri(DB_NAME);
}

export async function connectDb() {
  const uri = await resolveUri();
  await mongoose.connect(uri);
  console.log(`[db] Connected to ${mongoose.connection.name}`);
}

export async function disconnectDb() {
  await mongoose.disconnect();
  if (embedded) await embedded.stop({ doCleanup: false });
}
