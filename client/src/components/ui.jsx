import { useEffect, useRef, useState } from 'preact/hooks';
import { cx, teamStyle, COLLECTION_STATUS } from '../util.js';
import { fileUrl } from '../api.js';

/** 클릭 시 async 작업 동안 비활성 + 진행 표시 */
export function Button({ onClick, children, variant = 'default', small, type = 'button', disabled, class: cls, ...rest }) {
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  async function handle(e) {
    if (!onClick) return;
    const r = onClick(e);
    if (r && typeof r.then === 'function') {
      setBusy(true);
      try { await r; } catch { /* 토스트로 처리됨 */ } finally { if (mounted.current) setBusy(false); }
    }
  }
  return (
    <button
      type={type}
      class={cx('btn', `btn-${variant}`, small && 'btn-sm', busy && 'is-busy', cls)}
      disabled={disabled || busy}
      aria-busy={busy}
      onClick={handle}
      {...rest}
    >
      {children}
    </button>
  );
}

/** 브라우저 confirm 대신 두 번 누르기 확인 */
export function ConfirmButton({ onConfirm, children, confirmLabel = '한 번 더 누르면 삭제', small = true }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <Button small={small} variant={armed ? 'danger' : 'quiet'} onClick={() => (armed ? onConfirm() : setArmed(true))}>
      {armed ? confirmLabel : children}
    </Button>
  );
}

export function Modal({ title, onClose, children, wide }) {
  const ref = useRef();
  useEffect(() => {
    const prev = document.activeElement;
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    ref.current?.querySelector('input, textarea, select, button.btn-primary')?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
      prev?.focus?.();
    };
  }, []);
  return (
    <div class="modal-backdrop" onClick={onClose}>
      <div class={cx('modal', wide && 'modal-wide')} role="dialog" aria-modal="true" aria-label={title} ref={ref} onClick={(e) => e.stopPropagation()}>
        <header class="modal-head">
          <h2>{title}</h2>
          <button class="icon-btn" onClick={onClose} aria-label="닫기">✕</button>
        </header>
        <div class="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, hint, children, wide }) {
  return (
    <label class={cx('field', wide && 'field-wide')}>
      <span class="field-label">{label}</span>
      {children}
      {hint && <span class="field-hint">{hint}</span>}
    </label>
  );
}

/** 폼 상태 헬퍼 */
export function useForm(initial) {
  const [values, setValues] = useState(initial);
  const bind = (name, kind = 'value') => ({
    name,
    [kind === 'checked' ? 'checked' : 'value']: kind === 'checked' ? Boolean(values[name]) : values[name] ?? '',
    onInput: (e) => setValues((v) => ({ ...v, [name]: kind === 'checked' ? e.currentTarget.checked : e.currentTarget.value })),
    ...(kind === 'checked' ? { onChange: (e) => setValues((v) => ({ ...v, [name]: e.currentTarget.checked })) } : {}),
  });
  return { values, setValues, bind, set: (name, val) => setValues((v) => ({ ...v, [name]: val })) };
}

export function Empty({ children, action }) {
  return (
    <div class="empty">
      <p>{children}</p>
      {action}
    </div>
  );
}

export function TeamChip({ team, small }) {
  if (!team) return null;
  return (
    <span class={cx('team-chip', small && 'team-chip-sm')} style={teamStyle(team.themeColor)}>
      <i aria-hidden="true" />
      {team.name}
    </span>
  );
}

export function StatusGlyph({ status }) {
  const s = COLLECTION_STATUS[status] || COLLECTION_STATUS.todo;
  return (
    <span class={`status status-${status}`}>
      <i class="dot" aria-hidden="true" />
      {s.label}
    </span>
  );
}

export function DueBadge({ due, dday }) {
  if (!due) return null;
  const late = dday != null && dday < 0;
  const soon = dday != null && dday >= 0 && dday <= 3;
  return (
    <span class={cx('due', late && 'due-late', soon && 'due-soon')}>
      {late ? '마감 지남' : dday === 0 ? '오늘 마감' : `마감 ${due.slice(5).replace('-', '/')}`}
    </span>
  );
}

export function Lightbox({ images, index, onClose }) {
  const [i, setI] = useState(index);
  const touchX = useRef(0);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setI((x) => (x + 1) % images.length);
      if (e.key === 'ArrowLeft') setI((x) => (x - 1 + images.length) % images.length);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [images.length]);
  const img = images[i];
  return (
    <div class="lightbox" onClick={onClose} role="dialog" aria-label="이미지 크게 보기">
      <img
        src={fileUrl(img.fileId)}
        alt={img.alt || ''}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => {
          const dx = e.changedTouches[0].clientX - touchX.current;
          if (Math.abs(dx) > 50 && images.length > 1) setI((x) => (x + (dx < 0 ? 1 : -1) + images.length) % images.length);
        }}
      />
      <div class="lightbox-top" onClick={(e) => e.stopPropagation()}>
        <a href={fileUrl(img.fileId)} target="_blank" rel="noopener">원본 열기</a>
        <button class="icon-btn" onClick={onClose} aria-label="닫기">✕</button>
      </div>
      {images.length > 1 && (
        <div class="lightbox-nav" onClick={(e) => e.stopPropagation()}>
          <button class="icon-btn" onClick={() => setI((i - 1 + images.length) % images.length)} aria-label="이전">‹</button>
          <span>{i + 1} / {images.length}</span>
          <button class="icon-btn" onClick={() => setI((i + 1) % images.length)} aria-label="다음">›</button>
        </div>
      )}
    </div>
  );
}

const isImage = (f) => (f.type || '').startsWith('image/');

/** 목록(접힌 상태)에서 보이는 이미지 썸네일 줄. 누르면 바로 크게 보기 */
export function AttachmentThumbs({ files, max = 4 }) {
  const [open, setOpen] = useState(null);
  const images = (files || []).filter(isImage);
  if (!images.length) return null;
  const shown = images.slice(0, max);
  const rest = images.length - shown.length;
  return (
    <div class="att-thumbs">
      {shown.map((f, i) => (
        <button key={f.fileId} class="att-thumb" onClick={() => setOpen(i)} aria-label={`${f.name} 크게 보기`}>
          <img src={fileUrl(f.fileId)} alt="" loading="lazy" />
          {i === shown.length - 1 && rest > 0 && <span class="att-more">+{rest}</span>}
        </button>
      ))}
      {open != null && <Lightbox images={images.map((f) => ({ ...f, alt: f.name }))} index={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** 펼친 본문: 이미지는 화면 폭에 맞춰 바로 표시(누르면 크게), 그 밖의 파일은 내려받기 칩 */
export function Attachments({ files }) {
  const [open, setOpen] = useState(null);
  if (!files?.length) return null;
  const images = files.filter(isImage);
  const others = files.filter((f) => !isImage(f));
  return (
    <div class="att">
      {images.length > 0 && (
        <div class={cx('att-images', images.length === 1 && 'single')}>
          {images.map((f, i) => (
            <button key={f.fileId} class="att-image" onClick={() => setOpen(i)} aria-label={`${f.name} 크게 보기`}>
              <img src={fileUrl(f.fileId)} alt={f.name} loading="lazy" />
            </button>
          ))}
        </div>
      )}
      {others.length > 0 && (
        <ul class="attachments">
          {others.map((f) => (
            <li key={f.fileId}>
              <a href={fileUrl(f.fileId)} target="_blank" rel="noopener">
                <span class="file-ico" aria-hidden="true">📎</span>
                <span>{f.name}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {open != null && <Lightbox images={images.map((f) => ({ ...f, alt: f.name }))} index={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** 줄바꿈 보존 + URL 자동 링크 */
export function RichText({ text, class: cls }) {
  if (!text) return null;
  const parts = String(text).split(/(https?:\/\/[^\s]+)/g);
  return (
    <div class={cx('rich', cls)}>
      {parts.map((p, i) => (/^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noopener">{p}</a> : p))}
    </div>
  );
}

export function PageHead({ title, sub, actions }) {
  return (
    <header class="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p class="page-sub">{sub}</p>}
      </div>
      {actions && <div class="page-actions">{actions}</div>}
    </header>
  );
}

export function Segmented({ value, onChange, options }) {
  return (
    <div class="segmented" role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} class={cx(value === o.value && 'on')} onClick={() => onChange(o.value)}>
          {o.label}
          {o.count ? <em>{o.count}</em> : null}
        </button>
      ))}
    </div>
  );
}
