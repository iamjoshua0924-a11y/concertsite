import { useState } from 'preact/hooks';
import { api } from '../api.js';
import { Link, useApp } from '../app.jsx';
import { Button, ConfirmButton, DueBadge, Empty, Field, Modal, PageHead, RichText, StatusGlyph, TeamChip, useForm } from '../components/ui.jsx';
import { COLLECTION_STATUS, cx, daysUntil, formatDate, relativeTime, teamStyle } from '../util.js';

function CellEditor({ col, team, onClose }) {
  const { run } = useApp();
  const cur = col.progress[team.id] || {};
  const [status, setStatus] = useState(cur.status || 'todo');
  const [note, setNote] = useState(cur.note || '');
  const save = () => run(() => api.put(`/collections/${col.id}/progress/${team.id}`, { status, note }), '상태를 저장했습니다.').then(onClose);
  return (
    <Modal title={`${col.title}`} onClose={onClose}>
      <p class="modal-lead"><TeamChip team={team} /></p>
      {col.description && <RichText class="muted" text={col.description} />}
      <div class="status-pick" role="radiogroup" aria-label="상태">
        {Object.entries(COLLECTION_STATUS).map(([k, v]) => (
          <button key={k} role="radio" aria-checked={status === k} class={cx(`status-opt status-${k}`, status === k && 'on')} onClick={() => setStatus(k)}>
            <i class="dot" aria-hidden="true" />{v.label}
          </button>
        ))}
      </div>
      <Field label="메모" hint="예: 로고 제작 중, 이번 주 금요일까지">
        <input value={note} onInput={(e) => setNote(e.currentTarget.value)} maxLength={500} />
      </Field>
      {cur.updatedAt && <p class="fineprint">마지막 변경: {cur.updatedBy}, {relativeTime(cur.updatedAt)}</p>}
      <div class="row-actions">
        <Button variant="quiet" onClick={onClose}>취소</Button>
        <Button variant="primary" onClick={save}>저장</Button>
      </div>
    </Modal>
  );
}

function CollectionForm({ col, teams, onClose }) {
  const { run } = useApp();
  const f = useForm({
    title: col?.title || '', description: col?.description || '', dueDate: col?.dueDate || '',
    targetTeamIds: col?.targetTeamIds || teams.map((t) => t.id),
  });
  const toggle = (id) => f.set('targetTeamIds', f.values.targetTeamIds.includes(id) ? f.values.targetTeamIds.filter((x) => x !== id) : [...f.values.targetTeamIds, id]);
  const save = () => run(
    () => (col ? api.patch(`/collections/${col.id}`, f.values) : api.post('/collections', f.values)),
    col ? '항목을 수정했습니다.' : '제출 항목을 만들었습니다.',
  ).then(onClose);
  return (
    <Modal title={col ? '제출 항목 수정' : '새 제출 항목'} onClose={onClose}>
      <div class="form-grid">
        <Field label="항목 이름" wide><input placeholder="예: 셋리스트 최종본" {...f.bind('title')} /></Field>
        <Field label="설명" wide><textarea rows={3} placeholder="무엇을 어디에 내면 되는지" {...f.bind('description')} /></Field>
        <Field label="마감일"><input type="date" {...f.bind('dueDate')} /></Field>
        <fieldset class="field field-wide">
          <legend class="field-label">대상 팀</legend>
          <div class="check-chips">
            {teams.map((t) => (
              <label key={t.id} class="check-chip" style={teamStyle(t.themeColor)}>
                <input type="checkbox" checked={f.values.targetTeamIds.includes(t.id)} onChange={() => toggle(t.id)} />{t.name}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <div class="row-actions">
        <Button variant="quiet" onClick={onClose}>취소</Button>
        <Button variant="primary" onClick={save}>{col ? '저장' : '만들기'}</Button>
      </div>
    </Modal>
  );
}

function reminderText(col, teams) {
  const pending = teams.filter((t) => col.targetTeamIds.includes(t.id) && col.progress[t.id]?.status !== 'done');
  if (!pending.length) return `[${col.title}] 모든 팀 완료`;
  const due = col.dueDate ? ` (마감 ${formatDate(col.dueDate)})` : '';
  const list = pending.map((t) => {
    const p = col.progress[t.id];
    return p?.status === 'doing' ? `${t.name}(작성중)` : t.name;
  }).join(', ');
  return `[${col.title}]${due}\n아직 안 낸 팀: ${list}\n사이트에서 상태를 바꿔주세요: ${window.location.origin}/progress`;
}

export function Progress() {
  const { state, run, toast } = useApp();
  const { collections, teams, me } = state;
  const isAdmin = me.role === 'admin';
  const [cell, setCell] = useState(null);
  const [form, setForm] = useState(null);
  const [showClosed, setShowClosed] = useState(false);

  const visible = collections.filter((c) => showClosed || c.status === 'open');
  const closedCount = collections.filter((c) => c.status === 'closed').length;
  const canEditCell = (col, teamId) => isAdmin || (col.status === 'open' && me.teamId === teamId);

  const copy = async (col) => {
    try {
      await navigator.clipboard.writeText(reminderText(col, teams));
      toast('독촉 문구를 복사했습니다. 톡방에 붙여넣으세요.');
    } catch {
      toast('복사하지 못했습니다. 브라우저 권한을 확인하세요.', 'error');
    }
  };

  return (
    <div>
      <PageHead
        title="진행"
        sub="팀별 제출 현황입니다. 우리 팀 칸을 눌러 상태를 바꾸세요."
        actions={isAdmin && <Button variant="primary" onClick={() => setForm({})}>새 제출 항목</Button>}
      />
      <nav class="subnav"><Link href="/progress" class="on" aria-current="page">제출 현황</Link><Link href="/polls">투표</Link></nav>

      {!teams.length ? (
        <Empty>팀이 등록되면 제출 현황이 표시됩니다.</Empty>
      ) : visible.length ? (
        <>
        <ul class="col-cards">
          {visible.map((c) => {
            const dd = daysUntil(c.dueDate);
            const order = [...teams].sort((a, b) => (b.id === me.teamId) - (a.id === me.teamId)).filter((t) => c.targetTeamIds.includes(t.id));
            return (
              <li key={c.id} class={cx('col-card', c.status === 'closed' && 'closed')}>
                <div class="col-card-head">
                  <strong>{c.title}</strong>
                  {c.status === 'closed' ? <span class="tag">마감됨</span> : <DueBadge due={c.dueDate} dday={dd} />}
                </div>
                <ul class="col-card-teams">
                  {order.map((t) => {
                    const p = c.progress[t.id];
                    const st = p?.status || 'todo';
                    const late = st !== 'done' && dd != null && dd < 0 && c.status === 'open';
                    const inner = (
                      <>
                        <TeamChip team={t} small />
                        <StatusGlyph status={st} />
                        {p?.note && <span class="m-note">{p.note}</span>}
                      </>
                    );
                    return (
                      <li key={t.id} class={cx(`st-${st}`, late && 'late', t.id === me.teamId && 'mine')}>
                        {canEditCell(c, t.id) ? <button class="cc-btn" onClick={() => setCell({ col: c, team: t })}>{inner}<span class="cc-edit">바꾸기</span></button> : <div class="cc-btn">{inner}</div>}
                      </li>
                    );
                  })}
                </ul>
                {isAdmin && (
                  <div class="m-tools">
                    <button class="link-btn" onClick={() => copy(c)}>독촉 문구 복사</button>
                    <button class="link-btn" onClick={() => setForm({ col: c })}>수정</button>
                    <button class="link-btn" onClick={() => run(() => api.patch(`/collections/${c.id}`, { status: c.status === 'open' ? 'closed' : 'open' }), c.status === 'open' ? '마감했습니다.' : '다시 열었습니다.')}>{c.status === 'open' ? '마감' : '다시 열기'}</button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <div class="matrix-wrap">
          <table class="matrix" style={{ '--cols': teams.length }}>
            <thead>
              <tr>
                <th scope="col" class="m-item">항목</th>
                {teams.map((t) => (
                  <th scope="col" key={t.id} style={teamStyle(t.themeColor)} class={cx(t.id === me.teamId && 'mine')}>
                    <span class="m-team"><i aria-hidden="true" />{t.name}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => {
                const dd = daysUntil(c.dueDate);
                return (
                  <tr key={c.id} class={cx(c.status === 'closed' && 'closed')}>
                    <th scope="row" class="m-item">
                      <strong>{c.title}</strong>
                      <span class="m-meta">
                        {c.status === 'closed' ? <span class="tag">마감됨</span> : <DueBadge due={c.dueDate} dday={dd} />}
                      </span>
                      {isAdmin && (
                        <span class="m-tools">
                          <button class="link-btn" onClick={() => copy(c)}>독촉 문구 복사</button>
                          <button class="link-btn" onClick={() => setForm({ col: c })}>수정</button>
                          <button class="link-btn" onClick={() => run(() => api.patch(`/collections/${c.id}`, { status: c.status === 'open' ? 'closed' : 'open' }), c.status === 'open' ? '마감했습니다.' : '다시 열었습니다.')}>{c.status === 'open' ? '마감' : '다시 열기'}</button>
                          <ConfirmButton onConfirm={() => run(() => api.del(`/collections/${c.id}`), '삭제했습니다.')}>삭제</ConfirmButton>
                        </span>
                      )}
                    </th>
                    {teams.map((t) => {
                      if (!c.targetTeamIds.includes(t.id)) return <td key={t.id} class="m-na" aria-label="대상 아님">–</td>;
                      const p = c.progress[t.id];
                      const st = p?.status || 'todo';
                      const late = st !== 'done' && dd != null && dd < 0 && c.status === 'open';
                      const editable = canEditCell(c, t.id);
                      const content = (
                        <>
                          <StatusGlyph status={st} />
                          {p?.note && <span class="m-note">{p.note}</span>}
                        </>
                      );
                      return (
                        <td key={t.id} class={cx(`m-cell st-${st}`, late && 'late', t.id === me.teamId && 'mine')}>
                          {editable ? <button class="m-btn" onClick={() => setCell({ col: c, team: t })} aria-label={`${t.name} ${c.title} 상태 변경`}>{content}</button> : <div class="m-btn static">{content}</div>}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      ) : (
        <Empty action={isAdmin && <Button onClick={() => setForm({})}>새 제출 항목</Button>}>진행 중인 제출 항목이 없습니다.</Empty>
      )}
      {closedCount > 0 && (
        <button class="link-btn show-closed" onClick={() => setShowClosed((v) => !v)}>
          {showClosed ? '마감된 항목 숨기기' : `마감된 항목 ${closedCount}개 보기`}
        </button>
      )}
      {cell && <CellEditor col={cell.col} team={cell.team} onClose={() => setCell(null)} />}
      {form && <CollectionForm col={form.col} teams={teams} onClose={() => setForm(null)} />}
    </div>
  );
}
