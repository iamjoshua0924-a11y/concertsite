export function loadConfig(env = process.env) {
  const isProd = env.NODE_ENV === 'production';
  // 32자 미만이면 무시하고, 서버 시작 시 DB에 저장된 키를 쓴다(resolveSessionSecret)
  const sessionSecret = (env.SESSION_SECRET || '').length >= 32 ? env.SESSION_SECRET : '';
  return {
    isProd,
    port: Number(env.PORT || 3000),
    mongoUri: env.MONGODB_URI || '',
    dbName: env.MONGODB_DB || 'jpop_union',
    sessionSecret,
    // 관리자 토큰이 하나도 없을 때 최초 진입용. 관리자 토큰 발급 후에는 환경변수에서 지우세요.
    adminBootstrapToken: env.ADMIN_BOOTSTRAP_TOKEN || '',
    appTitle: env.APP_TITLE || 'JPOP 연합공연',
  };
}
