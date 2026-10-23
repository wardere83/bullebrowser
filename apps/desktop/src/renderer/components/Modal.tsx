import { useEffect, useRef } from 'react';

export function Modal({
  title,
  onClose,
  children,
  width = 480,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () =>
      [
        ...(dialog.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex="0"]',
        ) ?? []),
      ].filter((element) => element.getClientRects().length > 0);
    focusable()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
      if (e.key === 'Tab') {
        const controls = focusable();
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    const keepFocusInside = (event: FocusEvent) => {
      if (dialog.current && !dialog.current.contains(event.target as Node)) focusable()[0]?.focus();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('focusin', keepFocusInside);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', keepFocusInside);
      if (previous?.isConnected) previous.focus();
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ width, maxWidth: '100%' }}
        className="max-h-[80vh] overflow-hidden rounded-lg bg-surface-light text-ink-primary shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded hover:bg-surface-muted"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M6 6l12 12M6 18L18 6" />
            </svg>
          </button>
        </header>
        <div className="max-h-[68vh] overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}
