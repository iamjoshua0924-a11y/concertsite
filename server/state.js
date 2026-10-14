import { getSetting } from './db.js';
import { isAdmin, ROLE_LEVELS } from './auth.js';
import { isPastDueKst } from './lib/util.js';

export const DEFAULT_EVENT = {
  title: 'JPOP 연합공연',
  venue: '',
  eventDate: '',
  startTime: '18:00',
  endTime: '21:00',
  slotMinutes: 40,
  changeoverMinutes: 10,
  orderConfirmed: false,
  talkRoomUrl: '',
  notice: '',
  scheduleNote: '',
  links: [],
  posters: [],
};

export const COLLECTION_STATUSES = ['todo', 'doing', 'done'];

/** 투표 결과를 지금 이 세션에게 보여줘도 되는가 */
export function resultsVisible(poll, session) {
  if (isAdmin(session)) return true;
  if (poll.showResults !== 'afterClose') return true;
  return poll.status === 'closed' || isPastDueKst(poll.dueDate);
}

export function voterKeyFor(poll, session) {
  if (poll.voteScope === 'team' && session.teamId) return `team:${session.teamId}`;
  return `tok:${session.tokenId}`;
}

export function pollIsOpen(poll) {
  return poll.status !== 'closed' && !isPastDueKst(poll.dueDate);
}

/** 로그인 사용자에게 내려줄 전체 상태. 역할별로 민감 정보를 서버에서 걸러낸다. */
export async function buildState(db, session) {
  const admin = isAdmin(session);
  const level = ROLE_LEVELS[session.role] || 0;
  const [event, rules, teams, collections, polls, votes, meetings, questions, posts, activity] = await Promise.all([
    getSetting(db, 'event', DEFAULT_EVENT),
    getSetting(db, 'rules', { content: '' }),
    db.collection('teams').find().sort({ order: 1, name: 1 }).toArray(),
    db.collection('collections').find().sort({ createdAt: 1 }).toArray(),
    db.collection('polls').find().sort({ createdAt: -1 }).toArray(),
    db.collection('votes').find().toArray(),
    db.collection('meetings').find().sort({ pinned: -1, date: -1, createdAt: -1 }).toArray(),
    db.collection('questions').find().sort({ createdAt: -1 }).toArray(),
    db.collection('posts').find({ visible: { $ne: false } }).sort({ createdAt: -1 }).limit(100).toArray(),
    db.collection('activity').find().sort({ at: -1 }).limit(30).toArray(),
  ]);

  const teamName = Object.fromEntries(teams.map((t) => [t._id, t.name]));

  const eventOut = { ...event };
  delete eventOut._id;
  if (level < ROLE_LEVELS.leader) eventOut.talkRoomUrl = '';

  const teamsOut = teams.map((t) => {
    const canSeeContact = level >= ROLE_LEVELS.leader || session.teamId === t._id;
    return {
      id: t._id,
      name: t.name,
      intro: t.intro || '',
      snsUrl: t.snsUrl || '',
      memberCount: t.memberCount ?? null,
      instruments: t.instruments || '',
      leaderName: t.leaderName || '',
      leaderContact: canSeeContact ? t.leaderContact || '' : '',
      contactHidden: !canSeeContact && Boolean(t.leaderContact),
      themeColor: t.themeColor || '',
      order: t.order ?? 0,
      images: t.images || [],
      setlist: t.setlist || [],
      updatedAt: t.updatedAt || '',
    };
  });

  const votesByPoll = {};
  for (const v of votes) (votesByPoll[v.pollId] ||= []).push(v);

  const pollsOut = polls.map((p) => {
    const pv = votesByPoll[p._id] || [];
    const visible = resultsVisible(p, session);
    const myKey = voterKeyFor(p, session);
    const mine = pv.find((v) => v.voterKey === myKey);
    return {
      id: p._id,
      title: p.title,
      description: p.description || '',
      targetTeamId: p.targetTeamId || '',
      options: p.options.map((o) => ({ id: o.id, label: o.label, votes: visible ? pv.filter((v) => v.optionId === o.id).length : null })),
      totalVotes: pv.length,
      anonymous: Boolean(p.anonymous),
      voteScope: p.voteScope || 'person',
      showResults: p.showResults || 'always',
      resultsVisible: visible,
      dueDate: p.dueDate || '',
      status: p.status || 'open',
      isOpen: pollIsOpen(p),
      createdBy: p.createdBy || '',
      createdAt: p.createdAt,
      updatedAt: p.updatedAt || '',
      canEdit: admin || (p.createdByTokenId && p.createdByTokenId === session.tokenId),
      myVote: mine ? { optionId: mine.optionId, comment: mine.comment || '', name: mine.voterName || '' } : null,
      // 익명이면 이름·팀 모두 숨김. 결과 비공개 상태면 명단도 숨김
      voters: !p.anonymous && visible
        ? pv.map((v) => ({ optionId: v.optionId, name: v.voterName || '', teamName: teamName[v.teamId] || '', comment: v.comment || '' }))
        : [],
      votedTeamIds: p.anonymous && !admin ? [] : [...new Set(pv.map((v) => v.teamId).filter(Boolean))],
    };
  });

  const ownerOf = (doc) => admin || (doc.createdByTokenId && doc.createdByTokenId === session.tokenId);

  return {
    me: session,
    event: eventOut,
    rules: { content: rules.content || '', updatedAt: rules.updatedAt || '' },
    teams: teamsOut,
    collections: collections.map((c) => ({
      id: c._id,
      title: c.title,
      description: c.description || '',
      dueDate: c.dueDate || '',
      status: c.status || 'open',
      targetTeamIds: c.targetTeamIds?.length ? c.targetTeamIds : teams.map((t) => t._id),
      progress: c.progress || {},
      createdAt: c.createdAt,
    })),
    polls: pollsOut,
    meetings: meetings.map((m) => ({
      id: m._id,
      title: m.title,
      date: m.date || '',
      content: m.content || '',
      decisions: m.decisions || [],
      actions: m.actions || [],
      pinned: Boolean(m.pinned),
      author: m.author || '',
      attachments: m.attachments || [],
      createdAt: m.createdAt,
      updatedAt: m.updatedAt || '',
      canEdit: ownerOf(m),
    })),
    questions: questions.map((q) => ({
      id: q._id,
      title: q.title || '',
      question: q.question,
      author: q.author || '',
      teamId: q.teamId || '',
      answer: q.answer || '',
      answeredBy: q.answeredBy || '',
      answeredAt: q.answeredAt || '',
      attachments: q.attachments || [],
      createdAt: q.createdAt,
      canEdit: ownerOf(q),
    })),
    posts: posts.map((p) => ({
      id: p._id,
      title: p.title,
      content: p.content,
      author: p.author || '',
      createdAt: p.createdAt,
      updatedAt: p.updatedAt || '',
      // 수정은 글쓴이만(같은 비밀번호로 쓴 글이거나 글 비밀번호를 아는 경우). 삭제는 총괄대표도 가능
      canEdit: Boolean(p.createdByTokenId && p.createdByTokenId === session.tokenId),
      hasPassword: Boolean(p.passwordHash),
      attachments: p.attachments || [],
      canDelete: ownerOf(p),
    })),
    activity: activity.map((a) => ({ type: a.type, text: a.text, teamId: a.teamId || '', href: a.href || '', at: a.at })),
    serverTime: new Date().toISOString(),
  };
}
