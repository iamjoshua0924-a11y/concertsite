// 로컬 체험용: MongoDB 없이 메모리 DB로 서버 실행 (재시작하면 데이터 사라짐)
// 사용법: npm run build && node scripts/dev-memory-server.js  → 접속 코드 DEV00-ADMIN
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, GridFSBucket } from 'mongodb';
import { createApp } from '../server/app.js';
import { ensureIndexes } from '../server/db.js';
import { loadConfig } from '../server/config.js';

const mongo = await MongoMemoryServer.create();
const client = new MongoClient(mongo.getUri());
await client.connect();
const db = client.db('dev');
await ensureIndexes(db);
const config = { ...loadConfig(process.env), adminBootstrapToken: process.env.ADMIN_BOOTSTRAP_TOKEN || 'DEV00-ADMIN' };
const app = createApp({ db, bucket: new GridFSBucket(db, { bucketName: 'files' }), config });
app.listen(config.port, () => console.log(`http://localhost:${config.port}  (접속 코드: ${config.adminBootstrapToken})`));
