import { useEffect, useRef, useState } from 'react';
import type { ProjectSummary, SessionFile } from '../../shared/ipc.js';

// The composer's "+" attachment menu — Comet-style. Each item wires to a real
// capability:
//   • Upload your file → native picker; files land in the 8-day session store.
//   • Screenshot       → capture the active tab, attach as a thumbnail.
//   • Projects         → pick/create a project so the agent treats the task as
//                        part of it (standing instructions + project files).
//   • Control Browser  → hand the agent a live tab to drive.
// It owns only its popover/picker UI; the chosen attachment is handed up via
// onAttach and the panel decides what to do with it.

// A UI-side attachment reference. The screenshot carries a thumbnail data URL
// for preview; only the url is sent to the agent.
export type UiAttachment =
  | { kind: 'file'; fileId: string; name: string }
  | { kind: 'project'; projectId: string; name: string }
  | { kind: 'screenshot'; url: string; thumb: string };

const ITEM =
  'flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-surface-muted';

export function AttachMenu({
  onAttach,
  onControlBrowser,
  disabled,
}: {
  onAttach: (a: UiAttachment) => void;
  onControlBrowser: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open && !picker) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setPicker(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, picker]);

  const upload = async () => {
    setBusy('upload');
    try {
      const files: SessionFile[] = await window.bullebrowser.files.pick();
      for (const f of files) onAttach({ kind: 'file', fileId: f.id, name: f.name });
    } finally {
      setBusy(null);
      setOpen(false);
    }
  };

  const screenshot = async () => {
    setBusy('screenshot');
    try {
      const shot = await window.bullebrowser.agent.captureScreenshot();
      if (shot) {
        onAttach({
          kind: 'screenshot',
          url: shot.url,
          thumb: `data:image/png;base64,${shot.pngBase64}`,
        });
      }
    } finally {
      setBusy(null);
      setOpen(false);
    }
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-label="Add attachment"
        aria-expanded={open}
        title="Attach files, a screenshot, or a project"
        className={`inline-flex h-8 w-8 items-center justify-center rounded-full border transition-colors disabled:opacity-40 ${
          open ? 'border-primary bg-primary/10 text-primary' : 'border-line text-ink-secondary hover:text-ink-primary'
        }`}
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      {open && !picker && (
        <div className="absolute bottom-10 left-0 z-40 w-64 overflow-hidden rounded-xl border border-line bg-white p-1 text-ink-primary shadow-xl">
          <button type="button" className={ITEM} onClick={upload} disabled={busy === 'upload'}>
            <Icon>
              <path d="M12 16V4m0 0L7 9m5-5 5 5M5 20h14" />
            </Icon>
            <span className="min-w-0">
              <span className="block text-[12px] font-medium">Upload your file</span>
              <span className="block text-[11px] text-ink-secondary">
                {busy === 'upload' ? 'Opening…' : 'Session files are retained for 8 days'}
              </span>
            </span>
          </button>

          <button type="button" className={ITEM} onClick={screenshot} disabled={busy === 'screenshot'}>
            <Icon>
              <rect x="3" y="6" width="18" height="13" rx="2" />
              <circle cx="12" cy="12.5" r="3.2" />
              <path d="M8.5 6 10 3.5h4L15.5 6" />
            </Icon>
            <span className="min-w-0">
              <span className="block text-[12px] font-medium">Screenshot</span>
              <span className="block text-[11px] text-ink-secondary">
                {busy === 'screenshot' ? 'Capturing…' : 'Capture the current page'}
              </span>
            </span>
          </button>

          <button type="button" className={ITEM} onClick={() => setPicker(true)}>
            <Icon>
              <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h9A1.5 1.5 0 0 1 21 10v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18z" />
            </Icon>
            <span className="min-w-0">
              <span className="block text-[12px] font-medium">Projects</span>
              <span className="block text-[11px] text-ink-secondary">Attach a project folder</span>
            </span>
          </button>

          <button
            type="button"
            className={ITEM}
            onClick={() => {
              onControlBrowser();
              setOpen(false);
            }}
          >
            <Icon>
              <circle cx="12" cy="12" r="9" />
              <path d="M3.2 9h17.6M3.2 15h17.6M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
            </Icon>
            <span className="min-w-0">
              <span className="block text-[12px] font-medium">Control Browser</span>
              <span className="block text-[11px] text-ink-secondary">Let the agent drive your tabs</span>
            </span>
          </button>
        </div>
      )}

      {picker && (
        <ProjectPicker
          onPick={(p) => {
            onAttach({ kind: 'project', projectId: p.id, name: p.name });
            setPicker(false);
            setOpen(false);
          }}
          onClose={() => {
            setPicker(false);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function ProjectPicker({
  onPick,
  onClose,
}: {
  onPick: (p: ProjectSummary) => void;
  onClose: () => void;
}) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void window.bullebrowser
      .projects.list()
      .then((list: ProjectSummary[]) => setProjects(list))
      .finally(() => setLoading(false));
  }, []);

  const create = async () => {
    const n = name.trim();
    if (!n) return;
    const created = await window.bullebrowser.projects.create(n);
    setName('');
    onPick(created);
  };

  return (
    <div className="absolute bottom-10 left-0 z-40 w-72 overflow-hidden rounded-xl border border-line bg-white text-ink-primary shadow-xl">
      <div className="flex items-center justify-between border-b border-line/60 px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-secondary">
          Attach a project
        </span>
        <button type="button" onClick={onClose} className="text-xs text-ink-secondary hover:text-ink-primary">
          Close
        </button>
      </div>
      <div className="max-h-48 overflow-y-auto p-1">
        {loading ? (
          <div className="px-2 py-3 text-[12px] text-ink-secondary">Loading…</div>
        ) : projects.length === 0 ? (
          <div className="px-2 py-3 text-[12px] text-ink-secondary">
            No projects yet — create one below.
          </div>
        ) : (
          projects.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onPick(p)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-muted"
            >
              <span className="flex-1 truncate text-[12px] font-medium">{p.name}</span>
              <span className="text-[10px] text-ink-secondary">
                {p.fileCount} {p.fileCount === 1 ? 'file' : 'files'}
              </span>
            </button>
          ))
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-line/60 p-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void create();
          }}
          placeholder="New project name…"
          className="min-w-0 flex-1 rounded-md border border-line px-2 py-1 text-[12px] focus:border-primary focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void create()}
          disabled={!name.trim()}
          className="rounded-md bg-primary px-2.5 py-1 text-[12px] font-medium text-white hover:bg-primary-hover disabled:bg-line"
        >
          Create
        </button>
      </div>
    </div>
  );
}

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="mt-0.5 h-4 w-4 shrink-0 text-primary"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}
