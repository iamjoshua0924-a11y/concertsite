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
  router.post('/polls', requireRole('admin'), async (req, res) => {
    const b = req.body || {};
    const labels = (Array.isArray(b.options) ? b.options : [])
      .map((o) => text(typeof o === 'string' ? o : o?.label, { name: '선택지', max: 100 }))
      .filter(Boolean);
    if (labels.length < 2) throw badRequest('선택지는 2개 이상 필요합니다.');
    if (labels.length > 20) throw badRequest('선택지는 20개까지 가능합니다.');
    const targetTeamId = b.targetTeamId ? (await validTeamIds([b.targetTeamId]))[0] || '' : '';
    const doc = {
      _id: newId('poll'),
      title: text(b.title, { name: '투표 제목', max: 120, required: true }),
      description: text(b.description, { name: '설명', max: 2000 }),
      targetTeamId,
      options: labels.map((label) => ({ id: newId('opt'), label })),
      anonymous: Boolean(b.anonymous),
      voteScope: b.voteScope === 'team' ? 'team' : 'person',
      showResults: b.showResults === 'afterClose' ? 'afterClose' : 'always',
      dueDate: optionalDate(b.dueDate, '마감일'),
      status: 'open',
      createdBy: req.session.label,
      createdAt: nowIso(),
    };
    await polls.insertOne(doc);
    await logActivity(db, { type: 'poll', text: `새 투표: ${doc.title}`, href: '/polls' });
    res.json({ ok: true, id: doc._id });
  });

  router.patch('/polls/:id', requireRole('admin'), async (req, res) => {
    const b = req.body || {};
    const set = {};
    if ('status' in b) {
      if (!['open', 'closed'].includes(b.status)) throw badRequest('상태 값이 올바르지 않습니다.');
      set.status = b.status;
    }
    if ('dueDate' in b) set.dueDate = optionalDate(b.dueDate, '마감일');
    if ('title' in b) set.title = text(b.title, { name: '투표 제목', max: 120, required: true });
    if ('description' in b) set.description = text(b.description, { name: '설명', max: 2000 });
    const r = await polls.updateOne({ _id: req.params.id }, { $set: set });
    if (!r.matchedCount) throw notFound();
    res.json({ ok: true });
  });

  router.delete('/polls/:id', requireRole('admin'), async (req, res) => {
    await polls.deleteOne({ _id: req.params.id });
    await votes.deleteMany({ pollId: req.params.id });
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
