import { Link, useApp } from '../app.jsx';
import { relativeTime, teamStyle } from '../util.js';

/** 데스크톱 오른쪽 고정 레일: 기존 사이트의 '취합 중인 데이터 / 진행 중인 투표 / 최근 게시글' 패널 */
export function Rail() {
  const { state } = useApp();
  const { collections, polls, posts, teams, me } = state;
  const open = collections.filter((c) => c.status === 'open');
  const livePolls = polls.filter((p) => p.isOpen);
  const teamById = Object.fromEntries(teams.map((t) => [t.id, t]));

  return (
    <aside class="rail" aria-label="진행 요약">
      <section class="rail-box">
        <header><h2>취합 중</h2><Link href="/progress">전체</Link></header>
        {open.length ? (
          <ul>
            {open.map((c) => {
              const counts = { done: 0, doing: 0, todo: 0 };
              c.targetTeamIds.forEach((id) => { counts[c.progress[id]?.status || 'todo'] += 1; });
              const mine = me.teamId && c.targetTeamIds.includes(me.teamId) ? c.progress[me.teamId]?.status || 'todo' : null;
              return (
                <li key={c.id}>
                  <Link href="/progress" class="rail-item">
                    <strong>{c.title}</strong>
                    <span class="rail-meter" aria-hidden="true">
                      {c.targetTeamIds.map((id) => <i key={id} class={`st-${c.progress[id]?.status || 'todo'}`} style={teamStyle(teamById[id]?.themeColor)} />)}
                    </span>
                    <span class="rail-sub">
                      완료 {counts.done}, 작성중 {counts.doing}, 대기 {counts.todo}
                      {mine && mine !== 'done' && <em>우리 팀 {mine === 'doing' ? '작성중' : '대기'}</em>}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : <p class="rail-empty">진행 중인 취합이 없습니다.</p>}
      </section>

      <section class="rail-box">
        <header><h2>진행 중 투표</h2><Link href="/polls">전체</Link></header>
        {livePolls.length ? (
          <ul>
            {livePolls.map((p) => (
              <li key={p.id}>
                <Link href={`/polls#${p.id}`} class="rail-item">
                  <strong>{p.title}</strong>
                  <span class="rail-sub">
                    {p.targetTeamId ? teamById[p.targetTeamId]?.name : '전체 팀'}, {p.totalVotes}표
                    {p.myVote ? <em class="ok">투표함</em> : <em>아직 안 함</em>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : <p class="rail-empty">진행 중인 투표가 없습니다.</p>}
      </section>

      <section class="rail-box">
        <header><h2>최근 게시글</h2><Link href="/board/posts">전체</Link></header>
        {posts.length ? (
          <ul>
            {posts.slice(0, 5).map((p) => (
              <li key={p.id}>
                <Link href={`/board/posts/${p.id}`} class="rail-item">
                  <strong>{p.title}</strong>
                  <span class="rail-sub">{p.author}, {relativeTime(p.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : <p class="rail-empty">아직 글이 없습니다.</p>}
      </section>
    </aside>
  );
}
