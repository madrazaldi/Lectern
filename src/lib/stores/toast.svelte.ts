export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'error';
  action?: { label: string; run: () => void };
}

let next = 1;
export const toasts = $state<Toast[]>([]);

export function toast(message: string, opts: { tone?: Toast['tone']; action?: Toast['action']; ms?: number } = {}) {
  const t: Toast = { id: next++, message, tone: opts.tone ?? 'info', action: opts.action };
  toasts.push(t);
  setTimeout(() => dismiss(t.id), opts.ms ?? (t.tone === 'error' ? 6000 : 3200));
}

export function dismiss(id: number) {
  const i = toasts.findIndex((t) => t.id === id);
  if (i >= 0) toasts.splice(i, 1);
}

export function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}
