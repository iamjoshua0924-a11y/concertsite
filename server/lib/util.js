import crypto from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const badRequest = (msg) => new HttpError(400, msg);
export const forbidden = (msg = '이 작업을 수행할 권한이 없습니다.') => new HttpError(403, msg);
export const notFound = (msg = '대상을 찾을 수 없습니다.') => new HttpError(404, msg);

export function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

/** 문자열 입력 정규화. required면 빈 값 거부, max 초과 시 거부. */
export function text(value, { name = '값', max = 2000, required = false } = {}) {
  const v = value == null ? '' : String(value).replace(/\r\n/g, '\n').trim();
  if (required && !v) throw badRequest(`${name}을(를) 입력하세요.`);
  if (v.length > max) throw badRequest(`${name}은(는) ${max}자 이하로 입력하세요.`);
  return v;
}

export function optionalDate(value, name = '날짜') {
  const v = text(value, { name, max: 10 });
  if (!v) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) {
    throw badRequest(`${name} 형식은 YYYY-MM-DD 입니다.`);
  }
  return v;
}

export function optionalTime(value, name = '시간') {
  const v = text(value, { name, max: 5 });
  if (!v) return '';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw badRequest(`${name} 형식은 HH:MM 입니다.`);
  return v;
}

export function optionalUrl(value, name = '링크') {
  const v = text(value, { name, max: 500 });
  if (!v) return '';
  try {
    const u = new URL(v);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error();
  } catch {
    throw badRequest(`${name}는 http(s)로 시작하는 주소여야 합니다.`);
  }
  return v;
}

export function optionalColor(value) {
  const v = text(value, { name: '테마 색상', max: 7 });
  if (!v) return '';
  if (!/^#[0-9a-fA-F]{6}$/.test(v)) throw badRequest('테마 색상은 #RRGGBB 형식입니다.');
  return v.toUpperCase();
}

export function intInRange(value, { name = '숫자', min = 0, max = 10000, fallback = null } = {}) {
  if (value === '' || value == null) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw badRequest(`${name}는 ${min}~${max} 사이 정수입니다.`);
  return n;
}

/** "3:45" | "225" | "3분45초" → 초. 빈 값은 null. */
export function parseDuration(value) {
  const v = String(value ?? '').trim();
  if (!v) return null;
  let m = v.match(/^(\d{1,2}):([0-5]\d)$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = v.match(/^(\d{1,2})\s*분\s*(?:(\d{1,2})\s*초)?$/);
  if (m) return Number(m[1]) * 60 + Number(m[2] || 0);
  m = v.match(/^\d{1,4}$/);
  if (m) return Number(v);
  throw badRequest(`러닝타임 "${v}"을(를) 해석할 수 없습니다. 3:45 형식으로 입력하세요.`);
}

/** 마감일(YYYY-MM-DD)이 한국시간 기준으로 지났는지 */
export function isPastDueKst(dueDate, now = new Date()) {
  if (!dueDate) return false;
  const end = new Date(`${dueDate}T23:59:59.999+09:00`);
  return now.getTime() > end.getTime();
}

export function nowIso() {
  return new Date().toISOString();
}

export function scryptHash(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function scryptVerify(password, stored) {
  if (!stored || !password) return false;
  const parts = String(stored).split('$');
  if (parts[0] === 'scrypt' && parts.length === 3) {
    const salt = Buffer.from(parts[1], 'hex');
    const expected = Buffer.from(parts[2], 'hex');
    const actual = crypto.scryptSync(password, salt, expected.length);
    return crypto.timingSafeEqual(actual, expected);
  }
  // 구버전(Apps Script) 무염 SHA-256 해시 호환
  if (/^[0-9a-f]{64}$/.test(stored)) {
    const actual = crypto.createHash('sha256').update(password, 'utf8').digest('hex');
    return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(stored));
  }
  return false;
}
