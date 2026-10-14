import { assertTeamAccess, isAdmin, requireRole } from '../auth.js';
import { logActivity } from '../db.js';
import { badRequest, forbidden, newId, notFound, nowIso, optionalDate, text } from '../lib/util.js';
import { COLLECTION_STATUSES, pollIsOpen, voterKeyFor } from '../state.js';

const STATUS_LABEL = { todo: '대기', doing: '작성중', done: '완료' };

export function progressRoutes(router, { db }) {
  const collections = db.collection('collections');
  const polls = db.collection('polls');
  const votes = db.collection('votes');
  const teams = db.collection('teams');

  async function validTeamIds(ids) {
    if (!Array.isArray(ids)) return [];
    const all = (await teams.find({}, { projection: { _id: 1 } }).toArray()).map((t) => t._id);
    return ids.map(String).filter((id) => all.includes(id));
  }

  /* ---------- 취합 ---------- */
  router.post('/collections', requireRole('admin'), async (req, res) => {
    const b = req.body || {};
    const doc = {
      _id: newId('col'),
      title: text(b.title, { name: '취합 항목명', max: 100, required: true }),
      description: text(b.description, { name: '설명', max: 2000 }),
      dueDate: optionalDate(b.dueDate, '마감일'),
      targetTeamIds: await validTeamIds(b.targetTeamIds),
      status: 'open',
      progress: {},
      createdBy: req.session.label,
      createdAt: nowIso(),
    };
    await collections.insertOne(doc);
    await logActivity(db, { type: 'collection', text: `취합 요청: ${doc.title}`, href: '/progress' });
    res.json({ ok: true, id: doc._id });
  });

  router.patch('/collections/:id', requireRole('admin'), async (req, res) => {
    const b = req.body || {};
    const set = {};
    if ('title' in b) set.title = text(b.title, { name: '취합 항목명', max: 100, required: true });
    if ('description' in b) set.description = text(b.description, { name: '설명', max: 2000 });
    if ('dueDate' in b) set.dueDate = optionalDate(b.dueDate, '마감일');
    if ('targetTeamIds' in b) set.targetTeamIds = await validTeamIds(b.targetTeamIds);
    if ('status' in b) {
      if (!['open', 'closed'].includes(b.status)) throw badRequest('상태 값이 올바르지 않습니다.');
      set.status = b.status;
    }
    const r = await collections.updateOne({ _id: req.params.id }, { $set: set });
    if (!r.matchedCount) throw notFound();
    res.json({ ok: true });
  });

  router.delete('/collections/:id', requireRole('admin'), async (req, res) => {
    await collections.deleteOne({ _id: req.params.id });
    res.json({ ok: true });
  });

  router.put('/collections/:id/progress/:teamId', requireRole('member'), async (req, res) => {
    const { id, teamId } = req.params;
    assertTeamAccess(req.session, teamId);
    const col = await collections.findOne({ _id: id });
    if (!col) throw notFound('취합 항목을 찾을 수 없습니다.');
    if (col.status === 'closed' && !isAdmin(req.session)) throw forbidden('마감된 취합 항목입니다.');
    if (col.targetTeamIds?.length && !col.targetTeamIds.includes(teamId)) throw badRequest('이 항목의 대상 팀이 아닙니다.');
    const status = String(req.body?.status || '');
    if (!COLLECTION_STATUSES.includes(status)) throw badRequest('상태 값이 올바르지 않습니다.');
    const entry = { status, note: text(req.body?.note, { name: '메모', max: 500 }), updatedBy: req.session.label, updatedAt: nowIso() };
    await collections.updateOne({ _id: id }, { $set: { [`progress.${teamId}`]: entry } });
    const team = await teams.findOne({ _id: teamId }, { projection: { name: 1 } });
    await logActivity(db, { type: 'progress', text: `${team?.name || teamId}: ${col.title} → ${STATUS_LABEL[status]}`, teamId, href: '/progress' });
    res.json({ ok: true, entry });
  });

  /* ---------- 투표 ---------- */
  /** 투표 작성자 또는 총괄대표만 */
  async function editablePoll(req) {
    const poll = await polls.findOne({ _id: req.params.id });
    if (!poll) throw notFound('투표를 찾을 수 없습니다.');
    if (!isAdmin(req.session) && poll.createdByTokenId !== req.session.tokenId) {
      throw forbidden('투표를 만든 사람 또는 총괄대표만 수정할 수 있습니다.');
    }
    return poll;
  }

  function optionInputs(list) {
    const arr = (Array.isArray(list) ? list : [])
      .map((o) => (typeof o === 'string' ? { label: o } : o || {}))
      .map((o) => ({ id: typeof o.id === 'string' ? o.id : '', label: text(o.label, { name: '선택지', max: 100 }) }))
      .filter((o) => o.label);
    if (arr.length < 2) throw badRequest('선택지는 2개 이상 필요합니다.');
    if (arr.length > 20) throw badRequest('선택지는 20개까지 가능합니다.');
    return arr;
  }

  // 팀 대표 이상이 투표를 만들 수 있다
  router.post('/polls', requireRole('leader'), async (req, res) => {
    const b = req.body || {};
    const options = optionInputs(b.options);
    const targetTeamId = b.targetTeamId ? (await validTeamIds([b.targetTeamId]))[0] || '' : '';
    const doc = {
      _id: newId('poll'),
      title: text(b.title, { name: '투표 제목', max: 120, required: true }),
      description: text(b.description, { name: '설명', max: 2000 }),
      targetTeamId,
      options: options.map((o) => ({ id: newId('opt'), label: o.label })),
      anonymous: Boolean(b.anonymous),
      voteScope: b.voteScope === 'team' ? 'team' : 'person',
      showResults: b.showResults === 'afterClose' ? 'afterClose' : 'always',
      dueDate: optionalDate(b.dueDate, '마감일'),
      status: 'open',
      createdBy: req.session.label,
      createdByTokenId: req.session.tokenId,
      createdAt: nowIso(),
    };
    await polls.insertOne(doc);
    await logActivity(db, { type: 'poll', text: `새 투표: ${doc.title}`, href: `/polls#${doc._id}` });
    res.json({ ok: true, id: doc._id });
  });

  /**
   * 진행 중 수정. 표가 이미 있으면:
   *  - 익명 → 실명 전환 금지 (기존 투표자 노출)
   *  - 1인1표 ↔ 팀당1표 전환 금지 (집계 기준이 바뀜)
   *  - 삭제된 선택지의 표는 함께 삭제
   */
  router.patch('/polls/:id', requireRole('member'), async (req, res) => {
    const poll = await editablePoll(req);
    const b = req.body || {};
    const voteCount = await votes.countDocuments({ pollId: poll._id });
    const set = {};
    if ('status' in b) {
      if (!['open', 'closed'].includes(b.status)) throw badRequest('상태 값이 올바르지 않습니다.');
      set.status = b.status;
    }
    if ('dueDate' in b) set.dueDate = optionalDate(b.dueDate, '마감일');
    if ('title' in b) set.title = text(b.title, { name: '투표 제목', max: 120, required: true });
    if ('description' in b) set.description = text(b.description, { name: '설명', max: 2000 });
    if ('targetTeamId' in b) set.targetTeamId = b.targetTeamId ? (await validTeamIds([b.targetTeamId]))[0] || '' : '';
    if ('showResults' in b) set.showResults = b.showResults === 'afterClose' ? 'afterClose' : 'always';
    if ('anonymous' in b) {
      const next = Boolean(b.anonymous);
      if (poll.anonymous && !next && voteCount > 0) throw badRequest('이미 표가 있는 익명 투표는 실명으로 바꿀 수 없습니다.');
      set.anonymous = next;
    }
    if ('voteScope' in b) {
      const next = b.voteScope === 'team' ? 'team' : 'person';
      if (next !== (poll.voteScope || 'person') && voteCount > 0) throw badRequest('이미 표가 있으면 투표 단위(1인/팀)를 바꿀 수 없습니다.');
      set.voteScope = next;
    }
    let removedIds = [];
    if ('options' in b) {
      const known = new Set(poll.options.map((o) => o.id));
      const next = optionInputs(b.options).map((o) => ({ id: known.has(o.id) ? o.id : newId('opt'), label: o.label }));
      const keep = new Set(next.map((o) => o.id));
      removedIds = poll.options.filter((o) => !keep.has(o.id)).map((o) => o.id);
      set.options = next;
    }
    set.updatedAt = nowIso();
    await polls.updateOne({ _id: poll._id }, { $set: set });
    let removedVotes = 0;
    if (removedIds.length) removedVotes = (await votes.deleteMany({ pollId: poll._id, optionId: { $in: removedIds } })).deletedCount;
    if ('options' in b || 'title' in b || 'description' in b) {
      await logActivity(db, { type: 'poll', text: `투표 내용 수정: ${set.title || poll.title}`, href: `/polls#${poll._id}` });
    }
    res.json({ ok: true, removedVotes });
  });

  router.delete('/polls/:id', requireRole('member'), async (req, res) => {
    const poll = await editablePoll(req);
    await polls.deleteOne({ _id: poll._id });
    await votes.deleteMany({ pollId: poll._id });
    res.json({ ok: true });
  });

  async function openPollFor(req) {
    const poll = await polls.findOne({ _id: req.params.id });
    if (!poll) throw notFound('투표를 찾을 수 없습니다.');
    if (!pollIsOpen(poll)) throw forbidden('마감된 투표입니다.');
    if (poll.targetTeamId && !isAdmin(req.session) && req.session.teamId !== poll.targetTeamId) {
      throw forbidden('이 투표의 대상 팀이 아닙니다.');
    }
    return poll;
  }

  /** 투표/변경: (pollId, voterKey) 유니크 → 중복 투표 불가, 재투표 시 선택 변경 */
  router.put('/polls/:id/vote', requireRole('member'), async (req, res) => {
    const poll = await openPollFor(req);
    const optionId = String(req.body?.optionId || '');
    if (!poll.options.some((o) => o.id === optionId)) throw badRequest('선택지가 올바르지 않습니다.');
    const name = poll.anonymous ? '' : text(req.body?.name || req.session.label, { name: '이름', max: 40, required: true });
    const voterKey = voterKeyFor(poll, req.session);
    await votes.updateOne(
      { pollId: poll._id, voterKey },
      {
        $set: { optionId, voterName: name, teamId: req.session.teamId || '', comment: text(req.body?.comment, { name: '메모', max: 200 }), updatedAt: nowIso() },
        $setOnInsert: { _id: newId('vote'), createdAt: nowIso() },
      },
      { upsert: true },
    );
    res.json({ ok: true });
  });

  router.delete('/polls/:id/vote', requireRole('member'), async (req, res) => {
    const poll = await openPollFor(req);
    await votes.deleteOne({ pollId: poll._id, voterKey: voterKeyFor(poll, req.session) });
    res.json({ ok: true });
  });
}
