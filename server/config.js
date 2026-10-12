export function loadConfig(env = process.env) {
  const isProd = env.NODE_ENV === 'production';
  const sessionSecret = env.SESSION_SECRET || '';
  if (isProd && sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET 환경변수(32자 이상)가 필요합니다.');
  }
  return {
    isProd,
    port: Number(env.PORT || 3000),
    mongoUri: env.MONGODB_URI || '',
    dbName: env.MONGODB_DB || 'jpop_union',
    sessionSecret: sessionSecret || 'dev-only-secret-dev-only-secret-0000',
    // 관리자 토큰이 하나도 없을 때 최초 진입용. 관리자 토큰 발급 후에는 환경변수에서 지우세요.
    adminBootstrapToken: env.ADMIN_BOOTSTRAP_TOKEN || '',
    appTitle: env.APP_TITLE || 'JPOP 연합공연',
  };
}
