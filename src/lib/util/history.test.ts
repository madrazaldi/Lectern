import { describe, expect, it } from 'vitest';
import { dayLabel, deviceLabel, groupByDay, listened } from './history';

const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).valueOf();
const s = (id: string, startedAt: number, timeListening = 60, updatedAt = startedAt + timeListening * 1000) => ({ id, startedAt, updatedAt, timeListening });

describe('groupByDay', () => {
  it('groups by the local day a session started, newest day first, with each day’s total', () => {
    const groups = groupByDay([s('c', at(2026, 10, 15, 21)), s('b', at(2026, 10, 15, 8), 30), s('a', at(2026, 10, 14, 23, 50), 120)]);
    expect(groups.map((g) => [g.key, g.sessions.map((x) => x.id), g.total])).toEqual([
      ['2026-10-15', ['c', 'b'], 90],
      ['2026-10-14', ['a'], 120]
    ]);
    expect(groups[0].date).toEqual(new Date(2026, 9, 15));
  });

  it('keeps a session that ran past midnight on the day it started', () => {
    const late = s('late', at(2026, 10, 14, 23, 40), 3600);
    expect(new Date(late.updatedAt).getDate()).toBe(15);
    expect(groupByDay([late])[0].key).toBe('2026-10-14');
  });

  it('merges a day split across pages (sessions arrive by last update, not start)', () => {
    // A long session started on the 14th but updated after one from the 15th.
    const page1 = [s('long', at(2026, 10, 14, 22), 60, at(2026, 10, 15, 10)), s('x', at(2026, 10, 15, 9))];
    const page2 = [s('y', at(2026, 10, 14, 20))];
    const groups = groupByDay([...page1, ...page2]);
    expect(groups.map((g) => [g.key, g.sessions.map((x) => x.id)])).toEqual([
      ['2026-10-15', ['x']],
      ['2026-10-14', ['long', 'y']]
    ]);
  });

  it('falls back to the last update without a start, and tolerates string times', () => {
    const odd = { id: 'o', startedAt: 0, updatedAt: at(2026, 1, 2), timeListening: '42' as unknown as number };
    expect(groupByDay([odd])).toMatchObject([{ key: '2026-01-02', total: 42 }]);
    expect(groupByDay([])).toEqual([]);
  });
});

describe('dayLabel', () => {
  const now = new Date(2026, 9, 16, 15);
  it('names recent days', () => {
    expect(dayLabel(new Date(2026, 9, 16), now)).toBe('Today');
    expect(dayLabel(new Date(2026, 9, 15), now)).toBe('Yesterday');
    expect(dayLabel(new Date(2026, 9, 12), now)).toBe(new Date(2026, 9, 12).toLocaleDateString(undefined, { weekday: 'long' }));
  });
  it('dates older days, with the year only when it differs', () => {
    expect(dayLabel(new Date(2026, 8, 6), now)).not.toMatch(/2026/);
    expect(dayLabel(new Date(2025, 8, 6), now)).toMatch(/2025/);
  });
});

describe('listened', () => {
  it('shows seconds for short sessions and rounds longer ones', () => {
    expect(listened(0)).toBe('0s');
    expect(listened(44.6)).toBe('45s');
    expect(listened(95)).toBe('2m');
    expect(listened(3720)).toBe('1h 2m');
  });
});

describe('deviceLabel', () => {
  it('describes the app and the device', () => {
    expect(deviceLabel({ clientName: 'Lectern', clientVersion: '0.1.0', manufacturer: 'Lectern', model: 'Desktop', deviceName: 'Lectern Desktop' })).toBe(
      'Lectern 0.1.0 on Lectern Desktop'
    );
    expect(deviceLabel({ clientName: 'Abs Web', clientVersion: '2.37.1', browserName: 'Chrome', osName: 'macOS' })).toBe('Abs Web 2.37.1 on Chrome, macOS');
    expect(deviceLabel({ manufacturer: 'Google', model: 'Pixel 9' })).toBe('Google Pixel 9');
    expect(deviceLabel(null, 'html5')).toBe('html5');
    expect(deviceLabel({}, null)).toBe('');
  });
});
