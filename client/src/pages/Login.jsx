import { useEffect, useState } from 'preact/hooks';
import { api } from '../api.js';
import { Link, useApp } from '../app.jsx';
import { daysUntil, ddayLabel } from '../util.js';

export function Login() {
  const { reload } = useApp();
  const [pub, setPub] = useState(null);
  const [token, setToken] = useState('');
  const [error, setError] = useState(new URLSearchParams(window.location.search).get('login') === 'invalid' ? '접속 링크가 만료되었거나 올바르지 않습니다. 총괄대표에게 새 링크를 요청하세요.' : '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/public').then(setPub).catch(() => {});
    if (window.location.search) window.history.replaceState({}, '', window.location.pathname);
  }, []);

  async function submit(e) {
    e.preventDefault();
    if (!token.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/login', { token });
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const dday = daysUntil(pub?.eventDate);
  return (
    <div class="login">
      <section class="login-panel tone">
        <p class="login-dday">{dday != null ? ddayLabel(dday) : ''}</p>
        <h1>{pub?.title || 'JPOP 연합공연'}</h1>
        <p class="login-sub">참가 팀 소통 공간</p>
      </section>
      <form class="login-form" onSubmit={submit}>
        <label class="field">
          <span class="field-label">비밀번호</span>
          <input
            value={token}
            onInput={(e) => setToken(e.currentTarget.value)}
            placeholder="로그인 비밀번호를 입력하세요"
            type="password"
            autocomplete="current-password"
            autocapitalize="none"
            spellcheck={false}
            aria-invalid={Boolean(error)}
            aria-describedby="login-help"
          />
        </label>
        {error && <p class="form-error" role="alert">{error}</p>}
        <button class="btn btn-primary btn-block" disabled={busy || !token.trim()}>{busy ? '확인 중' : '들어가기'}</button>
        <p id="login-help" class="login-help">
          총괄대표에게 받은 접속 링크를 누르면 비밀번호 입력 없이 바로 들어옵니다. 한 번 들어오면 이 기기에서는 60일간 로그인이 유지됩니다.
        </p>
        <Link href="/rules" class="login-rules">운영규약 먼저 읽기</Link>
      </form>
    </div>
  );
}
