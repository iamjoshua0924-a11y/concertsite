import { useEffect, useState } from 'preact/hooks';
import { api } from '../api.js';
import { Link, useApp } from '../app.jsx';
import { Button, PageHead, RichText } from '../components/ui.jsx';
import { relativeTime } from '../util.js';

export function Rules({ publicView }) {
  const app = useApp();
  const [pubRules, setPubRules] = useState(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (publicView) api.get('/public').then((p) => setPubRules(p.rules)).catch(() => setPubRules(''));
  }, [publicView]);

  const content = publicView ? pubRules : app.state.rules.content;
  const canEdit = !publicView && app.state.me.role === 'admin';

  return (
    <div class={publicView ? 'public-page' : ''}>
      <PageHead
        title="운영규약"
        sub={!publicView && app.state.rules.updatedAt ? `${relativeTime(app.state.rules.updatedAt)} 수정` : null}
        actions={
          publicView ? <Link href="/" class="btn btn-default">로그인으로</Link>
            : canEdit && !editing && <Button onClick={() => { setDraft(content); setEditing(true); }}>수정</Button>
        }
      />
      {editing ? (
        <div class="stack">
          <textarea class="rules-editor" value={draft} onInput={(e) => setDraft(e.currentTarget.value)} rows={24} />
          <div class="row-actions">
            <Button variant="quiet" onClick={() => setEditing(false)}>취소</Button>
            <Button variant="primary" onClick={() => app.run(() => api.put('/rules', { content: draft }), '운영규약을 저장했습니다.').then(() => setEditing(false))}>저장</Button>
          </div>
        </div>
      ) : content == null ? (
        <p class="muted">불러오는 중</p>
      ) : content ? (
        <article class="prose"><RichText text={content} /></article>
      ) : (
        <p class="muted">등록된 운영규약이 없습니다.</p>
      )}
    </div>
  );
}
