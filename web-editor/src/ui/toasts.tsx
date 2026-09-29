/** 알림 (가져오기 거부, 저장 공간 부족 등). 오류는 닫을 때까지 남고, 안내는 6초 뒤 사라진다. */
import { create } from 'zustand';
import { ko } from '../i18n/ko';

export interface Toast {
  id: number;
  kind: 'error' | 'info';
  text: string;
}

interface ToastState {
  toasts: Toast[];
  dismiss: (id: number) => void;
}

let seq = 0;

export const useToasts = create<ToastState>()((set) => ({
  toasts: [],
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export function toast(kind: Toast['kind'], text: string): void {
  const id = ++seq;
  useToasts.setState((s) => ({ toasts: [...s.toasts.slice(-5), { id, kind, text }] }));
  if (kind === 'info') setTimeout(() => useToasts.getState().dismiss(id), 6000);
}

export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed top-14 left-1/2 z-50 flex w-[28rem] max-w-[90vw] -translate-x-1/2 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === 'error' ? 'alert' : 'status'}
          data-testid="toast"
          data-kind={t.kind}
          className={
            'pointer-events-auto flex items-start gap-3 rounded-lg px-3 py-2 text-sm shadow-lg ' +
            (t.kind === 'error' ? 'bg-red-950 text-red-100 ring-1 ring-red-800' : 'bg-neutral-800 text-neutral-100 ring-1 ring-neutral-700')
          }
        >
          <span className="flex-1 break-all">{t.text}</span>
          <button type="button" onClick={() => dismiss(t.id)} className="text-neutral-400 hover:text-white" aria-label={ko.common.close}>
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
