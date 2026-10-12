import { MongoClient, GridFSBucket } from 'mongodb';

export async function connectDb(config) {
  if (!config.mongoUri) throw new Error('MONGODB_URI 환경변수가 필요합니다.');
  const client = new MongoClient(config.mongoUri, { maxPoolSize: 5 });
  await client.connect();
  const db = client.db(config.dbName);
  await ensureIndexes(db);
  const bucket = new GridFSBucket(db, { bucketName: 'files' });
  return { client, db, bucket };
}

export async function ensureIndexes(db) {
  await Promise.all([
    db.collection('tokens').createIndex({ hash: 1 }, { unique: true }),
    db.collection('votes').createIndex({ pollId: 1, voterKey: 1 }, { unique: true }),
    db.collection('activity').createIndex({ at: -1 }),
    db.collection('meetings').createIndex({ createdAt: -1 }),
    db.collection('questions').createIndex({ createdAt: -1 }),
    db.collection('posts').createIndex({ createdAt: -1 }),
  ]);
}

/** 단일 문서 설정(event, rules) */
export async function getSetting(db, id, fallback = {}) {
  const doc = await db.collection('settings').findOne({ _id: id });
  return doc ? { ...fallback, ...doc } : { _id: id, ...fallback };
}

export async function logActivity(db, { type, text, teamId = '', href = '' }) {
  await db.collection('activity').insertOne({ type, text, teamId, href, at: new Date().toISOString() });
}
