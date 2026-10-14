import { assertTeamAccess, requireRole } from '../auth.js';
import { getSetting, logActivity } from '../db.js';
import { deleteFile, storeUploaded, uploadMiddleware } from '../files.js';
import {
  badRequest, intInRange, newId, notFound, nowIso, optionalColor, optionalDate,
  optionalTime, optionalUrl, parseDuration, text,
} from '../lib/util.js';
import { DEFAULT_EVENT } from '../state.js';

export function contentRoutes(router, { db, bucket }) {
  const teams = db.collection('teams');
  const settings = db.collection('settings');
  const ensureEvent = () => settings.updateOne({ _id: 'event' }, { $setOnInsert: DEFAULT_EVENT }, { upsert: true });

  /* ---------- 공연 정보 ---------- */
  router.patch('/event', requireRole('admin'), async (req, res) => {
    const b = req.body || {};
    const set = {};
    if ('title' in b) set.title = text(b.title, { name: '공연명', max: 100, required: true });
    if ('venue' in b) set.venue = text(b.venue, { name: '장소', max: 100 });
    if ('eventDate' in b) set.eventDate = optionalDate(b.eventDate, '공연일');
    if ('startTime' in b) set.startTime = optionalTime(b.startTime, '시작 시간');
    if ('endTime' in b) set.endTime = optionalTime(b.endTime, '종료 시간');
    if ('slotMinutes' in b) set.slotMinutes = intInRange(b.slotMinutes, { name: '팀당 배정 시간', min: 1, max: 300, fallback: 40 });
    if ('changeoverMinutes' in b) set.changeoverMinutes = intInRange(b.changeoverMinutes, { name: '전환 시간', min: 0, max: 120, fallback: 10 });
    if ('orderConfirmed' in b) set.orderConfirmed = Boolean(b.orderConfirmed);
    if ('talkRoomUrl' in b) set.talkRoomUrl = optionalUrl(b.talkRoomUrl, '톡방 링크');
    if ('notice' in b) set.notice = text(b.notice, { name: '공지', max: 5000 });
    if ('scheduleNote' in b) set.scheduleNote = text(b.scheduleNote, { name: '일정 메모', max: 3000 });
    if ('links' in b) {
      if (!Array.isArray(b.links)) throw badRequest('링크 목록 형식이 올바르지 않습니다.');
      set.links = b.links.slice(0, 20)
        .map((l) => ({ label: text(l.label, { name: '링크 이름', max: 60 }), url: optionalUrl(l.url) }))
        .filter((l) => l.label && l.url);
    }
    set.updatedAt = nowIso();
    await ensureEvent();
    await settings.updateOne({ _id: 'event' }, { $set: set });
    if ('notice' in b) await logActivity(db, { type: 'notice', text: '공지사항이 수정되었습니다.', href: '/' });
    res.json({ ok: true });
  });

  router.post('/event/posters', requireRole('admin'), uploadMiddleware.array('files', 10), async (req, res) => {
    const stored = await storeUploaded(bucket, req.files, { imagesOnly: true, meta: { kind: 'poster' } });
    await ensureEvent();
    const added = stored.map((f) => ({ fileId: f.fileId, name: f.name }));
    await settings.updateOne({ _id: 'event' }, { $push: { posters: { $each: added } } });
    const event = await getSetting(db, 'event', DEFAULT_EVENT);
    res.json({ ok: true, posters: event.posters });
  });

  router.delete('/event/posters/:fileId', requireRole('admin'), async (req, res) => {
    await settings.updateOne({ _id: 'event' }, { $pull: { posters: { fileId: req.params.fileId } } });
    await deleteFile(bucket, req.params.fileId);
    res.json({ ok: true });
  });

  /* ---------- 운영규약 ---------- */
  router.put('/rules', requireRole('admin'), async (req, res) => {
    const content = text(req.body?.content, { name: '운영규약', max: 50000 });
    await settings.updateOne({ _id: 'rules' }, { $set: { content, updatedAt: nowIso(), updatedBy: req.session.label } }, { upsert: true });
    await logActivity(db, { type: 'rules', text: '운영규약이 수정되었습니다.', href: '/rules' });
    res.json({ ok: true });
  });

  /* ---------- 팀 ---------- */
  async function getTeam(id) {
    const team = await teams.findOne({ _id: id });
    if (!team) throw notFound('팀을 찾을 수 없습니다.');
    return team;
  }

  router.post('/teams', requireRole('admin'), async (req, res) => {
    const name = text(req.body?.name, { name: '팀 이름', max: 60, required: true });
    let id = text(req.body?.id, { name: '팀 ID', max: 30 }).toLowerCase();
    if (id && !/^[a-z0-9-]+$/.test(id)) throw badRequest('팀 ID는 영문 소문자, 숫자, -만 쓸 수 있습니다.');
    if (!id) id = newId('team');
    if (await teams.findOne({ _id: id })) throw badRequest('이미 있는 팀 ID입니다.');
    const last = await teams.find().sort({ order: -1 }).limit(1).toArray();
    await teams.insertOne({ _id: id, name, order: (last[0]?.order ?? -1) + 1, images: [], setlist: [], createdAt: nowIso(), updatedAt: nowIso() });
    await logActivity(db, { type: 'team', text: `${name} 팀이 추가되었습니다.`, teamId: id, href: `/teams/${id}` });
    res.json({ ok: true, id });
  });

  router.put('/teams/order', requireRole('admin'), async (req, res) => {
    const ids = req.body?.ids;
    if (!Array.isArray(ids)) throw badRequest('순서 정보가 올바르지 않습니다.');
    await Promise.all(ids.map((id, i) => teams.updateOne({ _id: String(id) }, { $set: { order: i } })));
    await logActivity(db, { type: 'order', text: '공연 순서가 변경되었습니다.', href: '/' });
    res.json({ ok: true });
  });

  router.patch('/teams/:id', requireRole('leader'), async (req, res) => {
    assertTeamAccess(req.session, req.params.id);
    const team = await getTeam(req.params.id);
    const b = req.body || {};
    const set = {};
    if ('name' in b) set.name = text(b.name, { name: '팀 이름', max: 60, required: true });
    if ('intro' in b) set.intro = text(b.intro, { name: '팀 소개', max: 2000 });
    if ('snsUrl' in b) set.snsUrl = optionalUrl(b.snsUrl, 'SNS 링크');
    if ('memberCount' in b) set.memberCount = intInRange(b.memberCount, { name: '인원수', min: 1, max: 50 });
    if ('instruments' in b) set.instruments = text(b.instruments, { name: '구성 악기', max: 300 });
    if ('leaderName' in b) set.leaderName = text(b.leaderName, { name: '대표자 이름', max: 40 });
    if ('leaderContact' in b) set.leaderContact = text(b.leaderContact, { name: '대표자 연락처', max: 300 });
    if ('themeColor' in b) set.themeColor = optionalColor(b.themeColor);
    set.updatedAt = nowIso();
    await teams.updateOne({ _id: team._id }, { $set: set });
    await logActivity(db, { type: 'team', text: `${set.name || team.name} 팀 정보가 수정되었습니다.`, teamId: team._id, href: `/teams/${team._id}` });
    res.json({ ok: true });
  });

  router.delete('/teams/:id', requireRole('admin'), async (req, res) => {
    const team = await getTeam(req.params.id);
    for (const img of team.images || []) await deleteFile(bucket, img.fileId);
    await teams.deleteOne({ _id: team._id });
    await db.collection('tokens').updateMany({ teamId: team._id }, { $set: { active: false } });
    res.json({ ok: true });
  });

  /** 셋리스트는 배열 전체를 교체한다(순서 번호 충돌 원천 차단) */
  router.put('/teams/:id/setlist', requireRole('leader'), async (req, res) => {
    assertTeamAccess(req.session, req.params.id);
    const team = await getTeam(req.params.id);
    const items = req.body?.items;
    if (!Array.isArray(items)) throw badRequest('셋리스트 형식이 올바르지 않습니다.');
    if (items.length > 30) throw badRequest('셋리스트는 30곡까지 입력할 수 있습니다.');
    const setlist = items.map((it, i) => ({
      id: typeof it.id === 'string' && it.id ? it.id.slice(0, 40) : newId('song'),
      title: text(it.title, { name: `${i + 1}번 곡명`, max: 100, required: true }),
      artist: text(it.artist, { name: '아티스트', max: 100 }),
      duration: parseDuration(it.duration),
      cue: text(it.cue, { name: '큐시트', max: 1000 }),
      note: text(it.note, { name: '비고', max: 300 }),
    }));
    await teams.updateOne({ _id: team._id }, { $set: { setlist, updatedAt: nowIso() } });
    await logActivity(db, { type: 'setlist', text: `${team.name} 셋리스트가 수정되었습니다.`, teamId: team._id, href: `/teams/${team._id}` });
    res.json({ ok: true, setlist });
  });

  router.post('/teams/:id/images', requireRole('leader'), uploadMiddleware.array('files', 10), async (req, res) => {
    assertTeamAccess(req.session, req.params.id);
    const team = await getTeam(req.params.id);
    const stored = await storeUploaded(bucket, req.files, { imagesOnly: true, meta: { kind: 'team', teamId: team._id } });
    const images = stored.map((f) => ({ fileId: f.fileId, name: f.name }));
    await teams.updateOne({ _id: team._id }, { $push: { images: { $each: images } }, $set: { updatedAt: nowIso() } });
    await logActivity(db, { type: 'image', text: `${team.name} 팀 이미지가 추가되었습니다.`, teamId: team._id, href: `/teams/${team._id}` });
    res.json({ ok: true, images });
  });

  router.post('/teams/:id/images/:fileId/cover', requireRole('leader'), async (req, res) => {
    assertTeamAccess(req.session, req.params.id);
    const team = await getTeam(req.params.id);
    const imgs = team.images || [];
    const idx = imgs.findIndex((i) => i.fileId === req.params.fileId);
    if (idx < 0) throw notFound('이미지를 찾을 수 없습니다.');
    const [img] = imgs.splice(idx, 1);
    await teams.updateOne({ _id: team._id }, { $set: { images: [img, ...imgs] } });
    res.json({ ok: true });
  });

  router.delete('/teams/:id/images/:fileId', requireRole('leader'), async (req, res) => {
    assertTeamAccess(req.session, req.params.id);
    const team = await getTeam(req.params.id);
    if (!(team.images || []).some((i) => i.fileId === req.params.fileId)) throw notFound('이미지를 찾을 수 없습니다.');
    await teams.updateOne({ _id: team._id }, { $pull: { images: { fileId: req.params.fileId } } });
    await deleteFile(bucket, req.params.fileId);
    res.json({ ok: true });
  });
}
