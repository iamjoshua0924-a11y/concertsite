import { createContext } from 'preact';
import { useCallback, useContext, useEffect, useRef, useState } from 'preact/hooks';
import { api, ApiError } from './api.js';

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

/* ---------- 라우터 (history API) ---------- */
function currentPath() {
  return window.location.pathname + window.location.hash;
}

export function navigate(to, { replace = false } = {}) {
  if (to === currentPath()) return;
  window.history[replace ? 'replaceState' : 'pushState']({}, '', to);
  window.dispatchEvent(new Event('app:navigate'));
}

export function usePath() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const on = () => {
      setPath(window.location.pathname);
      const hash = window.location.hash.slice(1);
      requestAnimationFrame(() => {
        if (hash) document.getElementById(hash)?.scrollIntoView({ block: 'center' });
        else window.scrollTo(0, 0);
      });
    };
    window.addEventListener('popstate', on);
    window.addEventListener('app:navigate', on);
    return () => {
      window.removeEventListener('popstate', on);
      window.removeEventListener('app:navigate', on);
    };
  }, []);
  return path;
}

/** 내부 링크: 새로고침 없이 이동 */
export function Link({ href, children, ...rest }) {
  return (
    <a
      href={href}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(href);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}

/* ---------- 전역 상태 ---------- */
export function AppProvider({ children }) {
  const [state, setState] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | anon | error
  const [toasts, setToasts] = useState([]);
  const toastId = useRef(0);

  const toast = useCallback((message, kind = 'ok') => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 5000 : 2600);
  }, []);

  const reload = useCallback(async () => {
    try {
      const s = await api.get('/state');
      setState(s);
      setStatus('ready');
      return s;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setState(null);
        setStatus('anon');
      } else {
        setStatus((cur) => (cur === 'ready' ? cur : 'error'));
        toast(e.message, 'error');
      }
      return null;
    }
  }, [toast]);

  useEffect(() => {
    reload();
    // 다른 탭/기기에서 바뀐 내용을 돌아왔을 때 반영
    const onVisible = () => document.visibilityState === 'visible' && reload();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [reload]);

  /** 변경 요청 공통 처리: 실행 → 상태 재조회 → 토스트. 실패 시 오류 토스트 후 throw */
  const run = useCallback(async (fn, okMessage) => {
    try {
      const result = await fn();
      await reload();
      if (okMessage) toast(okMessage);
      return result;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        await reload();
      }
      toast(e.message, 'error');
      throw e;
    }
  }, [reload, toast]);

  const value = { state, status, reload, run, toast, setStatus };
  return (
    <AppCtx.Provider value={value}>
      {children}
      <div class="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} class={`toast toast-${t.kind}`}>{t.message}</div>
        ))}
      </div>
    </AppCtx.Provider>
  );
}
