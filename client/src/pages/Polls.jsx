import { useState } from 'preact/hooks';
import { api } from '../api.js';
import { Link, useApp } from '../app.jsx';
import { Button, ConfirmButton, DueBadge, Empty, Field, Modal, PageHead, RichText, TeamChip, useForm } from '../components/ui.jsx';
import { cx, daysUntil } from '../util.js';

const NAME_KEY = 'cs_voter_name';
function savedName(fallback) {
  try { return localStorage.getItem(NAME_KEY) || fallback; } catch { return fallback; }
}

function PollCard({ poll, teams, me }) {
  const { run } = useApp();
  const [choice, setChoice] = useState(poll.myVote?.optionId || '');
  const [name, setName] = useState(poll.myVote?.name || savedName(me.label));
  const [comment, setComment] = useState(poll.myVote?.comment || '');
  const [showVoters, setShowVoters] = useState(false);
  const isAdmin = me.role === 'admin';
  const target = teams.find((t) => t.id === poll.targetTeamId);
  const eligible = !poll.targetTeamId || isAdmin || me.teamId === poll.targetTeamId;
  const max = Math.max(1, ...poll.options.map((o) => o.votes || 0));
  const changed = choice && choice !== poll.myVote?.optionId;

  const vote = () => {
    try { if (!poll.anonymous) localStorage.setItem(NAME_KEY, name); } catch { /* 무시 */ }
    return run(() => api.put(`/polls/${poll.id}/vote`, { optionId: choice, name, comment }), poll.myVote ? '선택을 바꿨습니다.' : '투표했습니다.');
  };

  const rules = [
    poll.anonymous ? '익명' : '실명',
    poll.voteScope === 'team' ? '팀당 1표' : '1인 1표',
    poll.showResults === 'afterClose' ? '결과는 마감 후 공개' : null,
  ].filter(Boolean).join(', ');

  return (
    <article class={cx('poll', !poll.isOpen && 'poll-closed')} id={poll.id}>
      <header class="poll-head">
        <div>
          <h2>{poll.title}</h2>
          <p class="poll-rules">{rules}</p>
        </div>
        <div class="poll-badges">
          {target && <TeamChip team={target} small />}
          {poll.isOpen ? <DueBadge due={poll.dueDate} dday={daysUntil(poll.dueDate)} /> : <span class="tag">마감됨</span>}
        </div>
      </header>
      {poll.description && <RichText class="poll-desc" text={poll.description} />}

      <ul class="poll-options" role={poll.isOpen && eligible ? 'radiogroup' : undefined} aria-label="선택지">
        {poll.options.map((o) => {
          const pct = poll.resultsVisible && poll.totalVotes ? Math.round(((o.votes || 0) / poll.totalVotes) * 100) : 0;
          const mine = poll.myVote?.optionId === o.id;
          const selectable = poll.isOpen && eligible;
          return (
            <li key={o.id}>
              <label class={cx('opt', choice === o.id && 'on', mine && 'mine', !selectable && 'readonly')}>
                {selectable && <input type="radio" name={`poll-${poll.id}`} checked={choice === o.id} onChange={() => setChoice(o.id)} />}
                <span class="opt-bar" style={{ width: poll.resultsVisible ? `${((o.votes || 0) / max) * 100}%` : 0 }} aria-hidden="true" />
                <span class="opt-label">{o.label}{mine && <em>내 선택</em>}</span>
                {poll.resultsVisible && <span class="opt-count">{o.votes}표{poll.totalVotes ? ` ${pct}%` : ''}</span>}
              </label>
            </li>
          );
        })}
      </ul>

      {poll.isOpen && eligible && (
        <div class="poll-form">
          {!poll.anonymous && (
            <Field label="이름"><input value={name} onInput={(e) => setName(e.currentTarget.value)} maxLength={40} /></Field>
          )}
          <Field label="메모 (선택)"><input value={comment} onInput={(e) => setComment(e.currentTarget.value)} maxLength={200} placeholder={poll.anonymous ? '' : '예: 팀 전원 동의'} /></Field>
          <div class="row-actions">
            {poll.myVote && <Button variant="quiet" small onClick={() => run(() => api.del(`/polls/${poll.id}/vote`), '투표를 취소했습니다.').then(() => setChoice(''))}>투표 취소</Button>}
            <Button variant="primary" disabled={!choice || (poll.myVote && !changed && comment === (poll.myVote.comment || ''))} onClick={vote}>
              {poll.myVote ? '선택 바꾸기' : '투표하기'}
            </Button>
          </div>
        </div>
      )}
      {poll.isOpen && !eligible && <p class="fineprint">{target?.name} 팀 대상 투표입니다.</p>}

      <footer class="poll-foot">
        <span>{poll.resultsVisible ? `총 ${poll.totalVotes}표` : `${poll.totalVotes}명 참여, 결과는 마감 후 공개`}</span>
        {poll.voters.length > 0 && <button class="link-btn" onClick={() => setShowVoters((v) => !v)}>{showVoters ? '명단 접기' : '누가 뭘 골랐나'}</button>}
        {isAdmin && (
          <span class="poll-admin">
            <button class="link-btn" onClick={() => run(() => api.patch(`/polls/${poll.id}`, { status: poll.status === 'closed' ? 'open' : 'closed' }), poll.status === 'closed' ? '다시 열었습니다.' : '마감했습니다.')}>
              {poll.status === 'closed' ? '다시 열기' : '마감'}
            </button>
            <ConfirmButton onConfirm={() => run(() => api.del(`/polls/${poll.id}`), '투표를 삭제했습니다.')}>삭제</ConfirmButton>
          </span>
        )}
      </footer>
      {showVoters && (
        <ul class="voters">
          {poll.voters.map((v, i) => (
            <li key={i}>
              <strong>{v.name}</strong>
              {v.teamName && <span class="muted">{v.teamName}</span>}
              <span>{poll.options.find((o) => o.id === v.optionId)?.label}</span>
              {v.comment && <span class="muted">“{v.comment}”</span>}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function PollForm({ teams, onClose }) {
  const { run } = useApp();
  const f = useForm({ title: '', description: '', options: '', dueDate: '', targetTeamId: '', anonymous: false, voteScope: 'person', showResults: 'always' });
  const save = () => run(() => api.post('/polls', { ...f.values, options: f.values.options.split('\n') }), '투표를 만들었습니다.').then(onClose);
  return (
    <Modal title="새 투표" onClose={onClose}>
      <div class="form-grid">
        <Field label="질문" wide><input placeholder="예: 리허설 시작 시간" {...f.bind('title')} /></Field>
        <Field label="설명" wide><textarea rows={2} {...f.bind('description')} /></Field>
        <Field label="선택지" hint="한 줄에 하나씩, 2개 이상" wide><textarea rows={4} placeholder={'13:00\n14:00\n15:00'} {...f.bind('options')} /></Field>
        <Field label="마감일"><input type="date" {...f.bind('dueDate')} /></Field>
        <Field label="대상">
          <select {...f.bind('targetTeamId')}>
            <option value="">전체 팀</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}만</option>)}
          </select>
        </Field>
        <Field label="투표 단위">
          <select {...f.bind('voteScope')}>
            <option value="person">1인 1표</option>
            <option value="team">팀당 1표 (팀원 누구나, 마지막 선택이 팀 의견)</option>
          </select>
        </Field>
        <Field label="결과 공개">
          <select {...f.bind('showResults')}>
            <option value="always">바로 공개</option>
            <option value="afterClose">마감 후 공개</option>
          </select>
        </Field>
        <label class="check field-wide"><input type="checkbox" {...f.bind('anonymous', 'checked')} /> 익명 투표 (이름과 팀을 아무에게도 표시하지 않음)</label>
      </div>
      <div class="row-actions">
        <Button variant="quiet" onClick={onClose}>취소</Button>
        <Button variant="primary" onClick={save}>만들기</Button>
      </div>
    </Modal>
  );
}

export function Polls() {
  const { state } = useApp();
  const { polls, teams, me } = state;
  const [form, setForm] = useState(false);
  const open = polls.filter((p) => p.isOpen);
  const closed = polls.filter((p) => !p.isOpen);
  return (
    <div>
      <PageHead
        title="진행"
        sub="마감 전까지 언제든 선택을 바꿀 수 있습니다."
        actions={me.role === 'admin' && <Button variant="primary" onClick={() => setForm(true)}>새 투표</Button>}
      />
      <nav class="subnav"><Link href="/progress">제출 현황</Link><Link href="/polls" class="on" aria-current="page">투표</Link></nav>
      {open.length ? (
        <div class="poll-list">{open.map((p) => <PollCard key={p.id + (p.myVote?.optionId || '')} poll={p} teams={teams} me={me} />)}</div>
      ) : (
        <Empty>진행 중인 투표가 없습니다.</Empty>
      )}
      {closed.length > 0 && (
        <details class="closed-polls">
          <summary>마감된 투표 {closed.length}개</summary>
          <div class="poll-list">{closed.map((p) => <PollCard key={p.id} poll={p} teams={teams} me={me} />)}</div>
        </details>
      )}
      {form && <PollForm teams={teams} onClose={() => setForm(false)} />}
    </div>
  );
}
