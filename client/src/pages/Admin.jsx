import { useEffect, useState } from 'preact/hooks';
import { api, fileUrl, pickFiles, uploadFiles } from '../api.js';
import { navigate, useApp } from '../app.jsx';
import { Button, ConfirmButton, Empty, Field, Modal, PageHead, Segmented, TeamChip, useForm } from '../components/ui.jsx';
import { relativeTime, teamStyle } from '../util.js';

const magicLink = (token) => `${window.location.origin}/k/${token}`;

function useCopy() {
  const { toast } = useApp();
  return async (text, msg = '복사했습니다.') => {
    try {
      await navigator.clipboard.writeText(text);
      toast(msg);
    } catch {
      toast('복사하지 못했습니다. 직접 선택해서 복사하세요.', 'error');
    }
  };
}

/* ---------- 공연 정보 ---------- */
function EventSettings() {
  const { state, run } = useApp();
  const ev = state.event;
  const f = useForm({
    title: ev.title, venue: ev.venue, eventDate: ev.eventDate, startTime: ev.startTime, endTime: ev.endTime,
    slotMinutes: ev.slotMinutes, changeoverMinutes: ev.changeoverMinutes, orderConfirmed: ev.orderConfirmed,
    talkRoomUrl: ev.talkRoomUrl, notice: ev.notice, scheduleNote: ev.scheduleNote,
  });
  const [links, setLinks] = useState(ev.links?.length ? ev.links : []);
  const [order, setOrder] = useState(state.teams.map((t) => t.id));
  useEffect(() => setOrder(state.teams.map((t) => t.id)), [state.teams.map((t) => t.id).join()]);
  const teamById = Object.fromEntries(state.teams.map((t) => [t.id, t]));
  const move = (i, d) => setOrder((o) => {
    const j = i + d;
    if (j < 0 || j >= o.length) return o;
    const c = [...o];
    [c[i], c[j]] = [c[j], c[i]];
    return c;
  });
  const orderChanged = order.join() !== state.teams.map((t) => t.id).join();

  const save = () => run(() => api.patch('/event', { ...f.values, links: links.filter((l) => l.label && l.url) }), '공연 정보를 저장했습니다.');
  const addPoster = async () => {
    const files = await pickFiles({ accept: 'image/*' });
    if (files.length) await run(() => uploadFiles('/event/posters', files, { images: true }), '포스터를 올렸습니다.');
  };

  return (
    <div class="admin-sections">
      <section class="block">
        <header class="block-head"><h2>기본 정보</h2></header>
        <div class="form-grid">
          <Field label="공연명" wide><input {...f.bind('title')} /></Field>
          <Field label="장소"><input {...f.bind('venue')} /></Field>
          <Field label="공연일"><input type="date" {...f.bind('eventDate')} /></Field>
          <Field label="시작"><input type="time" {...f.bind('startTime')} /></Field>
          <Field label="대관 종료"><input type="time" {...f.bind('endTime')} /></Field>
          <Field label="팀당 배정(분)"><input type="number" min="1" inputMode="numeric" {...f.bind('slotMinutes')} /></Field>
          <Field label="팀 전환(분)"><input type="number" min="0" inputMode="numeric" {...f.bind('changeoverMinutes')} /></Field>
          <Field label="대표자 톡방 링크" hint="팀 대표와 총괄대표에게만 보입니다." wide><input type="url" {...f.bind('talkRoomUrl')} /></Field>
          <Field label="공지" wide><textarea rows={4} {...f.bind('notice')} /></Field>
          <Field label="일정 메모" hint="리허설, 입장 시간 등. 공연 순서 아래에 표시됩니다." wide><textarea rows={3} {...f.bind('scheduleNote')} /></Field>
          <fieldset class="field field-wide">
            <legend class="field-label">바로가기 링크</legend>
            {links.map((l, i) => (
              <div class="link-row" key={i}>
                <input aria-label="이름" placeholder="이름 (예: 감마홀 장비 리스트)" value={l.label} onInput={(e) => setLinks(links.map((x, idx) => (idx === i ? { ...x, label: e.currentTarget.value } : x)))} />
                <input aria-label="주소" type="url" placeholder="https://" value={l.url} onInput={(e) => setLinks(links.map((x, idx) => (idx === i ? { ...x, url: e.currentTarget.value } : x)))} />
                <button class="icon-btn" aria-label="링크 삭제" onClick={() => setLinks(links.filter((_, idx) => idx !== i))}>✕</button>
              </div>
            ))}
            <Button small variant="quiet" onClick={() => setLinks([...links, { label: '', url: '' }])}>링크 추가</Button>
          </fieldset>
        </div>
        <div class="row-actions"><Button variant="primary" onClick={save}>저장</Button></div>
      </section>

      <section class="block">
        <header class="block-head"><h2>공연 순서</h2></header>
        {order.length ? (
          <ol class="order-edit">
            {order.map((id, i) => (
              <li key={id} style={teamStyle(teamById[id]?.themeColor)}>
                <span class="sl-no">{i + 1}</span>
                <TeamChip team={teamById[id]} />
                <span class="row-actions">
                  <button class="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="위로">↑</button>
                  <button class="icon-btn" disabled={i === order.length - 1} onClick={() => move(i, 1)} aria-label="아래로">↓</button>
                </span>
              </li>
            ))}
          </ol>
        ) : <p class="muted">팀을 먼저 추가하세요.</p>}
        <label class="check"><input type="checkbox" {...f.bind('orderConfirmed', 'checked')} onChange={(e) => { f.set('orderConfirmed', e.currentTarget.checked); run(() => api.patch('/event', { orderConfirmed: e.currentTarget.checked }), e.currentTarget.checked ? '순서를 확정으로 표시했습니다.' : '가안으로 표시했습니다.'); }} /> 순서 확정 (해제하면 &lsquo;가안&rsquo;으로 표시)</label>
        <div class="row-actions"><Button variant="primary" disabled={!orderChanged} onClick={() => run(() => api.put('/teams/order', { ids: order }), '공연 순서를 저장했습니다.')}>순서 저장</Button></div>
      </section>

      <section class="block">
        <header class="block-head"><h2>포스터</h2><Button small onClick={addPoster}>포스터 올리기</Button></header>
        {ev.posters?.length ? (
          <ul class="gallery">
            {ev.posters.map((p, i) => (
              <li key={p.fileId}>
                <img class="thumb-img" src={fileUrl(p.fileId)} alt={i === 0 ? '대표 포스터' : '포스터'} loading="lazy" />
                <div class="thumb-tools"><ConfirmButton onConfirm={() => run(() => api.del(`/event/posters/${p.fileId}`), '포스터를 삭제했습니다.')}>삭제</ConfirmButton></div>
              </li>
            ))}
          </ul>
        ) : <p class="muted">첫 번째 포스터가 홈에 표시됩니다.</p>}
      </section>
    </div>
  );
}

/* ---------- 팀 ---------- */
function TeamSettings() {
  const { state, run } = useApp();
  const f = useForm({ id: '', name: '' });
  return (
    <div class="admin-sections">
      <section class="block">
        <header class="block-head"><h2>팀 추가</h2></header>
        <div class="form-grid">
          <Field label="팀 이름"><input {...f.bind('name')} /></Field>
          <Field label="주소용 ID (선택)" hint="영문 소문자. 예: comorebi → /teams/comorebi"><input {...f.bind('id')} /></Field>
        </div>
        <div class="row-actions"><Button variant="primary" disabled={!f.values.name.trim()} onClick={() => run(() => api.post('/teams', f.values), '팀을 추가했습니다.').then(() => f.setValues({ id: '', name: '' }))}>팀 추가</Button></div>
      </section>
      <section class="block">
        <header class="block-head"><h2>팀 목록</h2></header>
        {state.teams.length ? (
          <ul class="simple-list">
            {state.teams.map((t) => (
              <li key={t.id}>
                <TeamChip team={t} />
                <code class="muted">/teams/{t.id}</code>
                <span class="row-actions">
                  <Button small variant="quiet" onClick={() => navigate(`/teams/${t.id}`)}>팀 페이지</Button>
                  <ConfirmButton confirmLabel="팀 삭제, 팀원 비밀번호 끄기" onConfirm={() => run(() => api.del(`/teams/${t.id}`), '팀을 삭제했습니다.')}>삭제</ConfirmButton>
                </span>
              </li>
            ))}
          </ul>
        ) : <Empty>아직 팀이 없습니다.</Empty>}
      </section>
    </div>
  );
}

/* ---------- 비밀번호(접속 링크) ---------- */
function IssuedPanel({ issued, onClose }) {
  const copy = useCopy();
  const all = issued.map((t) => `${t.label}: ${magicLink(t.token)}`).join('\n');
  return (
    <Modal title="발급된 비밀번호" onClose={onClose} wide>
      <p class="modal-lead">이 화면을 닫으면 다시 볼 수 없습니다. 지금 각자에게 보내세요. 잃어버리면 &lsquo;재발급&rsquo;하면 됩니다.</p>
      <ul class="issued">
        {issued.map((t) => (
          <li key={t.id}>
            <div>
              <strong>{t.label}</strong>
              <code class="code">{t.token}</code>
            </div>
            <span class="row-actions">
              <Button small onClick={() => copy(`${t.label}님, 연합공연 소통 사이트 접속 링크입니다.\n${magicLink(t.token)}\n링크를 누르면 바로 로그인됩니다. 직접 입력할 때 비밀번호: ${t.token}\n(다른 사람에게 공유하지 마세요.)`, '안내 문구를 복사했습니다.')}>안내 문구 복사</Button>
              <Button small variant="quiet" onClick={() => copy(magicLink(t.token), '접속 링크를 복사했습니다.')}>링크만</Button>
            </span>
          </li>
        ))}
      </ul>
      {issued.length > 1 && <div class="row-actions"><Button onClick={() => copy(all, '전체 링크를 복사했습니다.')}>전체 링크 복사</Button></div>}
    </Modal>
  );
}

function ReissueModal({ token, onDone, onClose }) {
  const { run } = useApp();
  const [custom, setCustom] = useState('');
  const go = () => run(() => api.post(`/admin/tokens/${token.id}/reissue`, { token: custom })).then((r) => onDone({ ...token, token: r.token }));
  return (
    <Modal title={`${token.label} 비밀번호 재발급`} onClose={onClose}>
      <p class="modal-lead">새 비밀번호를 만들면 이 사람의 기존 로그인은 모든 기기에서 끊깁니다.</p>
      <Field label="새 비밀번호 (선택)" hint="비워두면 자동 생성합니다. 직접 정하려면 영문·숫자 6자 이상.">
        <input value={custom} onInput={(e) => setCustom(e.currentTarget.value)} autocomplete="off" spellcheck={false} />
      </Field>
      <div class="row-actions">
        <Button variant="quiet" onClick={onClose}>취소</Button>
        <Button variant="primary" onClick={go}>재발급</Button>
      </div>
    </Modal>
  );
}

function TokenSettings() {
  const { state, run } = useApp();
  const [list, setList] = useState(null);
  const [issued, setIssued] = useState(null);
  const [reissuing, setReissuing] = useState(null);
  const f = useForm({ label: '', role: 'member', teamId: state.teams[0]?.id || '', note: '', token: '' });
  const load = () => api.get('/admin/tokens').then((r) => setList(r.tokens));
  useEffect(() => { load(); }, []);
  const teamById = Object.fromEntries(state.teams.map((t) => [t.id, t]));
  const byTeam = (list || []).reduce((acc, t) => { (acc[t.teamId || ''] ||= []).push(t); return acc; }, {});
  const groups = [...state.teams.map((t) => [t.id, t]), ['', null]].filter(([id]) => byTeam[id]?.length);

  const create = () => run(() => api.post('/admin/tokens', f.values)).then((r) => { setIssued([r]); f.setValues((v) => ({ ...v, label: '', token: '' })); load(); });
  const toggle = (t) => run(() => api.patch(`/admin/tokens/${t.id}`, { active: !t.active }), t.active ? '비활성화했습니다.' : '다시 활성화했습니다.').then(load);
  const remove = (t) => run(() => api.del(`/admin/tokens/${t.id}`), '삭제했습니다.').then(load);

  return (
    <div class="admin-sections">
      <section class="block">
        <header class="block-head"><h2>비밀번호 만들기</h2></header>
        <p class="muted">사람마다 하나씩 만드는 것을 권합니다. 한 사람이 빠지면 그 비밀번호만 끄면 됩니다.</p>
        <div class="form-grid">
          <Field label="이름"><input placeholder="예: 코모레비 대표 홍길동" {...f.bind('label')} /></Field>
          <Field label="역할">
            <select {...f.bind('role')}>
              <option value="member">팀 구성원: 보기, 제출 상태, 투표, 글쓰기</option>
              <option value="leader">팀 대표: + 팀 정보, 셋리스트, 이미지 편집</option>
              <option value="admin">총괄대표: 모든 관리</option>
            </select>
          </Field>
          <Field label="소속 팀">
            <select {...f.bind('teamId')}>
              <option value="">없음</option>
              {state.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          <Field label="비밀번호 (선택)" hint="비워두면 자동 생성. 직접 정하면 영문·숫자 6자 이상, 대소문자 구분 없음.">
            <input placeholder="예: comorebi-lead" autocomplete="off" spellcheck={false} {...f.bind('token')} />
          </Field>
          <Field label="메모" wide><input {...f.bind('note')} /></Field>
        </div>
        <div class="row-actions"><Button variant="primary" disabled={!f.values.label.trim()} onClick={create}>만들기</Button></div>
      </section>
      <section class="block">
        <header class="block-head"><h2>발급된 비밀번호</h2>{list && <span class="count">{list.length}</span>}</header>
        <p class="muted">보안을 위해 비밀번호 값은 저장하지 않습니다. 잊어버린 사람은 재발급하세요.</p>
        {!list ? <p class="muted">불러오는 중</p> : list.length ? groups.map(([id, team]) => (
          <div key={id || 'none'} class="token-group" style={teamStyle(team?.themeColor)}>
            <h3>{team ? <TeamChip team={team} /> : '팀 없음'}</h3>
            <ul class="token-list">
              {byTeam[id].map((t) => (
                <li key={t.id} class={t.active ? '' : 'inactive'}>
                  <div class="token-main">
                    <strong>{t.label}</strong>
                    <span class="muted">{t.roleLabel}{t.note ? `, ${t.note}` : ''}</span>
                  </div>
                  <span class="muted token-used">{t.active ? (t.lastUsedAt ? `${relativeTime(t.lastUsedAt)} 접속` : '아직 접속 안 함') : '꺼짐'}</span>
                  <span class="row-actions">
                    <Button small variant="quiet" onClick={() => setReissuing(t)}>재발급</Button>
                    <Button small variant="quiet" onClick={() => toggle(t)}>{t.active ? '끄기' : '켜기'}</Button>
                    <ConfirmButton onConfirm={() => remove(t)}>삭제</ConfirmButton>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )) : <Empty>발급된 비밀번호가 없습니다.</Empty>}
      </section>
      {reissuing && <ReissueModal token={reissuing} onClose={() => setReissuing(null)} onDone={(t) => { setReissuing(null); setIssued([t]); load(); }} />}
      {issued && <IssuedPanel issued={issued} onClose={() => setIssued(null)} />}
    </div>
  );
}

/* ---------- 데이터 ---------- */
/** 기존 사이트 데이터 가져오기 버튼 (홈 빈 화면에서도 사용) */
export function ImportButton({ force = false, label = 'import-data.json 선택', variant = 'primary' }) {
  const { run, toast, setOverlay } = useApp();
  const importFile = async () => {
    const [file] = await pickFiles({ accept: '.json,application/json', multiple: false });
    if (!file) return;
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      toast('JSON 파일을 읽을 수 없습니다.', 'error');
      return;
    }
    const r = await run(() => api.post('/admin/import', { ...data, force }), '기존 사이트 데이터를 가져왔습니다.');
    // 가져오기 후 홈 화면이 바뀌어도 사라지지 않도록 앱 전역 창으로 띄움
    if (r.tokens?.length) setOverlay(<IssuedPanel issued={r.tokens} onClose={() => setOverlay(null)} />);
  };
  return <Button variant={force ? 'danger' : variant} onClick={importFile}>{label}</Button>;
}

function DataSettings() {
  const { state } = useApp();
  const [force, setForce] = useState(false);
  return (
    <div class="admin-sections">
      <section class="block">
        <header class="block-head"><h2>백업</h2></header>
        <p class="muted">전체 데이터를 JSON으로 내려받습니다. 이미지 파일 자체는 포함되지 않습니다.</p>
        <div class="row-actions"><a class="btn btn-default" href="/api/admin/export" download>백업 내려받기</a></div>
      </section>
      <section class="block">
        <header class="block-head"><h2>기존 사이트 데이터 가져오기</h2></header>
        <p class="muted">Apps Script 시트에서 변환한 <code>import-data.json</code>을 올립니다. 팀·셋리스트·이미지·취합·투표·규약·공지가 들어오고, 비밀번호는 사람별로 새로 발급되어 결과 화면에서 한 번만 보입니다.</p>
        {state.teams.length > 0 && (
          <label class="check"><input type="checkbox" checked={force} onChange={(e) => setForce(e.currentTarget.checked)} /> 기존 데이터 지우고 다시 가져오기 (발급된 비밀번호는 유지)</label>
        )}
        <div class="row-actions"><ImportButton force={force} /></div>
      </section>
    </div>
  );
}

const TABS = { event: '공연 정보', teams: '팀', tokens: '비밀번호', data: '데이터' };

export function Admin({ tab = 'event' }) {
  const current = TABS[tab] ? tab : 'event';
  return (
    <div>
      <PageHead title="관리" />
      <Segmented value={current} onChange={(v) => navigate(`/admin/${v}`, { replace: true })} options={Object.entries(TABS).map(([value, label]) => ({ value, label }))} />
      {current === 'event' && <EventSettings />}
      {current === 'teams' && <TeamSettings />}
      {current === 'tokens' && <TokenSettings />}
      {current === 'data' && <DataSettings />}
    </div>
  );
}
