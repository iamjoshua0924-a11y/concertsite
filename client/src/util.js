/** 한국시간 기준 오늘 YYYY-MM-DD */
export function todayKst(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export function daysUntil(dateStr, now = new Date()) {
  if (!dateStr) return null;
  const a = Date.parse(`${todayKst(now)}T00:00:00Z`);
  const b = Date.parse(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

export function ddayLabel(n) {
  if (n == null) return '';
  if (n === 0) return 'D-DAY';
  return n > 0 ? `D-${n}` : `D+${-n}`;
}

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
export function formatDate(dateStr, { withYear = false, withWeekday = true } = {}) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00+09:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  const y = d.getFullYear();
  const s = `${d.getMonth() + 1}월 ${d.getDate()}일`;
  const w = withWeekday ? ` (${WEEK[d.getDay()]})` : '';
  return (withYear ? `${y}년 ` : '') + s + w;
}

export function relativeTime(iso, now = Date.now()) {
  if (!iso) return '';
  const diff = (now - Date.parse(iso)) / 1000;
  if (diff < 60) return '방금';
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}일 전`;
  return formatDate(new Date(Date.parse(iso) + 9 * 3600 * 1000).toISOString().slice(0, 10), { withWeekday: false });
}

export function formatDuration(sec) {
  if (sec == null || sec === '') return '';
  const s = Number(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function setlistSeconds(setlist = []) {
  return setlist.reduce((acc, s) => acc + (Number(s.duration) || 0), 0);
}

function toMin(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function toHhmm(min) {
  const h = Math.floor(min / 60) % 24;
  return `${String(h).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/** 팀 순서 + 배정 시간 + 전환 시간 → 예상 타임라인 */
export function buildTimeline(event, teams) {
  const start = toMin(event.startTime);
  const slot = Number(event.slotMinutes) || 40;
  const gap = Number(event.changeoverMinutes) || 0;
  if (start == null || !teams.length) return null;
  let t = start;
  const rows = teams.map((team, i) => {
    const songs = Math.ceil(setlistSeconds(team.setlist) / 60);
    const missing = team.setlist.filter((x) => !x.duration).length;
    const row = { team, index: i + 1, start: toHhmm(t), end: toHhmm(t + slot), songsMinutes: songs, missing, over: songs > slot };
    t += slot + (i < teams.length - 1 ? gap : 0);
    return row;
  });
  const end = toMin(event.endTime);
  return { rows, end: toHhmm(t), overrun: end != null ? t - end : 0, slot, gap };
}

export function teamStyle(color) {
  return color ? { '--team': color } : undefined;
}

export function cx(...args) {
  return args.filter(Boolean).join(' ');
}

export const COLLECTION_STATUS = {
  todo: { label: '대기', glyph: '○' },
  doing: { label: '작성중', glyph: '◐' },
  done: { label: '완료', glyph: '●' },
};

/** 내 팀 기준 해야 할 일 */
export function myTodos(state) {
  const { me, collections, polls, teams } = state;
  const items = [];
  const teamId = me.teamId;
  if (teamId) {
    for (const c of collections) {
      if (c.status !== 'open' || !c.targetTeamIds.includes(teamId)) continue;
      const st = c.progress[teamId]?.status || 'todo';
      if (st !== 'done') items.push({ kind: 'collection', id: c.id, title: c.title, due: c.dueDate, status: st, href: '/progress' });
    }
  }
  for (const p of polls) {
    if (!p.isOpen || p.myVote) continue;
    if (p.targetTeamId && p.targetTeamId !== teamId && me.role !== 'admin') continue;
    if (p.voteScope === 'team' && teamId && p.votedTeamIds.includes(teamId)) continue;
    items.push({ kind: 'poll', id: p.id, title: p.title, due: p.dueDate, href: `/polls#${p.id}` });
  }
  if (teamId && me.can.editOwnTeam) {
    const t = teams.find((x) => x.id === teamId);
    if (t) {
      const missing = [];
      if (!t.setlist.length) missing.push('셋리스트');
      if (!t.intro) missing.push('팀 소개');
      if (!t.images.length) missing.push('팀 이미지');
      if (missing.length) items.push({ kind: 'team', id: t.id, title: `${missing.join(', ')} 채우기`, href: `/teams/${t.id}` });
    }
  }
  return items.sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
}
