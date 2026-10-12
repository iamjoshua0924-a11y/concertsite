import { loadConfig } from './config.js';
import { connectDb } from './db.js';
import { createApp } from './app.js';

const config = loadConfig();
const { client, db, bucket } = await connectDb(config);
const app = createApp({ db, bucket, config });

const server = app.listen(config.port, () => {
  console.log(`concertsite listening on :${config.port} (db: ${config.dbName})`);
  if (config.adminBootstrapToken) {
    console.warn('ADMIN_BOOTSTRAP_TOKEN이 설정되어 있습니다. 관리자 접속 코드를 발급한 뒤 환경변수에서 지우세요.');
  }
});

async function shutdown() {
  server.close();
  await client.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
