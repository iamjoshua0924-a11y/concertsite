import { useState } from 'preact/hooks';
import { api, fileUrl, pickFiles, uploadFiles } from '../api.js';
import { Link, navigate, useApp } from '../app.jsx';
import { Button, ConfirmButton, Empty, Field, Lightbox, Modal, PageHead, RichText, useForm } from '../components/ui.jsx';
import { cx, formatDuration, setlistSeconds, teamStyle } from '../util.js';

function canEditTeam(me, teamId) {
  return me.role === 'admin' || (me.can.editOwnTeam && me.teamId === teamId);
}

function TeamInfoEditor({ team, onClose }) {
  const { run } = useApp();
  const f = useForm({
    name: team.name, intro: team.intro, snsUrl: team.snsUrl, memberCount: team.memberCount ?? '',
    instruments: team.instruments, leaderName: team.leaderName, leaderContact: team.leaderContact, themeColor: team.themeColor || '#1D4FB5',
  });
  const save = () => run(() => api.patch(`/teams/${team.id}`, f.values), '팀 정보를 저장했습니다.').then(onClose);
  return (
    <Modal title="팀 정보 수정" onClose={onClose}>
      <div class="form-grid">
        <Field label="팀 이름" wide><input {...f.bind('name')} /></Field>
        <Field label="팀 소개" wide><textarea rows={4} {...f.bind('intro')} /></Field>
        <Field label="인원수"><input type="number" min="1" max="50" inputMode="numeric" {...f.bind('memberCount')} /></Field>
        <Field label="테마 색상" hint="팀 칩, 공연 순서, 진행표에 쓰입니다.">
          <span class="color-input"><input type="color" {...f.bind('themeColor')} /><code>{f.values.themeColor}</code></span>
        </Field>
        <Field label="구성 악기" wide><input placeholder="보컬 2, 기타, 베이스, 드럼, 건반" {...f.bind('instruments')} /></Field>
        <Field label="SNS 링크" wide><input type="url" placeholder="https://" {...f.bind('snsUrl')} /></Field>
        <Field label="대표자 이름"><input {...f.bind('leaderName')} /></Field>
        <Field label="대표자 연락처" hint="팀 대표와 총괄대표, 같은 팀에게만 보입니다."><input type="tel" {...f.bind('leaderContact')} /></Field>
      </div>
      <div class="row-actions">
        <Button variant="quiet" onClick={onClose}>취소</Button>
        <Button variant="primary" onClick={save}>저장</Button>
      </div>
    </Modal>
  );
}

const emptyRow = () => ({ id: '', title: '', artist: '', duration: '', cue: '', note: '' });

/** "곡명 - 아티스트 3:45" 형식 여러 줄 붙여넣기 */
function parseBulk(textValue) {
  return textValue.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
    const dm = line.match(/\s(\d{1,2}:[0-5]\d)\s*$/);
    const duration = dm ? dm[1] : '';
    const rest = dm ? line.slice(0, dm.index).trim() : line;
    const [title, ...artist] = rest.split(/\s+[-–/]\s+/);
    return { ...emptyRow(), title: title.trim(), artist: artist.join(' - ').trim(), duration };
  });
}

function SetlistEditor({ team, slot, onDone }) {
  const { run } = useApp();
  const [rows, setRows] = useState(() => (team.setlist.length ? team.setlist.map((s) => ({ ...s, duration: formatDuration(s.duration) })) : [emptyRow()]));
  const [bulk, setBulk] = useState('');
  const [showBulk, setShowBulk] = useState(false);

  const update = (i, key, val) => setRows((r) => r.map((row, idx) => (idx === i ? { ...row, [key]: val } : row)));
  const move = (i, d) => setRows((r) => {
    const j = i + d;
    if (j < 0 || j >= r.length) return r;
    const c = [...r];
    [c[i], c[j]] = [c[j], c[i]];
    return c;
  });
  const total = rows.reduce((acc, r) => {
    const m = /^(\d{1,2}):([0-5]\d)$/.exec(r.duration || '');
    return acc + (m ? Number(m[1]) * 60 + Number(m[2]) : 0);
  }, 0);

  const save = () => run(
    () => api.put(`/teams/${team.id}/setlist`, { items: rows.filter((r) => r.title.trim()) }),
    '셋리스트를 저장했습니다.',
  ).then(onDone);

  return (
    <div class="setlist-editor">
      <ol class="sl-edit-list">
        {rows.map((r, i) => (
          <li key={i} class="sl-edit-row">
            <span class="sl-no">{i + 1}</span>
            <div class="sl-edit-fields">
              <input aria-label="곡명" placeholder="곡명" value={r.title} onInput={(e) => update(i, 'title', e.currentTarget.value)} />
              <input aria-label="아티스트" placeholder="아티스트" value={r.artist} onInput={(e) => update(i, 'artist', e.currentTarget.value)} />
              <input aria-label="러닝타임" placeholder="3:45" inputMode="numeric" class="sl-dur" value={r.duration} onInput={(e) => update(i, 'duration', e.currentTarget.value)} />
              <input aria-label="큐시트" placeholder="큐시트 (조명, MTR, 음향 요청)" class="sl-wide" value={r.cue} onInput={(e) => update(i, 'cue', e.currentTarget.value)} />
              <input aria-label="비고" placeholder="비고" class="sl-wide" value={r.note} onInput={(e) => update(i, 'note', e.currentTarget.value)} />
            </div>
            <div class="sl-edit-tools">
              <button class="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="위로">↑</button>
              <button class="icon-btn" onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label="아래로">↓</button>
              <button class="icon-btn" onClick={() => setRows((rr) => rr.filter((_, idx) => idx !== i))} aria-label="삭제">✕</button>
            </div>
          </li>
        ))}
      </ol>
      <div class="sl-edit-foot">
        <Button small onClick={() => setRows((r) => [...r, emptyRow()])}>곡 추가</Button>
        <Button small variant="quiet" onClick={() => setShowBulk((v) => !v)}>여러 곡 붙여넣기</Button>
        <span class={cx('sl-total', total / 60 > slot && 'over')}>합계 {formatDuration(total)} / 배정 {slot}분</span>
      </div>
      {showBulk && (
        <div class="bulk">
          <textarea rows={5} value={bulk} onInput={(e) => setBulk(e.currentTarget.value)} placeholder={'한 줄에 한 곡: 곡명 - 아티스트 3:45\n로키 - 미키토P 3:45'} />
          <Button small onClick={() => { setRows((r) => [...r.filter((x) => x.title.trim()), ...parseBulk(bulk)]); setBulk(''); setShowBulk(false); }}>목록에 추가</Button>
        </div>
      )}
      <div class="row-actions">
        <Button variant="quiet" onClick={onDone}>취소</Button>
        <Button variant="primary" onClick={save}>셋리스트 저장</Button>
      </div>
    </div>
  );
}

function Setlist({ team, slot, editable }) {
  const [editing, setEditing] = useState(false);
  const total = setlistSeconds(team.setlist);
  const missing = team.setlist.filter((x) => !x.duration).length;
  const pct = Math.min(100, (total / 60 / slot) * 100);
  return (
    <section class="block">
      <header class="block-head">
        <h2>셋리스트</h2>
        {team.setlist.length > 0 && <span class="count">{team.setlist.length}곡</span>}
        {editable && !editing && <Button small onClick={() => setEditing(true)}>{team.setlist.length ? '편집' : '입력'}</Button>}
      </header>
      {editing ? (
        <SetlistEditor team={team} slot={slot} onDone={() => setEditing(false)} />
      ) : team.setlist.length ? (
        <>
          <div class={cx('gauge', total / 60 > slot && 'over')} role="img" aria-label={`곡 합계 ${formatDuration(total)}, 배정 ${slot}분`}>
            <span style={{ width: `${pct}%` }} />
          </div>
          <p class="gauge-label">곡 합계 {formatDuration(total)} / 배정 {slot}분{total / 60 > slot ? ', 배정 시간 초과' : ''}{missing > 0 && <span class="muted">, {missing}곡은 러닝타임 미입력</span>}</p>
          <ol class="setlist">
            {team.setlist.map((s, i) => (
              <li key={s.id}>
                <span class="sl-no">{i + 1}</span>
                <div class="sl-main">
                  <strong>{s.title}</strong>
                  {s.artist && <span class="sl-artist">{s.artist}</span>}
                  {s.cue && <p class="sl-cue">{s.cue}</p>}
                  {s.note && <p class="sl-note">{s.note}</p>}
                </div>
                <span class="sl-dur">{formatDuration(s.duration) || '–'}</span>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <Empty action={editable && <Button small onClick={() => setEditing(true)}>셋리스트 입력</Button>}>아직 셋리스트가 없습니다.</Empty>
      )}
    </section>
  );
}

function Gallery({ team, editable }) {
  const { run } = useApp();
  const [open, setOpen] = useState(null);
  const upload = async () => {
    const files = await pickFiles({ accept: 'image/*' });
    if (files.length) await run(() => uploadFiles(`/teams/${team.id}/images`, files, { images: true }), `이미지 ${files.length}장을 올렸습니다.`);
  };
  const imgs = team.images.map((i) => ({ ...i, alt: `${team.name} 이미지` }));
  return (
    <section class="block">
      <header class="block-head">
        <h2>팀 이미지</h2>
        {editable && <Button small onClick={upload}>이미지 올리기</Button>}
      </header>
      {imgs.length ? (
        <ul class="gallery">
          {imgs.map((img, i) => (
            <li key={img.fileId} class={i === 0 ? 'cover' : ''}>
              <button class="thumb" onClick={() => setOpen(i)} aria-label={`${i + 1}번째 이미지 크게 보기`}>
                <img src={fileUrl(img.fileId)} alt={img.alt} loading="lazy" />
              </button>
              {editable && (
                <div class="thumb-tools">
                  {i > 0 && <Button small variant="quiet" onClick={() => run(() => api.post(`/teams/${team.id}/images/${img.fileId}/cover`), '대표 이미지로 바꿨습니다.')}>대표로</Button>}
                  <ConfirmButton onConfirm={() => run(() => api.del(`/teams/${team.id}/images/${img.fileId}`), '이미지를 삭제했습니다.')}>삭제</ConfirmButton>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <Empty action={editable && <Button small onClick={upload}>이미지 올리기</Button>}>프로필 사진이나 로고를 올려주세요.</Empty>
      )}
      {open != null && <Lightbox images={imgs} index={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

export function Teams({ teamId }) {
  const { state } = useApp();
  const { teams, me, event } = state;
  const [editInfo, setEditInfo] = useState(false);

  if (!teams.length) {
    return (
      <>
        <PageHead title="팀" />
        <Empty action={me.role === 'admin' && <Link href="/admin/teams" class="btn btn-primary">팀 추가하기</Link>}>등록된 팀이 없습니다.</Empty>
      </>
    );
  }
  const team = teams.find((t) => t.id === teamId) || teams.find((t) => t.id === me.teamId) || teams[0];
  const editable = canEditTeam(me, team.id);
  const slot = Number(event.slotMinutes) || 40;

  return (
    <div class="team-page" style={teamStyle(team.themeColor)}>
      <nav class="team-switch" aria-label="팀 선택">
        {teams.map((t) => (
          <button key={t.id} style={teamStyle(t.themeColor)} class={cx('team-tab', t.id === team.id && 'on')} aria-current={t.id === team.id ? 'page' : undefined} onClick={() => navigate(`/teams/${t.id}`, { replace: true })}>
            <i aria-hidden="true" />{t.name}{t.id === me.teamId && <small>우리 팀</small>}
          </button>
        ))}
      </nav>

      <header class="team-head">
        <div>
          <h1>{team.name}</h1>
          {team.intro && <RichText class="team-intro" text={team.intro} />}
        </div>
        {editable && <Button onClick={() => setEditInfo(true)}>팀 정보 수정</Button>}
      </header>

      <dl class="team-facts">
        <div><dt>인원</dt><dd>{team.memberCount ? `${team.memberCount}명` : '–'}</dd></div>
        <div><dt>구성 악기</dt><dd>{team.instruments || '–'}</dd></div>
        <div><dt>대표자</dt><dd>{team.leaderName || '–'}</dd></div>
        <div><dt>연락처</dt><dd>{team.leaderContact ? <a href={`tel:${team.leaderContact.replace(/[^\d+]/g, '')}`}>{team.leaderContact}</a> : team.contactHidden ? <span class="muted">대표자에게만 공개</span> : '–'}</dd></div>
        {team.snsUrl && <div><dt>SNS</dt><dd><a href={team.snsUrl} target="_blank" rel="noopener">{team.snsUrl.replace(/^https?:\/\/(www\.)?/, '')}</a></dd></div>}
      </dl>

      <div class="team-grid">
        <Setlist team={team} slot={slot} editable={editable} />
        <Gallery team={team} editable={editable} />
      </div>
      {editInfo && <TeamInfoEditor team={team} onClose={() => setEditInfo(false)} />}
    </div>
  );
}
