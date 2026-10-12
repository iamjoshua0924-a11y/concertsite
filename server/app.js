import express from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sessionMiddleware } from './auth.js';
import { HttpError } from './lib/util.js';
import { authRoutes } from './routes/auth.js';
import { contentRoutes } from './routes/content.js';
import { progressRoutes } from './routes/progress.js';
import { boardRoutes } from './routes/board.js';
import { adminRoutes } from './routes/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = path.resolve(__dirname, '../dist/client');
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'concertsite';

export function createApp({ db, bucket, config }) {
  const app = express();
  app.set('trust proxy', 1); // Render 프록시 뒤에서 실제 IP로 rate limit
  app.disable('x-powered-by');

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
        fontSrc: ["'self'", 'https://cdn.jsdelivr.net'],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));
  app.use(compression());
  app.use(cookieParser());

  const sessions = sessionMiddleware(db, config);
  app.use(sessions);

  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  const api = express.Router();
  // 가져오기만 이미지 base64 때문에 큰 본문 허용
  api.use('/admin/import', express.json({ limit: '60mb' }));
  api.use(express.json({ limit: '1mb' }));

  // CSRF 방어: 변경 요청은 커스텀 헤더 필수(교차 출처에서는 preflight 없이 붙일 수 없음)
  api.use((req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.get(CSRF_HEADER) !== CSRF_VALUE) return next(new HttpError(403, '잘못된 요청입니다.'));
    next();
  });

  const ctx = { db, bucket, config, sessions };
  const { magicLink } = authRoutes(api, ctx);
  contentRoutes(api, ctx);
  progressRoutes(api, ctx);
  boardRoutes(api, ctx);
  adminRoutes(api, ctx);

  api.use((_req, _res, next) => next(new HttpError(404, '없는 API입니다.')));
  app.use('/api', api);
  app.get('/k/:token', ...magicLink);

  // 빌드된 프론트엔드 + SPA 라우팅
  if (fs.existsSync(CLIENT_DIR)) {
    app.use(express.static(CLIENT_DIR, {
      index: false,
      setHeaders(res, filePath) {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      },
    }));
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(CLIENT_DIR, 'index.html'));
    });
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    let status = err.status || err.statusCode || 500;
    let message = err.message;
    if (err.code === 'LIMIT_FILE_SIZE') {
      status = 400;
      message = '파일은 10MB 이하만 올릴 수 있습니다.';
    } else if (err.type === 'entity.too.large') {
      status = 413;
      message = '요청이 너무 큽니다.';
    }
    if (status >= 500) {
      console.error(`[${req.method} ${req.originalUrl}]`, err);
      message = '서버 오류가 발생했습니다. 잠시 후 다시 시도하세요.';
    }
    res.status(status).json({ error: message });
  });

  return app;
}
