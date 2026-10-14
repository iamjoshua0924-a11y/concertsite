import { isAdmin, requireRole, ROLE_LEVELS } from '../auth.js';
import { logActivity } from '../db.js';
import { deleteFile, resolveAttachments, storeUploaded, streamFile, uploadMiddleware } from '../files.js';
import {
  badRequest, forbidden, HttpError, newId, notFound, nowIso, optionalDate, scryptHash, scryptVerify, text,
} from '../lib/util.js';

function lines(value, max = 30) {
  const arr = Array.isArray(value) ? value : String(value || '').split('\n');
  return arr.map((s) => text(s, { name: '항목', max: 300 })).filter(Boolean).slice(0, max);
}

function actions(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 30).map((a) => ({
    id: typeof a.id === 'string' && a.id ? a.id.slice(0, 40) : newId('act'),
    text: text(a.text, { name: '할 일', max: 300, required: true }),
    owner: text(a.owner, { name: '담당', max: 60 }),
    due: optionalDate(a.due, '기한'),
    done: Boolean(a.done),
  }));
}

export function boardRoutes(router, { db, bucket }) {
  const meetings = db.collection('meetings');
  const questions = db.collection('questions');
  const posts = db.collection('posts');

  const canEdit = (session, doc) => isAdmin(session) || (doc.createdByTokenId && doc.createdByTokenId === session.tokenId);

  /* ---------- 파일 ---------- */
  router.post('/files', requireRole('member'), uploadMiddleware.array('files', 10), async (req, res) => {
    const files = await storeUploaded(bucket, req.files, { meta: { kind: 'attachment', by: req.session.tokenId } });
    res.json({ ok: true, files });
  });

  router.get('/files/:id', async (req, res) => {
    if (!req.session) throw new HttpError(401, '로그인이 필요합니다.');
    await streamFile(bucket, req.params.id, res);
  });

  /* ---------- 회의록 ---------- */
  async function meetingFields(b, session) {
    return {
      title: text(b.title, { name: '제목', max: 120, required: true }),
      date: optionalDate(b.date, '회의 날짜'),
      content: text(b.content, { name: '내용', max: 20000 }),
      decisions: lines(b.decisions),
      actions: actions(b.actions),
      // 상단 고정은 대표 이상만
      pinned: (ROLE_LEVELS[session.role] || 0) >= ROLE_LEVELS.leader ? Boolean(b.pinned) : false,
      attachments: await resolveAttachments(bucket, b.attachments),
    };
  }

  router.post('/meetings', requireRole('member'), async (req, res) => {
    const doc = {
      _id: newId('mtg'),
      ...(await meetingFields(req.body || {}, req.session)),
      author: text(req.body?.author || req.session.label, { name: '작성자', max: 40 }),
      createdByTokenId: req.session.tokenId,
      createdAt: nowIso(),
    };
    await meetings.insertOne(doc);
    await logActivity(db, { type: 'meeting', text: `회의록: ${doc.title}`, href: `/board/meetings/${doc._id}` });
    res.json({ ok: true, id: doc._id });
  });

  router.patch('/meetings/:id', requireRole('member'), async (req, res) => {
    const doc = await meetings.findOne({ _id: req.params.id });
    if (!doc) throw notFound('회의록을 찾을 수 없습니다.');
    if (!canEdit(req.session, doc)) throw forbidden('작성자 또는 총괄대표만 수정할 수 있습니다.');
    const set = await meetingFields({ ...doc, ...req.body }, req.session);
    if (!('pinned' in (req.body || {}))) set.pinned = doc.pinned;
    await meetings.updateOne({ _id: doc._id }, { $set: { ...set, updatedAt: nowIso() } });
    res.json({ ok: true });
  });

  // 할 일 체크는 로그인한 누구나 (진행 공유가 목적)
  router.put('/meetings/:id/actions/:actionId', requireRole('member'), async (req, res) => {
    const r = await meetings.updateOne(
      { _id: req.params.id, 'actions.id': req.params.actionId },
      { $set: { 'actions.$.done': Boolean(req.body?.done) } },
    );
    if (!r.matchedCount) throw notFound('할 일을 찾을 수 없습니다.');
    res.json({ ok: true });
  });

  router.delete('/meetings/:id', requireRole('member'), async (req, res) => {
    const doc = await meetings.findOne({ _id: req.params.id });
    if (!doc) throw notFound();
    if (!canEdit(req.session, doc)) throw forbidden('작성자 또는 총괄대표만 삭제할 수 있습니다.');
    await meetings.deleteOne({ _id: doc._id });
    for (const a of doc.attachments || []) await deleteFile(bucket, a.fileId);
    res.json({ ok: true });
  });

  /* ---------- 문의 ---------- */
  router.post('/questions', requireRole('member'), async (req, res) => {
    const b = req.body || {};
    const doc = {
      _id: newId('q'),
      title: text(b.title, { name: '제목', max: 120, required: true }),
      question: text(b.question, { name: '문의 내용', max: 5000, required: true }),
      author: text(b.author || req.session.label, { name: '작성자', max: 40 }),
      teamId: req.session.teamId || '',
      attachments: await resolveAttachments(bucket, b.attachments),
      createdByTokenId: req.session.tokenId,
      createdAt: nowIso(),
    };
    await questions.insertOne(doc);
    await logActivity(db, { type: 'question', text: `새 문의: ${doc.title}`, teamId: doc.teamId, href: `/board/questions/${doc._id}` });
    res.json({ ok: true, id: doc._id });
  });

  router.put('/questions/:id/answer', requireRole('admin'), async (req, res) => {
    const answer = text(req.body?.answer, { name: '답변', max: 5000 });
    const doc = await questions.findOne({ _id: req.params.id });
    if (!doc) throw notFound();
    await questions.updateOne({ _id: doc._id }, { $set: { answer, answeredBy: req.session.label, answeredAt: answer ? nowIso() : '' } });
    if (answer) await logActivity(db, { type: 'answer', text: `문의 답변: ${doc.title || doc.question.slice(0, 30)}`, teamId: doc.teamId, href: `/board/questions/${doc._id}` });
    res.json({ ok: true });
  });

  router.delete('/questions/:id', requireRole('member'), async (req, res) => {
    const doc = await questions.findOne({ _id: req.params.id });
    if (!doc) throw notFound();
    if (!canEdit(req.session, doc)) throw forbidden('작성자 또는 총괄대표만 삭제할 수 있습니다.');
    await questions.deleteOne({ _id: doc._id });
    for (const a of doc.attachments || []) await deleteFile(bucket, a.fileId);
    res.json({ ok: true });
  });

  /* ---------- 자유게시판 ---------- */
  router.post('/posts', requireRole('member'), async (req, res) => {
    const b = req.body || {};
    const password = String(b.password || '');
    if (password && password.length < 4) throw badRequest('비밀번호는 4자 이상으로 입력하세요.');
    const doc = {
      _id: newId('post'),
      title: text(b.title, { name: '제목', max: 120, required: true }),
      content: text(b.content, { name: '내용', max: 10000, required: true }),
      author: text(b.author || req.session.label, { name: '작성자', max: 40 }),
      passwordHash: password ? scryptHash(password) : '',
      visible: true,
      createdByTokenId: req.session.tokenId,
      createdAt: nowIso(),
    };
    await posts.insertOne(doc);
    await logActivity(db, { type: 'post', text: `자유게시판: ${doc.title}`, href: `/board/posts/${doc._id}` });
    res.json({ ok: true, id: doc._id });
  });

  // 글 수정: 글쓴이 본인(같은 로그인)이거나 글 비밀번호를 아는 경우
  router.patch('/posts/:id', requireRole('member'), async (req, res) => {
    const doc = await posts.findOne({ _id: req.params.id, visible: { $ne: false } });
    if (!doc) throw notFound('게시글을 찾을 수 없습니다.');
    const isAuthor = doc.createdByTokenId && doc.createdByTokenId === req.session.tokenId;
    if (!isAuthor && !scryptVerify(String(req.body?.password || ''), doc.passwordHash)) {
      throw forbidden(doc.passwordHash ? '비밀번호가 일치하지 않습니다.' : '글쓴이만 수정할 수 있습니다.');
    }
    const b = req.body || {};
    const set = { updatedAt: nowIso() };
    if ('title' in b) set.title = text(b.title, { name: '제목', max: 120, required: true });
    if ('content' in b) set.content = text(b.content, { name: '내용', max: 10000, required: true });
    await posts.updateOne({ _id: doc._id }, { $set: set });
    res.json({ ok: true });
  });

  // 같은 접속 코드로 쓴 글은 바로 삭제, 다른 기기·코드면 비밀번호 필요
  router.delete('/posts/:id', requireRole('member'), async (req, res) => {
    const doc = await posts.findOne({ _id: req.params.id });
    if (!doc) throw notFound();
    if (!canEdit(req.session, doc) && !scryptVerify(String(req.body?.password || ''), doc.passwordHash)) {
      throw forbidden('비밀번호가 일치하지 않습니다.');
    }
    await posts.updateOne({ _id: doc._id }, { $set: { visible: false } });
    res.json({ ok: true });
  });
}
