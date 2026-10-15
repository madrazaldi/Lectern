export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'error';
  action?: { label: string; run: () => void };
}

interface Timer {
  handle: ReturnType<typeof setTimeout> | null;
  remaining: number;
  startedAt: number;
}

const INFO_MS = 4000;
const ERROR_MS = 7000;
/** Long enough to read the message and reach the button (Undo, Retry). */
const ACTION_MS = 9000;

let next = 1;
export const toasts = $state<Toast[]>([]);
const timers = new Map<number, Timer>();

export function toast(message: string, opts: { tone?: Toast['tone']; action?: Toast['action']; ms?: number } = {}) {
  const t: Toast = { id: next++, message, tone: opts.tone ?? 'info', action: opts.action };
  toasts.push(t);
  const ms = opts.ms ?? Math.max(t.action ? ACTION_MS : 0, t.tone === 'error' ? ERROR_MS : INFO_MS);
  timers.set(t.id, { handle: null, remaining: ms, startedAt: 0 });
  resume(t.id);
  return t.id;
}

/** Hold a toast on screen while it's hovered or focused. */
export function pause(id: number) {
  const t = timers.get(id);
  if (!t?.handle) return;
  clearTimeout(t.handle);
  t.handle = null;
  t.remaining = Math.max(0, t.remaining - (Date.now() - t.startedAt));
}

export function resume(id: number) {
  const t = timers.get(id);
  if (!t || t.handle) return;
  t.startedAt = Date.now();
  // A toast someone was reading gets a moment after they move away, even if its time had run out.
  t.handle = setTimeout(() => dismiss(id), Math.max(t.remaining, 1500));
}

export function dismiss(id: number) {
  const t = timers.get(id);
  if (t?.handle) clearTimeout(t.handle);
  timers.delete(id);
  const i = toasts.findIndex((x) => x.id === id);
  if (i >= 0) toasts.splice(i, 1);
}

export function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}
