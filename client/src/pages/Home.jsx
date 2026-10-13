import { useState } from 'preact/hooks';
import { api, fileUrl } from '../api.js';
import { Link, useApp } from '../app.jsx';
import { Button, DueBadge, Field, Lightbox, Modal, RichText, StatusGlyph, TeamChip, useForm } from '../components/ui.jsx';
import { ImportButton } from './Admin.jsx';
import { buildTimeline, daysUntil, ddayLabel, formatDate, myTodos, relativeTime, teamStyle } from '../util.js';

/** 홈에서 바로 고치는 공연 정보 (기존 사이트의 '메인 정보 편집') */
function EventQuickEdit({ event, onClose, focus }) {
  const { run } = useApp();
  const f = useForm({
    title: event.title, venue: event.venue, eventDate: event.eventDate, startTime: event.startTime, endTime: event.endTime,
    notice: event.notice, scheduleNote: event.scheduleNote,
  });
  const save = () => run(() => api.patch('/event', f.values), '저장했습니다.').then(onClose);
  return (
    <Modal title={focus === 'notice' ? '공지 수정' : '공연 정보 수정'} onClose={onClose} wide>
      <div class="form-grid">
        {focus === 'notice' ? (
          <Field label="공지사항 / 전달사항" wide><textarea rows={8} {...f.bind('notice')} /></Field>
        ) : (
          <>
            <Field label="공연명" wide><input {...f.bind('title')} /></Field>
            <Field label="장소"><input {...f.bind('venue')} /></Field>
            <Field label="공연일"><input type="date" {...f.bind('eventDate')} /></Field>
            <Field label="시작"><input type="time" {...f.bind('startTime')} /></Field>
            <Field label="대관 종료"><input type="time" {...f.bind('endTime')} /></Field>
            <Field label="공연·리허설 순서 메모" wide><textarea rows={3} {...f.bind('scheduleNote')} /></Field>
            <Field label="공지사항 / 전달사항" wide><textarea rows={4} {...f.bind('notice')} /></Field>
          </>
        )}
      </div>
      <p class="fineprint">톡방 링크, 팀당 시간, 공연 순서, 바로가기 링크는 <Link href="/admin/event">관리 → 공연 정보</Link>에서 바꿉니다.</p>
      <div class="row-actions">
        <Button variant="quiet" onClick={onClose}>취소</Button>
        <Button variant="primary" onClick={save}>저장</Button>
      </div>
    </Modal>
  );
}

function Hero({ event, teams, onEdit }) {
  const [lightbox, setLightbox] = useState(false);
  const dday = daysUntil(event.eventDate);
  const poster = event.posters?.[0];
  return (
    <section class="hero tone">
      {onEdit && <button class="hero-edit" onClick={onEdit}>편집</button>}
      <div class="hero-text">
        {dday != null && <p class="hero-dday" aria-label={`공연까지 ${dday}일`}>{ddayLabel(dday)}</p>}
        <h1 class="hero-title">{event.title}</h1>
        <dl class="hero-facts">
          <div><dt>날짜</dt><dd>{event.eventDate ? formatDate(event.eventDate, { withYear: true }) : '미정'}</dd></div>
          <div><dt>시간</dt><dd>{event.startTime && event.endTime ? `${event.startTime}–${event.endTime}` : '미정'}</dd></div>
          <div><dt>장소</dt><dd>{event.venue || '미정'}</dd></div>
        </dl>
        {teams.length > 0 && (
          <ul class="hero-lineup" aria-label="참가 팀">
            {teams.map((t) => (
              <li key={t.id} style={teamStyle(t.themeColor)}><Link href={`/teams/${t.id}`}>{t.name}</Link></li>
            ))}
          </ul>
        )}
      </div>
      {poster && (
        <button class="hero-poster" onClick={() => setLightbox(true)} aria-label="포스터 크게 보기">
          <img src={fileUrl(poster.fileId)} alt="공연 포스터" />
        </button>
      )}
      {lightbox && <Lightbox images={event.posters} index={0} onClose={() => setLightbox(false)} />}
    </section>
  );
}

function Todos({ state }) {
  const items = myTodos(state);
  const team = state.teams.find((t) => t.id === state.me.teamId);
  return (
    <section class="block">
      <header class="block-head">
        <h2>{team ? '우리 팀 할 일' : '내가 할 일'}</h2>
        {items.length > 0 && <span class="count">{items.length}</span>}
      </header>
      {items.length ? (
        <ul class="todo-list">
          {items.map((it) => (
            <li key={it.kind + it.id}>
              <Link href={it.href}>
                <span class="todo-kind">{it.kind === 'poll' ? '투표' : it.kind === 'collection' ? '제출' : '팀 정보'}</span>
                <span class="todo-title">{it.title}</span>
                {it.status && <StatusGlyph status={it.status} />}
                <DueBadge due={it.due} dday={daysUntil(it.due)} />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p class="all-clear">밀린 일이 없습니다.</p>
      )}
    </section>
  );
}

/** 총괄대표용: 항목별 미완료 팀 */
function Overview({ state }) {
  const open = state.collections.filter((c) => c.status === 'open');
  const polls = state.polls.filter((p) => p.isOpen);
  if (!open.length && !polls.length) return null;
  const teamName = Object.fromEntries(state.teams.map((t) => [t.id, t]));
  return (
    <section class="block">
      <header class="block-head">
        <h2>팀별 진행</h2>
        <Link href="/progress" class="more">전체 보기</Link>
      </header>
      <ul class="overview">
        {open.map((c) => {
          const pending = c.targetTeamIds.filter((id) => c.progress[id]?.status !== 'done');
          return (
            <li key={c.id}>
              <span class="ov-title">{c.title}</span>
              <span class="ov-meter" aria-label={`${c.targetTeamIds.length}팀 중 ${c.targetTeamIds.length - pending.length}팀 완료`}>
                {c.targetTeamIds.map((id) => <i key={id} class={c.progress[id]?.status === 'done' ? 'on' : ''} style={teamStyle(teamName[id]?.themeColor)} />)}
              </span>
              <span class="ov-left">{pending.length ? `${pending.length}팀 남음` : '완료'}</span>
            </li>
          );
        })}
        {polls.map((p) => (
          <li key={p.id}>
            <span class="ov-title">투표: {p.title}</span>
            <span class="ov-left">{p.totalVotes}표</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Timeline({ event, teams, isAdmin }) {
  const tl = buildTimeline(event, teams);
  return (
    <section class="block panel">
      <header class="block-head">
        <h2>공연 순서</h2>
        <span class={event.orderConfirmed ? 'tag tag-solid' : 'tag'}>{event.orderConfirmed ? '확정' : '가안'}</span>
        {isAdmin && <Link href="/admin/event" class="more">순서·시간 설정</Link>}
      </header>
      {tl ? (
        <ol class="timeline">
          {tl.rows.map((r) => (
            <li key={r.team.id} style={teamStyle(r.team.themeColor)}>
              <span class="tl-time">{r.start}</span>
              <span class="tl-bar" aria-hidden="true" />
              <div class="tl-body">
                <Link href={`/teams/${r.team.id}`} class="tl-team">{r.index}. {r.team.name}</Link>
                <span class={r.over ? 'tl-meta tl-over' : 'tl-meta'}>
                  {r.team.setlist.length ? `곡 ${r.songsMinutes}분 / 배정 ${tl.slot}분` : `셋리스트 미입력, 배정 ${tl.slot}분`}
                  {r.missing > 0 && r.team.setlist.length > 0 && `, ${r.missing}곡 시간 미입력`}
                  {r.over && ', 초과'}
                </span>
              </div>
            </li>
          ))}
          <li class="tl-end">
            <span class="tl-time">{tl.end}</span>
            <span class="tl-bar" aria-hidden="true" />
            <div class="tl-body">
              <span class="tl-team">종료 예상</span>
              {tl.overrun > 0 && <span class="tl-meta tl-over">대관 종료 {event.endTime}보다 {tl.overrun}분 늦음</span>}
            </div>
          </li>
        </ol>
      ) : (
        <p class="muted">시작 시간과 팀이 정해지면 예상 순서가 표시됩니다.</p>
      )}
      <p class="fineprint">팀당 {tl?.slot ?? event.slotMinutes}분, 전환 {event.changeoverMinutes}분 기준 예상 시각입니다.</p>
      {event.scheduleNote && <RichText class="schedule-note" text={event.scheduleNote} />}
    </section>
  );
}

function Activity({ items, teams }) {
  if (!items.length) return null;
  const byId = Object.fromEntries(teams.map((t) => [t.id, t]));
  return (
    <section class="block">
      <header class="block-head"><h2>최근 소식</h2></header>
      <ul class="activity">
        {items.slice(0, 12).map((a, i) => (
          <li key={i}>
            {a.href ? <Link href={a.href}>{a.text}</Link> : <span>{a.text}</span>}
            <span class="act-meta">
              {a.teamId && byId[a.teamId] && <TeamChip team={byId[a.teamId]} small />}
              <time dateTime={a.at}>{relativeTime(a.at)}</time>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Home() {
  const { state } = useApp();
  const { event, teams, me } = state;
  const isAdmin = me.role === 'admin';
  const [edit, setEdit] = useState(null);

  if (isAdmin && !teams.length) {
    return (
      <div class="home">
        <section class="onboard tone">
          <h1>새 사이트가 준비됐습니다</h1>
          <p>기존 Apps Script 사이트의 팀, 셋리스트, 이미지, 취합, 투표, 운영규약, 공지를 한 번에 가져옵니다.</p>
          <ol>
            <li>컴퓨터의 <strong>바탕화면 &gt; 소통사이트</strong> 폴더에 있는 <code>import-data.json</code>을 선택하세요.</li>
            <li>가져오기가 끝나면 사람별 새 비밀번호와 접속 링크가 표시됩니다. 각자에게 보내세요.</li>
          </ol>
          <div class="onboard-actions">
            <ImportButton label="기존 데이터 가져오기" />
            <Link href="/admin/teams" class="btn btn-default">처음부터 팀 만들기</Link>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div class="home">
      <Hero event={event} teams={teams} onEdit={isAdmin ? () => setEdit('event') : null} />
      <div class="home-grid">
        <div class="col">
          {me.teamId || !isAdmin ? <Todos state={state} /> : null}
          {isAdmin && <div class="home-overview"><Overview state={state} /></div>}
          <Timeline event={event} teams={teams} isAdmin={isAdmin} />
        </div>
        <div class="col">
          {(event.notice || isAdmin) && (
            <section class="block notice">
              <header class="block-head">
                <h2>공지</h2>
                {isAdmin && <Button small variant="quiet" onClick={() => setEdit('notice')}>수정</Button>}
              </header>
              {event.notice ? <RichText text={event.notice} /> : <p class="muted">공지사항이 없습니다.</p>}
            </section>
          )}
          {(event.talkRoomUrl || event.links?.length > 0) && (
            <section class="block">
              <header class="block-head"><h2>바로가기</h2></header>
              <ul class="links">
                {event.talkRoomUrl && <li><a href={event.talkRoomUrl} target="_blank" rel="noopener">대표자 톡방</a></li>}
                {event.links?.map((l) => <li key={l.url}><a href={l.url} target="_blank" rel="noopener">{l.label}</a></li>)}
              </ul>
            </section>
          )}
          <div class="home-activity"><Activity items={state.activity} teams={teams} /></div>
        </div>
      </div>
      {edit && <EventQuickEdit event={event} focus={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}
