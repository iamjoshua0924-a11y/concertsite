import crypto from 'node:crypto';
import { forbidden, HttpError } from './lib/util.js';

export const ROLE_LEVELS = { member: 1, leader: 2, admin: 3 };
export const ROLE_LABELS = { member: '팀 구성원', leader: '팀 대표', admin: '총괄대표' };
export const COOKIE_NAME = 'cs_sid';
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 60; // 60일
const BOOTSTRAP_ID = '__bootstrap__';

// 헷갈리는 문자(0/O, 1/I/L) 제외
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function normalizeToken(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function hashToken(raw) {
  return crypto.createHash('sha256').update(normalizeToken(raw)).digest('hex');
}

export function generateToken() {
  const bytes = crypto.randomBytes(10);
  let out = '';
  for (let i = 0; i < 10; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

function hmac(secret, data) {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

export function signSession(secret, payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${hmac(secret, body)}`;
}

export function verifySession(secret, value) {
  if (!value || typeof value !== 'string' || !value.includes('.')) return null;
  const [body, sig] = value.split('.');
  const expected = hmac(secret, body);
  const a = Buffer.from(sig || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.tid || Date.now() - Number(payload.iat || 0) > SESSION_MAX_AGE_MS) return null;
    return payload;
  } catch {
    return null;
  }
}

export function sessionCookieOptions(config) {
  return {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE_MS,
    path: '/',
  };
}

export function buildSession(tokenDoc) {
  const role = tokenDoc.role;
  const level = ROLE_LEVELS[role] || 0;
  return {
    tokenId: tokenDoc._id,
    label: tokenDoc.label || '',
    role,
    roleLabel: ROLE_LABELS[role] || role,
    teamId: tokenDoc.teamId || '',
    can: {
      editEvent: role === 'admin',
      manage: role === 'admin',
      editOwnTeam: level >= ROLE_LEVELS.leader,
      answerQuestions: role === 'admin',
      seeLeaderInfo: level >= ROLE_LEVELS.leader,
    },
  };
}

function bootstrapSession() {
  return buildSession({ _id: BOOTSTRAP_ID, label: '초기 관리자', role: 'admin', teamId: '' });
}

/** 토큰 문자열로 세션 찾기. 실패 시 null */
export async function findTokenForLogin(db, config, raw) {
  const normalized = normalizeToken(raw);
  if (!normalized) return null;
  if (config.adminBootstrapToken) {
    const a = Buffer.from(hashToken(config.adminBootstrapToken));
    const b = Buffer.from(hashToken(normalized));
    if (crypto.timingSafeEqual(a, b)) return { _id: BOOTSTRAP_ID, role: 'admin' };
  }
  const doc = await db.collection('tokens').findOne({ hash: hashToken(normalized), active: true });
  return doc || null;
}

/** 쿠키 → req.session. 토큰 비활성화가 즉시 반영되도록 짧은 캐시만 사용 */
export function sessionMiddleware(db, config) {
  const cache = new Map();
  const TTL = 15_000;
  async function loadToken(tid) {
    const hit = cache.get(tid);
    if (hit && Date.now() - hit.at < TTL) return hit.doc;
    const doc = await db.collection('tokens').findOne({ _id: tid });
    cache.set(tid, { doc, at: Date.now() });
    return doc;
  }
  const mw = async (req, _res, next) => {
    req.session = null;
    const payload = verifySession(config.sessionSecret, req.cookies?.[COOKIE_NAME]);
    if (payload) {
      if (payload.tid === BOOTSTRAP_ID) {
        if (config.adminBootstrapToken) req.session = bootstrapSession();
      } else {
        const doc = await loadToken(payload.tid);
        if (doc && doc.active && Number(doc.version || 0) === Number(payload.v || 0)) {
          req.session = buildSession(doc);
        }
      }
    }
    next();
  };
  mw.invalidate = (tid) => cache.delete(tid);
  mw.clear = () => cache.clear();
  return mw;
}

export function requireRole(minRole) {
  return (req, _res, next) => {
    if (!req.session) return next(new HttpError(401, '로그인이 필요합니다.'));
    if ((ROLE_LEVELS[req.session.role] || 0) < ROLE_LEVELS[minRole]) return next(forbidden());
    next();
  };
}

export function assertTeamAccess(session, teamId) {
  if (session.role === 'admin') return;
  if (!session.teamId || session.teamId !== teamId) {
    throw forbidden('해당 팀 데이터에 접근할 권한이 없습니다.');
  }
}

export function isAdmin(session) {
  return session?.role === 'admin';
}
