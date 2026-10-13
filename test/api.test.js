import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, GridFSBucket } from 'mongodb';
import { createApp } from '../server/app.js';
import { ensureIndexes } from '../server/db.js';
import { loadConfig } from '../server/config.js';

let mongo, client, server, base;
const BOOT = 'BOOTS-TRAP1';

class Agent {
  constructor() { this.cookie = ''; }
  async req(method, path, body, { csrf = true, raw = false } = {}) {
    const headers = {};
    if (this.cookie) headers.cookie = this.cookie;
    if (csrf) headers['x-requested-with'] = 'concertsite';
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(base + path, { method, headers, body: payload, redirect: 'manual' });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    if (raw) return res;
    const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data };
  }
  get(p) { return this.req('GET', p); }
  post(p, b) { return this.req('POST', p, b); }
  put(p, b) { return this.req('PUT', p, b); }
  patch(p, b) { return this.req('PATCH', p, b); }
  del(p, b) { return this.req('DELETE', p, b); }
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  client = new MongoClient(mongo.getUri());
  await client.connect();
  const db = client.db('test');
  await ensureIndexes(db);
  const config = { ...loadConfig({}), adminBootstrapToken: BOOT, sessionSecret: 'test-secret-test-secret-test-secret-00' };
  const app = createApp({ db, bucket: new GridFSBucket(db, { bucketName: 'files' }), config });
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server?.close();
  await client?.close();
  await mongo?.stop();
});

const admin = new Agent();
const leader = new Agent();
const member = new Agent();
const otherLeader = new Agent();
const tokens = {};

test('비로그인: state 401, public은 열람 가능', async () => {
  const a = new Agent();
  assert.equal((await a.get('/api/state')).status, 401);
  const pub = await a.get('/api/public');
  assert.equal(pub.status, 200);
  assert.ok('rules' in pub.data);
});

test('잘못된 토큰 거부, 부트스트랩 관리자 로그인', async () => {
  assert.equal((await new Agent().post('/api/auth/login', { token: 'nope' })).status, 401);
  const r = await admin.post('/api/auth/login', { token: 'boots trap1' }); // 정규화(대소문자/공백)
  assert.equal(r.status, 200);
  const s = await admin.get('/api/state');
  assert.equal(s.data.me.role, 'admin');
});

test('CSRF 헤더 없는 변경 요청 거부', async () => {
  const r = await admin.req('POST', '/api/teams', { name: 'X' }, { csrf: false });
  assert.equal(r.status, 403);
});

test('팀·토큰 생성, 매직 링크 로그인', async () => {
  assert.equal((await admin.post('/api/teams', { id: 'bdh', name: '비상대책회의' })).status, 200);
  assert.equal((await admin.post('/api/teams', { id: 't2', name: 'T2' })).status, 200);
  await admin.patch('/api/teams/bdh', { leaderContact: '010-0000-0000', themeColor: '#fa0000' });
  await admin.patch('/api/event', { talkRoomUrl: 'https://open.kakao.com/o/test', eventDate: '2027-01-30' });

  for (const [key, body] of Object.entries({
    leader: { label: 'bdh 대표', role: 'leader', teamId: 'bdh' },
    member: { label: 't2 멤버', role: 'member', teamId: 't2' },
    otherLeader: { label: 't2 대표', role: 'leader', teamId: 't2' },
  })) {
    const r = await admin.post('/api/admin/tokens', body);
    assert.equal(r.status, 200);
    assert.match(r.data.token, /^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    tokens[key] = r.data;
  }
  const list = await admin.get('/api/admin/tokens');
  assert.ok(list.data.tokens.every((t) => !('hash' in t) && !('token' in t)), '목록에 해시/평문 없음');

  const res = await leader.req('GET', `/k/${tokens.leader.token}`, undefined, { raw: true });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/');
  assert.equal((await leader.get('/api/state')).data.me.teamId, 'bdh');
  await member.post('/api/auth/login', { token: tokens.member.token });
  await otherLeader.post('/api/auth/login', { token: tokens.otherLeader.token });
});

test('역할별 정보 필터링: 톡방 링크·대표 연락처', async () => {
  const m = (await member.get('/api/state')).data;
  assert.equal(m.event.talkRoomUrl, '', 'member에게 톡방 링크 숨김');
  const bdh = m.teams.find((t) => t.id === 'bdh');
  assert.equal(bdh.leaderContact, '', 'member에게 타팀 연락처 숨김');
  assert.equal(bdh.contactHidden, true);
  const l = (await otherLeader.get('/api/state')).data;
  assert.equal(l.event.talkRoomUrl, 'https://open.kakao.com/o/test');
  assert.equal(l.teams.find((t) => t.id === 'bdh').leaderContact, '010-0000-0000');
});

test('팀 권한: 타팀 수정 불가, 셋리스트 저장·러닝타임 파싱', async () => {
  assert.equal((await otherLeader.patch('/api/teams/bdh', { intro: 'hack' })).status, 403);
  assert.equal((await member.patch('/api/teams/t2', { intro: 'x' })).status, 403, 'member는 팀 편집 불가');
  const r = await leader.put('/api/teams/bdh/setlist', { items: [
    { title: '로키', artist: '미키토P', duration: '3:45' },
    { title: '백금디스코', duration: '4분10초' },
  ] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.setlist.map((s) => s.duration), [225, 250]);
  assert.equal((await leader.put('/api/teams/bdh/setlist', { items: [{ title: 'a', duration: 'abc' }] })).status, 400);
});

test('취합: 자기 팀만 상태 변경, 마감 후 비관리자 차단', async () => {
  const c = await admin.post('/api/collections', { title: '셋리스트 제출', dueDate: '2027-01-01', targetTeamIds: ['bdh', 't2'] });
  const id = c.data.id;
  assert.equal((await member.put(`/api/collections/${id}/progress/bdh`, { status: 'done' })).status, 403);
  assert.equal((await member.put(`/api/collections/${id}/progress/t2`, { status: 'doing', note: '작성중' })).status, 200);
  assert.equal((await member.put(`/api/collections/${id}/progress/t2`, { status: 'weird' })).status, 400);
  await admin.patch(`/api/collections/${id}`, { status: 'closed' });
  assert.equal((await member.put(`/api/collections/${id}/progress/t2`, { status: 'done' })).status, 403);
  const s = (await admin.get('/api/state')).data;
  assert.equal(s.collections[0].progress.t2.status, 'doing');
});

test('투표: 1인 1표(변경 가능), 익명은 이름·팀 비공개, 마감 후 투표 불가', async () => {
  const p = await admin.post('/api/polls', { title: '시간', options: ['5시', '6시'], anonymous: true });
  const poll = (await admin.get('/api/state')).data.polls.find((x) => x.id === p.data.id);
  const [o1, o2] = poll.options;
  assert.equal((await member.put(`/api/polls/${poll.id}/vote`, { optionId: o1.id })).status, 200);
  assert.equal((await member.put(`/api/polls/${poll.id}/vote`, { optionId: o2.id })).status, 200, '재투표=변경');
  const ms = (await member.get('/api/state')).data.polls.find((x) => x.id === poll.id);
  assert.equal(ms.totalVotes, 1, '중복 집계 없음');
  assert.equal(ms.myVote.optionId, o2.id);
  assert.deepEqual(ms.voters, []);
  assert.deepEqual(ms.votedTeamIds, [], '익명 투표는 팀도 노출 안 함');

  await admin.patch(`/api/polls/${poll.id}`, { status: 'closed' });
  assert.equal((await leader.put(`/api/polls/${poll.id}/vote`, { optionId: o1.id })).status, 403);

  const past = await admin.post('/api/polls', { title: '지난 투표', options: ['a', 'b'], dueDate: '2020-01-01' });
  const pp = (await admin.get('/api/state')).data.polls.find((x) => x.id === past.data.id);
  assert.equal(pp.isOpen, false);
  assert.equal((await member.put(`/api/polls/${pp.id}/vote`, { optionId: pp.options[0].id })).status, 403);
});

test('투표: 팀당 1표 + 마감 후 결과 공개', async () => {
  const p = await admin.post('/api/polls', { title: '팀투표', options: ['A', 'B'], voteScope: 'team', showResults: 'afterClose' });
  const id = p.data.id;
  const poll = (await member.get('/api/state')).data.polls.find((x) => x.id === id);
  assert.equal(poll.options[0].votes, null, '결과 숨김');
  await member.put(`/api/polls/${id}/vote`, { optionId: poll.options[0].id, name: '철수' });
  await otherLeader.put(`/api/polls/${id}/vote`, { optionId: poll.options[1].id, name: '영희' });
  const a = (await admin.get('/api/state')).data.polls.find((x) => x.id === id);
  assert.equal(a.totalVotes, 1, '같은 팀(t2) 두 사람 → 1표, 마지막 선택으로 갱신');
  assert.equal(a.options[1].votes, 1);
});

test('게시판: 비밀번호 삭제, 작성자 바로 삭제, 해시 미노출', async () => {
  const r = await member.post('/api/posts', { title: '안녕', content: '내용', password: 'pw1234' });
  const s = (await leader.get('/api/state')).data;
  const post = s.posts.find((x) => x.id === r.data.id);
  assert.ok(!('passwordHash' in post));
  assert.equal(post.canDelete, false);
  assert.equal((await leader.del(`/api/posts/${post.id}`, { password: 'wrong' })).status, 403);
  assert.equal((await leader.del(`/api/posts/${post.id}`, { password: 'pw1234' })).status, 200);
  const r2 = await member.post('/api/posts', { title: '두번째', content: 'x' });
  assert.equal((await member.del(`/api/posts/${r2.data.id}`, {})).status, 200);
});

test('회의록: 할 일 체크, 작성자 외 수정 불가', async () => {
  const r = await member.post('/api/meetings', { title: '1차 회의', date: '2026-10-20', content: '내용', decisions: '순서 뽑기로 결정\n리허설 2시', actions: [{ text: '포스터 시안', owner: '김', due: '2026-11-01' }] });
  const m = (await leader.get('/api/state')).data.meetings.find((x) => x.id === r.data.id);
  assert.deepEqual(m.decisions, ['순서 뽑기로 결정', '리허설 2시']);
  assert.equal(m.pinned, false, 'member는 고정 불가');
  assert.equal((await leader.put(`/api/meetings/${m.id}/actions/${m.actions[0].id}`, { done: true })).status, 200);
  assert.equal((await leader.patch(`/api/meetings/${m.id}`, { title: 'x' })).status, 403);
  assert.equal((await admin.patch(`/api/meetings/${m.id}`, { title: '1차 운영회의', pinned: true })).status, 200);
});

test('이미지 업로드(GridFS) → 로그인 사용자만 조회', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const fd = new FormData();
  fd.append('files', new Blob([png], { type: 'image/png' }), '팀사진.png');
  const r = await leader.post('/api/teams/bdh/images', fd);
  assert.equal(r.status, 200);
  const fileId = r.data.images[0].fileId;
  assert.equal(r.data.images[0].name, '팀사진.png', '한글 파일명 보존');
  const anon = await new Agent().req('GET', `/api/files/${fileId}`, undefined, { raw: true });
  assert.equal(anon.status, 401);
  const ok = await member.req('GET', `/api/files/${fileId}`, undefined, { raw: true });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'image/png');
  const bad = new FormData();
  bad.append('files', new Blob(['x'], { type: 'text/html' }), 'a.html');
  assert.equal((await leader.post('/api/teams/bdh/images', bad)).status, 400);
});

test('토큰 재발급 시 기존 세션 무효화, 비활성화 즉시 반영', async () => {
  const r = await admin.post(`/api/admin/tokens/${tokens.otherLeader.id}/reissue`);
  assert.equal(r.status, 200);
  assert.equal((await otherLeader.get('/api/state')).status, 401);
  await member.get('/api/state');
  await admin.patch(`/api/admin/tokens/${tokens.member.id}`, { active: false });
  assert.equal((await member.get('/api/state')).status, 401);
});

test('비밀번호 직접 지정: 6자 미만 거부, 중복 거부, 대소문자 무시 로그인', async () => {
  assert.equal((await admin.post('/api/admin/tokens', { label: 'x', role: 'member', token: 'abc' })).status, 400);
  const r = await admin.post('/api/admin/tokens', { label: '스미네 멤버', role: 'member', teamId: 't2', token: 'sumine-2027' });
  assert.equal(r.status, 200);
  assert.equal(r.data.token, 'sumine-2027');
  assert.equal((await admin.post('/api/admin/tokens', { label: 'y', role: 'member', token: 'SUMINE2027' })).status, 400, '정규화 후 중복');
  const a = new Agent();
  assert.equal((await a.post('/api/auth/login', { token: 'Sumine 2027' })).status, 200);
});

test('로그인 시도 제한', async () => {
  const a = new Agent();
  let last;
  for (let i = 0; i < 12; i += 1) last = await a.post('/api/auth/login', { token: `WRONG${i}` });
  assert.equal(last.status, 429);
});

test('가져오기: 데이터 있으면 force 없이 거부, force면 교체 + 새 토큰 발급', async () => {
  const payload = {
    format: 'concertsite-import@1',
    event: { title: '테스트 공연', venue: '감마홀', eventDate: '2027-01-30' },
    rules: '규약',
    teams: [{ id: 'bdh', name: '비상대책회의', setlist: [{ title: '로키', duration: '3:45' }] }],
    collections: [{ title: '프로필', targetTeamIds: ['bdh'], progress: { bdh: { status: 'done', note: '' } } }],
    polls: [{ title: '시간', options: ['5시', '6시'], anonymous: true }],
    tokens: [{ label: 'bdh 대표', role: 'leader', teamId: 'bdh' }],
  };
  assert.equal((await admin.post('/api/admin/import', payload)).status, 400);
  const r = await admin.post('/api/admin/import', { ...payload, force: true });
  assert.equal(r.status, 200);
  assert.equal(r.data.tokens.length, 1);
  const s = (await admin.get('/api/state')).data;
  assert.equal(s.event.title, '테스트 공연');
  assert.equal(s.teams[0].setlist[0].duration, 225);
});
