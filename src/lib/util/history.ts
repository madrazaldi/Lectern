/** Listening history: sessions grouped into the days they were listened on, and how each is described. */
import type { SessionDevice } from '$lib/api/types';
import { duration } from './format';

export interface SessionLike {
  id: string;
  startedAt: number;
  updatedAt: number;
  timeListening: number;
}

export interface DayGroup<T> {
  /** Local calendar day, `YYYY-MM-DD`. */
  key: string;
  /** Local midnight of that day. */
  date: Date;
  sessions: T[];
  /** Seconds listened that day, across its sessions. */
  total: number;
}

export function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Sessions by the local day they started, newest day first, each day's sessions newest first. The server pages
 * by last update, so a day can be spread over two pages (or a long session started the day before shows up
 * among the next day's): groups are merged, not cut at each change of day.
 */
export function groupByDay<T extends SessionLike>(sessions: readonly T[]): DayGroup<T>[] {
  const groups = new Map<string, DayGroup<T>>();
  for (const s of sessions) {
    const at = new Date(s.startedAt || s.updatedAt);
    const key = dayKey(at);
    let g = groups.get(key);
    if (!g) {
      g = { key, date: new Date(at.getFullYear(), at.getMonth(), at.getDate()), sessions: [], total: 0 };
      groups.set(key, g);
    }
    g.sessions.push(s);
    g.total += Number(s.timeListening) || 0;
  }
  const out = [...groups.values()].sort((a, b) => b.date.valueOf() - a.date.valueOf());
  for (const g of out) g.sessions.sort((a, b) => (b.startedAt || b.updatedAt) - (a.startedAt || a.updatedAt));
  return out;
}

/** "Today", "Yesterday", a weekday within the last week, otherwise the date (with the year once it isn't this one). */
export function dayLabel(day: Date, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((today.valueOf() - day.valueOf()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days > 1 && days < 7) return day.toLocaleDateString(undefined, { weekday: 'long' });
  return day.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: day.getFullYear() === now.getFullYear() ? undefined : 'numeric'
  });
}

/** Time listened, down to the second for short sessions ("45s"), which `duration` would round up to a minute. */
export function listened(seconds: number) {
  const s = Math.round(Number(seconds) || 0);
  if (s < 60) return `${s}s`;
  return duration(s, { short: true });
}

/** "Lectern 0.1.0 on Lectern Desktop", "Abs Web on Chrome, macOS": the app, then the device as far as it's known. */
export function deviceLabel(info: SessionDevice | null | undefined, mediaPlayer?: string | null) {
  if (!info) return mediaPlayer ?? '';
  const client = [info.clientName, info.clientVersion].filter(Boolean).join(' ');
  const model = [info.manufacturer, info.model].filter(Boolean).join(' ');
  const device = info.deviceName || (model && model !== client ? model : '') || [info.browserName, info.osName].filter(Boolean).join(', ');
  if (client && device && device !== client) return `${client} on ${device}`;
  return client || device || mediaPlayer || '';
}
