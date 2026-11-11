import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MongoClient } from 'mongodb';
import { STARTING_BALANCE } from '../shared/markets.js';
import { AppError } from './errors.js';

export async function openStore({ uri, database, dataPath, mode }) {
  let local;
  if (!uri) {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    const dbPath = resolve(dataPath);
    await mkdir(dbPath, { recursive: true });
    local = await MongoMemoryServer.create({
      instance: { dbPath, ip: '127.0.0.1', storageEngine: 'wiredTiger', args: ['--wiredTigerCacheSizeGB', '0.25'] },
    });
  }
  const client = new MongoClient(uri || local.getUri(), {
    serverSelectionTimeoutMS: 5000,
    maxPoolSize: 12,
    // A successful order must survive a local mongod restart, including on Windows.
    writeConcern: { w: 'majority', journal: true },
  });
  try {
    await client.connect();
    const db = client.db(database);
    const accounts = db.collection(mode + '_accounts');
    const challenges = db.collection('wallet_challenges');
    const sessions = db.collection('wallet_sessions');
    const controls = db.collection('practice_prices');
    await Promise.all([
      challenges.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    ]);
    return {
      accounts, challenges, sessions, controls, storage: local ? 'Local MongoDB' : 'MongoDB',
      async ensureAccount(address) {
        const id = address.toLowerCase();
        await accounts.updateOne({ _id: id }, { $setOnInsert: {
          address, availableCents: STARTING_BALANCE * 100, positions: [], events: [], version: 0, createdAt: new Date(),
        } }, { upsert: true });
        return accounts.findOne({ _id: id });
      },
      async changeAccount(id, change) {
        for (let retry = 0; retry < 6; retry++) {
          const account = await accounts.findOne({ _id: id });
          if (!account) throw new AppError(401, 'Reconnect your wallet to continue.');
          const next = change(account);
          if (next === account) return account;
          next.version = account.version + 1;
          const result = await accounts.replaceOne({ _id: id, version: account.version }, next);
          if (result.modifiedCount) return next;
        }
        throw new AppError(409, 'The account changed while saving. Try again.');
      },
      async stop() {
        await client.close();
        if (local) await local.stop({ doCleanup: false });
      },
    };
  } catch (error) {
    await client.close();
    if (local) await local.stop({ doCleanup: false });
    throw error;
  }
}
