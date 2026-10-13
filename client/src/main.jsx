import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { AppProvider, clearCache, Link, navigate, useApp, usePath } from './app.jsx';
import { api } from './api.js';
import { cx, myTodos } from './util.js';
import { Rail } from './components/Rail.jsx';
import { Login } from './pages/Login.jsx';
import { Home } from './pages/Home.jsx';
import { Teams } from './pages/Teams.jsx';
import { Progress } from './pages/Progress.jsx';
import { Polls } from './pages/Polls.jsx';
import { Board } from './pages/Board.jsx';
import { Rules } from './pages/Rules.jsx';
import { Admin } from './pages/Admin.jsx';
import './styles.css';

const NAV = [
  { href: '/', label: '홈', match: (p) => p === '/', icon: 'M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z' },
  { href: '/teams', label: '팀', match: (p) => p.startsWith('/teams'), icon: 'M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm8 0a3 3 0 1 0 0-6M2 21c0-3.5 2.7-6 6-6s6 2.5 6 6m2-6c2.8 0 6 1.8 6 5' },
  { href: '/progress', label: '진행', match: (p) => p.startsWith('/progress') || p.startsWith('/polls'), icon: 'M4 5h16M4 12h10M4 19h6m8-6 2 2 4-4' },
  { href: '/board', label: '소통', match: (p) => p.startsWith('/board'), icon: 'M4 5h16v11H9l-5 4z' },
];

function Icon({ d }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d={d} />
    </svg>
  );
}

function Shell({ children, path }) {
  const { state, run, syncing } = useApp();
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [path]);
  const isAdmin = state.me.role === 'admin';
  const logout = () => run(() => { clearCache(); return api.post('/auth/logout'); }).then(() => navigate('/', { replace: true }));
  const pending = myTodos(state).filter((t) => t.kind !== 'team').length;
  const showRail = !path.startsWith('/admin') && !path.startsWith('/rules');
  const moreActive = path.startsWith('/rules') || path.startsWith('/admin');

  return (
    <div class="shell">
      <header class="topbar">
        <Link href="/" class="brand">{state.event.title || 'JPOP 연합공연'}</Link>
        <nav class="topnav" aria-label="주 메뉴">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} class={cx(n.match(path) && 'on')} aria-current={n.match(path) ? 'page' : undefined}>
              {n.label}
              {n.href === '/progress' && pending > 0 && <b class="tab-badge">{pending}</b>}
            </Link>
          ))}
          <Link href="/rules" class={cx(path.startsWith('/rules') && 'on')}>운영규약</Link>
          {isAdmin && <Link href="/admin" class={cx(path.startsWith('/admin') && 'on')}>관리</Link>}
        </nav>
        {syncing && <span class="sync" role="status">동기화 중</span>}
        <div class="who">
          <span class="who-name">{state.me.label}</span>
          <span class="who-role">{state.me.roleLabel}</span>
          <button class="link-btn" onClick={logout}>로그아웃</button>
        </div>
      </header>

      <div class={cx('layout', showRail && 'with-rail')}>
        <main class="main" id="main">{children}</main>
        {showRail && <Rail />}
      </div>

      <nav class="tabbar" aria-label="주 메뉴">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} class={cx(n.match(path) && 'on')} aria-current={n.match(path) ? 'page' : undefined}>
            <Icon d={n.icon} />
            <span>{n.label}</span>
            {n.href === '/progress' && pending > 0 && <b class="tab-badge" aria-label={`할 일 ${pending}개`}>{pending}</b>}
          </Link>
        ))}
        <button class={cx(moreActive && 'on')} onClick={() => setMenu((m) => !m)} aria-expanded={menu}>
          <Icon d="M5 12h.01M12 12h.01M19 12h.01" />
          <span>더보기</span>
        </button>
      </nav>
      {menu && (
        <div class="sheet-backdrop" onClick={() => setMenu(false)}>
          <div class="sheet" onClick={(e) => e.stopPropagation()}>
            <p class="sheet-who">{state.me.label} <span>{state.me.roleLabel}</span></p>
            <Link href="/rules">운영규약</Link>
            {isAdmin && <Link href="/admin">관리</Link>}
            <button onClick={logout}>로그아웃</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Router() {
  const path = usePath();
  const { state, status, reload } = useApp();

  if (status === 'loading') {
    return (
      <div class="boot">
        <div class="boot-tone" aria-hidden="true" />
        <p>불러오는 중</p>
        <p class="boot-hint">서버가 잠들어 있었다면 최대 1분 정도 걸립니다.</p>
      </div>
    );
  }
  if (status === 'error' && !state) {
    return (
      <div class="boot">
        <p>서버에 연결하지 못했습니다.</p>
        <button class="btn btn-primary" onClick={reload}>다시 시도</button>
      </div>
    );
  }
  if (status === 'anon' || !state) {
    if (path.startsWith('/rules')) return <Rules publicView />;
    return <Login />;
  }

  let page;
  if (path === '/') page = <Home />;
  else if (path.startsWith('/teams')) page = <Teams teamId={path.split('/')[2]} />;
  else if (path.startsWith('/progress')) page = <Progress />;
  else if (path.startsWith('/polls')) page = <Polls />;
  else if (path.startsWith('/board')) {
    const [, , tab, id] = path.split('/');
    page = <Board tab={tab} openId={id} />;
  } else if (path.startsWith('/rules')) page = <Rules />;
  else if (path.startsWith('/admin') && state.me.role === 'admin') page = <Admin tab={path.split('/')[2]} />;
  else page = <div class="empty"><p>없는 페이지입니다.</p><Link href="/">홈으로</Link></div>;

  return <Shell path={path}>{page}</Shell>;
}

render(
  <AppProvider>
    <Router />
  </AppProvider>,
  document.getElementById('app'),
);
