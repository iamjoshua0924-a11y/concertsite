import { useEffect, useState } from 'preact/hooks';
import { api, pickFiles, uploadFiles } from '../api.js';
import { navigate, useApp } from '../app.jsx';
import { Attachments, Button, ConfirmButton, Empty, Field, Modal, PageHead, RichText, Segmented, TeamChip, useForm } from '../components/ui.jsx';
import { cx, formatDate, relativeTime } from '../util.js';

function AttachPicker({ files, setFiles }) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const add = async () => {
    const picked = await pickFiles();
    if (!picked.length) return;
    setBusy(true);
    try {
      const r = await uploadFiles('/files', picked);
      setFiles([...files, ...r.files]);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="attach-picker">
      {files.map((f) => (
        <span key={f.fileId} class="attach-chip">{f.name}<button class="icon-btn" aria-label={`${f.name} 빼기`} onClick={() => setFiles(files.filter((x) => x.fileId !== f.fileId))}>✕</button></span>
      ))}
      <Button small variant="quiet" onClick={add} disabled={busy}>{busy ? '올리는 중' : '파일 첨부'}</Button>
    </div>
  );
}

/* ---------- 회의록 ---------- */
function MeetingForm({ meeting, me, onClose }) {
  const { run } = useApp();
  const f = useForm({
    title: meeting?.title || '', date: meeting?.date || new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10),
    content: meeting?.content || '', decisions: (meeting?.decisions || []).join('\n'), pinned: meeting?.pinned || false,
    author: meeting?.author || me.label,
  });
  const [actions, setActions] = useState(meeting?.actions?.length ? meeting.actions : []);
  const [files, setFiles] = useState(meeting?.attachments || []);
  const setAct = (i, k, v) => setActions((a) => a.map((x, idx) => (idx === i ? { ...x, [k]: v } : x)));
  const body = () => ({ ...f.values, actions: actions.filter((a) => a.text.trim()), attachments: files });
  const save = () => run(
    () => (meeting ? api.patch(`/meetings/${meeting.id}`, body()) : api.post('/meetings', body())),
    meeting ? '회의록을 수정했습니다.' : '회의록을 올렸습니다.',
  ).then(onClose);
  return (
    <Modal title={meeting ? '회의록 수정' : '회의록 쓰기'} onClose={onClose} wide>
      <div class="form-grid">
        <Field label="제목" wide><input placeholder="예: 2차 운영회의 (디스코드)" {...f.bind('title')} /></Field>
        <Field label="회의 날짜"><input type="date" {...f.bind('date')} /></Field>
        <Field label="작성자"><input {...f.bind('author')} /></Field>
        <Field label="결정된 것" hint="한 줄에 하나씩. 홈과 목록에서 바로 보입니다." wide><textarea rows={3} {...f.bind('decisions')} /></Field>
        <fieldset class="field field-wide">
          <legend class="field-label">할 일</legend>
          {actions.map((a, i) => (
            <div key={i} class="action-row">
              <input aria-label="할 일" placeholder="할 일" value={a.text} onInput={(e) => setAct(i, 'text', e.currentTarget.value)} />
              <input aria-label="담당" placeholder="담당" value={a.owner} onInput={(e) => setAct(i, 'owner', e.currentTarget.value)} />
              <input aria-label="기한" type="date" value={a.due} onInput={(e) => setAct(i, 'due', e.currentTarget.value)} />
              <button class="icon-btn" aria-label="할 일 삭제" onClick={() => setActions(actions.filter((_, idx) => idx !== i))}>✕</button>
            </div>
          ))}
          <Button small variant="quiet" onClick={() => setActions([...actions, { text: '', owner: '', due: '', done: false }])}>할 일 추가</Button>
        </fieldset>
        <Field label="내용" wide><textarea rows={8} {...f.bind('content')} /></Field>
        <div class="field field-wide"><span class="field-label">첨부</span><AttachPicker files={files} setFiles={setFiles} /></div>
        {me.can.editOwnTeam && <label class="check field-wide"><input type="checkbox" {...f.bind('pinned', 'checked')} /> 목록 맨 위에 고정</label>}
      </div>
      <div class="row-actions">
        <Button variant="quiet" onClick={onClose}>취소</Button>
        <Button variant="primary" onClick={save}>{meeting ? '저장' : '올리기'}</Button>
      </div>
    </Modal>
  );
}

function MeetingItem({ m, open, onToggle, onEdit }) {
  const { run } = useApp();
  const doneCount = m.actions.filter((a) => a.done).length;
  return (
    <li class={cx('entry', open && 'open', m.pinned && 'pinned')} id={m.id}>
      <button class="entry-head" onClick={onToggle} aria-expanded={open}>
        <span class="entry-title">{m.pinned && <span class="tag tag-solid">고정</span>}{m.title}</span>
        <span class="entry-meta">
          {m.date ? formatDate(m.date) : relativeTime(m.createdAt)}
          {m.actions.length > 0 && <span class="pill">할 일 {doneCount}/{m.actions.length}</span>}
        </span>
      </button>
      {m.decisions.length > 0 && (
        <ul class="decisions">{m.decisions.map((d, i) => <li key={i}>{d}</li>)}</ul>
      )}
      {open && (
        <div class="entry-body">
          {m.actions.length > 0 && (
            <ul class="actions">
              {m.actions.map((a) => (
                <li key={a.id} class={a.done ? 'done' : ''}>
                  <label>
                    <input type="checkbox" checked={a.done} onChange={(e) => run(() => api.put(`/meetings/${m.id}/actions/${a.id}`, { done: e.currentTarget.checked }))} />
                    <span>{a.text}</span>
                  </label>
                  <span class="muted">{[a.owner, a.due && formatDate(a.due, { withWeekday: false })].filter(Boolean).join(', ')}</span>
                </li>
              ))}
            </ul>
          )}
          <RichText text={m.content} />
          <Attachments files={m.attachments} />
          <footer class="entry-foot">
            <span class="muted">{m.author}</span>
            {m.canEdit && (
              <span class="row-actions">
                <Button small variant="quiet" onClick={onEdit}>수정</Button>
                <ConfirmButton onConfirm={() => run(() => api.del(`/meetings/${m.id}`), '삭제했습니다.')}>삭제</ConfirmButton>
              </span>
            )}
          </footer>
        </div>
      )}
    </li>
  );
}

/* ---------- 문의 ---------- */
function QuestionForm({ me, onClose }) {
  const { run } = useApp();
  const f = useForm({ title: '', question: '', author: me.label });
  const [files, setFiles] = useState([]);
  const save = () => run(() => api.post('/questions', { ...f.values, attachments: files }), '문의를 올렸습니다.').then(onClose);
  return (
    <Modal title="총괄대표에게 문의" onClose={onClose}>
      <div class="form-grid">
        <Field label="제목" wide><input {...f.bind('title')} /></Field>
        <Field label="내용" wide><textarea rows={6} {...f.bind('question')} /></Field>
        <Field label="작성자"><input {...f.bind('author')} /></Field>
        <div class="field field-wide"><span class="field-label">첨부</span><AttachPicker files={files} setFiles={setFiles} /></div>
      </div>
      <div class="row-actions">
        <Button variant="quiet" onClick={onClose}>취소</Button>
        <Button variant="primary" onClick={save}>올리기</Button>
      </div>
    </Modal>
  );
}

function QuestionItem({ q, open, onToggle, teams, canAnswer }) {
  const { run } = useApp();
  const [answer, setAnswer] = useState(q.answer);
  const team = teams.find((t) => t.id === q.teamId);
  return (
    <li class={cx('entry', open && 'open')} id={q.id}>
      <button class="entry-head" onClick={onToggle} aria-expanded={open}>
        <span class="entry-title">{q.title}</span>
        <span class="entry-meta">
          {team && <TeamChip team={team} small />}
          <span class={q.answer ? 'tag tag-solid' : 'tag'}>{q.answer ? '답변 완료' : '답변 대기'}</span>
        </span>
      </button>
      {open && (
        <div class="entry-body">
          <RichText text={q.question} />
          <Attachments files={q.attachments} />
          <p class="muted">{q.author}, {relativeTime(q.createdAt)}</p>
          {q.answer && !canAnswer && (
            <div class="answer"><strong>답변</strong><RichText text={q.answer} /><p class="muted">{q.answeredBy}, {relativeTime(q.answeredAt)}</p></div>
          )}
          {canAnswer && (
            <div class="answer">
              <Field label="답변"><textarea rows={4} value={answer} onInput={(e) => setAnswer(e.currentTarget.value)} /></Field>
              <div class="row-actions"><Button small variant="primary" onClick={() => run(() => api.put(`/questions/${q.id}/answer`, { answer }), '답변을 저장했습니다.')}>답변 저장</Button></div>
            </div>
          )}
          {q.canEdit && <footer class="entry-foot"><span /><ConfirmButton onConfirm={() => run(() => api.del(`/questions/${q.id}`), '삭제했습니다.')}>삭제</ConfirmButton></footer>}
        </div>
      )}
    </li>
  );
}

/* ---------- 자유게시판 ---------- */
function PostForm({ me, post, onClose }) {
  const { run } = useApp();
  const editing = Boolean(post);
  const f = useForm({ title: post?.title || '', content: post?.content || '', author: me.label, password: post?.password || '' });
  const save = () => run(
    () => (editing ? api.patch(`/posts/${post.id}`, { title: f.values.title, content: f.values.content, password: post.password || '' }) : api.post('/posts', f.values)),
    editing ? '글을 수정했습니다.' : '글을 올렸습니다.',
  ).then(onClose);
  return (
    <Modal title={editing ? '글 수정' : '글쓰기'} onClose={onClose}>
      <div class="form-grid">
        <Field label="제목" wide><input {...f.bind('title')} /></Field>
        <Field label="내용" wide><textarea rows={8} {...f.bind('content')} /></Field>
        {!editing && (
          <>
            <Field label="작성자"><input {...f.bind('author')} /></Field>
            <Field label="글 비밀번호 (선택)" hint="다른 기기에서 고치거나 지울 때 필요합니다."><input type="password" autocomplete="new-password" {...f.bind('password')} /></Field>
          </>
        )}
      </div>
      <div class="row-actions">
        <Button variant="quiet" onClick={onClose}>취소</Button>
        <Button variant="primary" onClick={save}>{editing ? '저장' : '올리기'}</Button>
      </div>
    </Modal>
  );
}

function PostItem({ p, open, onToggle, onEdit }) {
  const { run } = useApp();
  const [pw, setPw] = useState('');
  return (
    <li class={cx('entry', open && 'open')} id={p.id}>
      <button class="entry-head" onClick={onToggle} aria-expanded={open}>
        <span class="entry-title">{p.title}</span>
        <span class="entry-meta">{p.author}, {relativeTime(p.createdAt)}{p.updatedAt && <span class="pill">수정됨</span>}</span>
      </button>
      {open && (
        <div class="entry-body">
          <RichText text={p.content} />
          <footer class="entry-foot">
            <span />
            {p.canEdit ? (
              <span class="row-actions">
                <Button small variant="quiet" onClick={() => onEdit({ ...p })}>수정</Button>
                <ConfirmButton onConfirm={() => run(() => api.del(`/posts/${p.id}`), '삭제했습니다.')}>삭제</ConfirmButton>
              </span>
            ) : (
              <span class="pw-delete">
                {p.hasPassword && (
                  <>
                    <input type="password" placeholder="글 비밀번호" aria-label="글 비밀번호" value={pw} onInput={(e) => setPw(e.currentTarget.value)} />
                    <Button small variant="quiet" disabled={!pw} onClick={() => onEdit({ ...p, password: pw })}>수정</Button>
                  </>
                )}
                {p.canDelete ? (
                  <ConfirmButton onConfirm={() => run(() => api.del(`/posts/${p.id}`), '삭제했습니다.')}>삭제</ConfirmButton>
                ) : p.hasPassword ? (
                  <Button small variant="quiet" disabled={!pw} onClick={() => run(() => api.del(`/posts/${p.id}`, { password: pw }), '삭제했습니다.')}>삭제</Button>
                ) : null}
              </span>
            )}
          </footer>
        </div>
      )}
    </li>
  );
}

const TABS = { meetings: '회의록', questions: '문의', posts: '자유게시판' };

export function Board({ tab = 'meetings', openId }) {
  const { state } = useApp();
  const { meetings, questions, posts, me, teams } = state;
  const current = TABS[tab] ? tab : 'meetings';
  const [open, setOpen] = useState(openId || null);
  const [compose, setCompose] = useState(null);
  useEffect(() => setOpen(openId || null), [openId, current]);
  useEffect(() => {
    if (openId) requestAnimationFrame(() => document.getElementById(openId)?.scrollIntoView({ block: 'start' }));
  }, [openId]);

  const toggle = (id) => setOpen((o) => (o === id ? null : id));
  const pendingQ = questions.filter((q) => !q.answer).length;
  const composeLabel = { meetings: '회의록 쓰기', questions: '문의하기', posts: '글쓰기' }[current];

  return (
    <div>
      <PageHead title="소통" actions={<Button variant="primary" onClick={() => setCompose(current === 'meetings' ? { kind: 'meeting' } : { kind: current })}>{composeLabel}</Button>} />
      <Segmented
        value={current}
        onChange={(v) => navigate(`/board/${v}`, { replace: true })}
        options={[
          { value: 'meetings', label: '회의록', count: 0 },
          { value: 'questions', label: '문의', count: me.role === 'admin' ? pendingQ : 0 },
          { value: 'posts', label: '자유게시판' },
        ]}
      />
      {current === 'meetings' && (meetings.length ? (
        <ul class="entries">{meetings.map((m) => <MeetingItem key={m.id} m={m} open={open === m.id} onToggle={() => toggle(m.id)} onEdit={() => setCompose({ kind: 'meeting', meeting: m })} />)}</ul>
      ) : <Empty>회의가 끝나면 결정된 것과 할 일을 남겨주세요.</Empty>)}
      {current === 'questions' && (questions.length ? (
        <ul class="entries">{questions.map((q) => <QuestionItem key={q.id} q={q} open={open === q.id} onToggle={() => toggle(q.id)} teams={teams} canAnswer={me.can.answerQuestions} />)}</ul>
      ) : <Empty>총괄대표에게 물어볼 것이 있으면 여기에 남겨주세요.</Empty>)}
      {current === 'posts' && (posts.length ? (
        <ul class="entries">{posts.map((p) => <PostItem key={p.id} p={p} open={open === p.id} onToggle={() => toggle(p.id)} onEdit={(post) => setCompose({ kind: 'posts', post })} />)}</ul>
      ) : <Empty>아직 글이 없습니다.</Empty>)}

      {compose?.kind === 'meeting' && <MeetingForm meeting={compose.meeting} me={me} onClose={() => setCompose(null)} />}
      {compose?.kind === 'questions' && <QuestionForm me={me} onClose={() => setCompose(null)} />}
      {compose?.kind === 'posts' && <PostForm me={me} post={compose.post} onClose={() => setCompose(null)} />}
    </div>
  );
}
