import rateLimit from 'express-rate-limit';
import { COOKIE_NAME, findTokenForLogin, sessionCookieOptions, signSession, buildSession } from '../auth.js';
import { getSetting } from '../db.js';
import { HttpError } from '../lib/util.js';
import { buildState, DEFAULT_EVENT } from '../state.js';

export function authRoutes(router, { db, config }) {
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: '로그인 시도가 너무 많습니다. 15분 후 다시 시도하세요.' },
  });

  async function login(req, res, raw) {
    const doc = await findTokenForLogin(db, config, raw);
    if (!doc) throw new HttpError(401, '비밀번호가 맞지 않습니다.');
    res.cookie(COOKIE_NAME, signSession(config.sessionSecret, { tid: doc._id, v: Number(doc.version || 0), iat: Date.now() }), sessionCookieOptions(config));
    if (doc._id !== '__bootstrap__') {
      await db.collection('tokens').updateOne({ _id: doc._id }, { $set: { lastUsedAt: new Date().toISOString() } });
    }
    return doc;
  }

  // 로그인 없이 볼 수 있는 최소 정보: 제목, 운영규약
  router.get('/public', async (_req, res) => {
    const [event, rules] = await Promise.all([getSetting(db, 'event', DEFAULT_EVENT), getSetting(db, 'rules', { content: '' })]);
    res.json({ title: event.title || config.appTitle, eventDate: event.eventDate || '', rules: rules.content || '' });
  });

  router.post('/auth/login', loginLimiter, async (req, res) => {
    const doc = await login(req, res, req.body?.token);
    const session = doc._id === '__bootstrap__' ? null : buildSession(doc);
    res.json({ ok: true, role: session?.role || 'admin' });
  });

  router.post('/auth/logout', (_req, res) => {
    res.clearCookie(COOKIE_NAME, { path: '/' });
    res.json({ ok: true });
  });

  router.get('/state', async (req, res) => {
    if (!req.session) throw new HttpError(401, '로그인이 필요합니다.');
    res.json(await buildState(db, req.session));
  });

  // 매직 링크: /k/XXXXX-XXXXX → 로그인 후 홈으로. 실패하면 로그인 화면에 오류 표시
  return {
    magicLink: [
      loginLimiter,
      async (req, res) => {
        try {
          await login(req, res, req.params.token);
          res.redirect(302, '/');
        } catch {
          res.redirect(302, '/?login=invalid');
        }
      },
    ],
  };
}
