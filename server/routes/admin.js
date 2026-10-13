import { generateToken, hashToken, normalizeToken, requireRole, ROLE_LABELS } from '../auth.js';
import { storeFile } from '../files.js';
import {
  badRequest, intInRange, newId, notFound, nowIso, optionalColor, optionalDate, optionalUrl, parseDuration, text,
} from '../lib/util.js';
import { DEFAULT_EVENT } from '../state.js';

const ROLES = Object.keys(ROLE_LABELS);

export function adminRoutes(router, { db, bucket, sessions, config }) {
  const tokens = db.collection('tokens');
  const admin = requireRole('admin');

  async function checkTeam(teamId) {
    if (!teamId) return '';
    const t = await db.collection('teams').findOne({ _id: String(teamId) });
    if (!t) throw badRequest('존재하지 않는 팀입니다.');
    return t._id;
  }

  function tokenFields(b) {
    const role = String(b.role || 'member');
    if (!ROLES.includes(role)) throw badRequest('역할 값이 올바르지 않습니다.');
    return { label: text(b.label, { name: '이름', max: 40, required: true }), role, note: text(b.note, { name: '메모', max: 200 }) };
  }

  /** 직접 지정한 비밀번호 검증. 영문/숫자 6자 이상(대소문자·하이픈·공백 무시) */
  function customToken(raw) {
    if (raw == null || String(raw).trim() === '') return '';
    const v = String(raw).trim();
    if (normalizeToken(v).length < 6) throw badRequest('비밀번호는 영문·숫자 6자 이상으로 정하세요.');
    if (normalizeToken(v).length > 40) throw badRequest('비밀번호는 40자 이하로 정하세요.');
    if (normalizeToken(config.adminBootstrapToken) === normalizeToken(v)) throw badRequest('초기 관리자 코드와 같은 값은 쓸 수 없습니다.');
    return v;
  }

  async function createToken({ label, role, teamId, note, custom = '' }) {
    // 자동 생성은 충돌 가능성이 사실상 0이지만 유니크 인덱스 위반 시 재시도
    for (let i = 0; i < 3; i += 1) {
      const token = custom || generateToken();
      const doc = { _id: newId('tok'), label, role, teamId, note, hash: hashToken(token), active: true, version: 0, createdAt: nowIso(), lastUsedAt: '' };
      try {
        await tokens.insertOne(doc);
        return { id: doc._id, label, role, teamId, token };
      } catch (e) {
        if (e.code !== 11000) throw e;
        if (custom) throw badRequest('이미 다른 사람이 쓰는 비밀번호입니다.');
      }
    }
    throw new Error('비밀번호 생성에 실패했습니다.');
  }

  router.get('/admin/tokens', admin, async (_req, res) => {
    const list = await tokens.find({}, { projection: { hash: 0 } }).sort({ role: 1, teamId: 1, createdAt: 1 }).toArray();
    res.json({ tokens: list.map((t) => ({ id: t._id, label: t.label, role: t.role, roleLabel: ROLE_LABELS[t.role], teamId: t.teamId || '', note: t.note || '', active: t.active, createdAt: t.createdAt, lastUsedAt: t.lastUsedAt || '' })) });
  });

  router.post('/admin/tokens', admin, async (req, res) => {
    const f = tokenFields(req.body || {});
    const created = await createToken({ ...f, teamId: await checkTeam(req.body?.teamId), custom: customToken(req.body?.token) });
    res.json({ ok: true, ...created });
  });

  router.patch('/admin/tokens/:id', admin, async (req, res) => {
    const b = req.body || {};
    const set = {};
    if ('label' in b || 'role' in b || 'note' in b) {
      const cur = await tokens.findOne({ _id: req.params.id });
      if (!cur) throw notFound();
      Object.assign(set, tokenFields({ ...cur, ...b }));
    }
    if ('teamId' in b) set.teamId = await checkTeam(b.teamId);
    if ('active' in b) set.active = Boolean(b.active);
    const r = await tokens.updateOne({ _id: req.params.id }, { $set: { ...set, updatedAt: nowIso() } });
    if (!r.matchedCount) throw notFound();
    sessions.invalidate(req.params.id);
    res.json({ ok: true });
  });

  /** 재발급: 새 코드 발급 + version 증가 → 기존 로그인 세션 모두 무효화 */
  router.post('/admin/tokens/:id/reissue', admin, async (req, res) => {
    const token = customToken(req.body?.token) || generateToken();
    let r;
    try {
      r = await tokens.updateOne({ _id: req.params.id }, { $set: { hash: hashToken(token), active: true, updatedAt: nowIso() }, $inc: { version: 1 } });
    } catch (e) {
      if (e.code === 11000) throw badRequest('이미 다른 사람이 쓰는 비밀번호입니다.');
      throw e;
    }
    if (!r.matchedCount) throw notFound();
    sessions.invalidate(req.params.id);
    res.json({ ok: true, token });
  });

  router.delete('/admin/tokens/:id', admin, async (req, res) => {
    await tokens.deleteOne({ _id: req.params.id });
    sessions.invalidate(req.params.id);
    res.json({ ok: true });
  });

  /* ---------- 백업 내보내기 ---------- */
  router.get('/admin/export', admin, async (_req, res) => {
    const names = ['settings', 'teams', 'collections', 'polls', 'votes', 'meetings', 'questions', 'posts', 'activity'];
    const out = { format: 'concertsite-backup@1', exportedAt: nowIso() };
    for (const n of names) out[n] = await db.collection(n).find(n === 'settings' ? { _id: { $ne: 'sessionSecret' } } : {}).toArray();
    out.tokens = await tokens.find({}, { projection: { hash: 0 } }).toArray();
    out.files = (await bucket.find().toArray()).map((f) => ({ id: f._id.toHexString(), name: f.filename, size: f.length, type: f.metadata?.contentType }));
    res.setHeader('Content-Disposition', `attachment; filename="concertsite-backup-${nowIso().slice(0, 10)}.json"`);
    res.json(out);
  });

  /* ---------- 가져오기(기존 Apps Script 시트 이전용) ---------- */
  router.post('/admin/import', admin, async (req, res) => {
    const data = req.body || {};
    if (data.format !== 'concertsite-import@1') throw badRequest('가져오기 파일 형식이 아닙니다.');
    const existing = await db.collection('teams').countDocuments();
    if (existing > 0 && !data.force) {
      throw badRequest('이미 데이터가 있습니다. 덮어쓰려면 "기존 데이터 지우고 가져오기"를 선택하세요.');
    }
    if (existing > 0) {
      for (const n of ['settings', 'teams', 'collections', 'polls', 'votes', 'meetings', 'questions', 'posts', 'activity']) {
        await db.collection(n).deleteMany(n === 'settings' ? { _id: { $ne: 'sessionSecret' } } : {});
      }
      await bucket.drop().catch(() => {});
    }

    const saveImage = async (img, meta) => {
      if (!img?.base64) return null;
      const f = await storeFile(bucket, { buffer: Buffer.from(img.base64, 'base64'), name: img.name || 'image', mimeType: img.mime || 'image/jpeg', meta });
      return { fileId: f.fileId, name: f.name };
    };

    const ev = data.event || {};
    const posters = [];
    for (const p of data.posters || []) {
      const saved = await saveImage(p, { kind: 'poster' });
      if (saved) posters.push(saved);
    }
    await db.collection('settings').insertOne({
      ...DEFAULT_EVENT,
      _id: 'event',
      title: text(ev.title, { max: 100 }) || DEFAULT_EVENT.title,
      venue: text(ev.venue, { max: 100 }),
      eventDate: optionalDate(ev.eventDate),
      startTime: ev.startTime || DEFAULT_EVENT.startTime,
      endTime: ev.endTime || DEFAULT_EVENT.endTime,
      slotMinutes: intInRange(ev.slotMinutes, { min: 1, max: 300, fallback: 40 }),
      changeoverMinutes: intInRange(ev.changeoverMinutes, { min: 0, max: 120, fallback: 10 }),
      talkRoomUrl: optionalUrl(ev.talkRoomUrl),
      notice: text(ev.notice, { max: 5000 }),
      scheduleNote: text(ev.scheduleNote, { max: 3000 }),
      links: (ev.links || []).map((l) => ({ label: text(l.label, { max: 60 }), url: optionalUrl(l.url) })),
      posters,
      updatedAt: nowIso(),
    });
    await db.collection('settings').insertOne({ _id: 'rules', content: text(data.rules, { max: 50000 }), updatedAt: nowIso(), updatedBy: '가져오기' });

    let order = 0;
    for (const t of data.teams || []) {
      const images = [];
      for (const img of t.images || []) {
        const saved = await saveImage(img, { kind: 'team', teamId: t.id });
        if (saved) images.push(saved);
      }
      await db.collection('teams').insertOne({
        _id: String(t.id),
        name: text(t.name, { max: 60, required: true }),
        intro: text(t.intro, { max: 2000 }),
        snsUrl: t.snsUrl ? optionalUrl(t.snsUrl) : '',
        memberCount: intInRange(t.memberCount, { min: 1, max: 50 }),
        instruments: text(t.instruments, { max: 300 }),
        leaderName: text(t.leaderName, { max: 40 }),
        leaderContact: text(t.leaderContact, { max: 60 }),
        themeColor: optionalColor(t.themeColor),
        order: order++,
        images,
        setlist: (t.setlist || []).map((s) => ({
          id: newId('song'), title: text(s.title, { max: 100 }), artist: text(s.artist, { max: 100 }),
          duration: parseDuration(s.duration), cue: text(s.cue, { max: 1000 }), note: text(s.note, { max: 300 }),
        })).filter((s) => s.title),
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });
    }

    for (const c of data.collections || []) {
      await db.collection('collections').insertOne({
        _id: newId('col'), title: c.title, description: c.description || '', dueDate: optionalDate(c.dueDate),
        targetTeamIds: c.targetTeamIds || [], status: c.status === 'closed' ? 'closed' : 'open',
        progress: c.progress || {}, createdBy: c.createdBy || '', createdAt: c.createdAt || nowIso(),
      });
    }
    for (const p of data.polls || []) {
      await db.collection('polls').insertOne({
        _id: newId('poll'), title: p.title, description: p.description || '', targetTeamId: p.targetTeamId || '',
        options: (p.options || []).map((label) => ({ id: newId('opt'), label: String(label) })),
        anonymous: Boolean(p.anonymous), voteScope: p.voteScope === 'team' ? 'team' : 'person',
        showResults: p.showResults === 'afterClose' ? 'afterClose' : 'always', dueDate: optionalDate(p.dueDate),
        status: p.status === 'closed' ? 'closed' : 'open', createdBy: p.createdBy || '', createdAt: p.createdAt || nowIso(),
      });
    }
    for (const m of data.meetings || []) {
      await db.collection('meetings').insertOne({ _id: newId('mtg'), title: m.title, date: '', content: m.content || '', decisions: [], actions: [], pinned: Boolean(m.pinned), author: m.author || '', attachments: [], createdAt: m.createdAt || nowIso() });
    }
    for (const q of data.questions || []) {
      await db.collection('questions').insertOne({ _id: newId('q'), title: q.title || String(q.question || '').slice(0, 40), question: q.question || '', author: q.author || '', teamId: '', answer: q.answer || '', answeredBy: q.answer ? '총괄대표' : '', answeredAt: q.answer ? nowIso() : '', attachments: [], createdAt: q.createdAt || nowIso() });
    }
    for (const p of data.posts || []) {
      await db.collection('posts').insertOne({ _id: newId('post'), title: p.title, content: p.content || '', author: p.author || '', passwordHash: p.passwordHash || '', visible: true, createdAt: p.createdAt || nowIso() });
    }

    const issued = [];
    for (const t of data.tokens || []) {
      if (!ROLES.includes(t.role)) continue;
      const teamId = t.teamId && (await db.collection('teams').findOne({ _id: String(t.teamId) })) ? String(t.teamId) : '';
      issued.push(await createToken({ label: text(t.label, { max: 40 }) || ROLE_LABELS[t.role], role: t.role, teamId, note: text(t.note, { max: 200 }) }));
    }
    await db.collection('activity').insertOne({ type: 'import', text: '기존 사이트 데이터를 가져왔습니다.', teamId: '', href: '/', at: nowIso() });
    res.json({ ok: true, tokens: issued });
  });
}
