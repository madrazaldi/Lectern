import { describe, expect, it } from 'bun:test';
import { buildAppMenu, buildTrayMenu, initialMenuState, isAction, needsWindow, sleepTitle, type MenuState } from './menu';

type Item = { label?: string; action?: string; role?: string; accelerator?: string; enabled?: boolean; hidden?: boolean; submenu?: Item[]; type?: string };

const playing: MenuState = {
  mini: false,
  nowPlaying: { title: 'Dune', subtitle: 'Frank Herbert', playing: true, canControl: true, sleepLabel: '15 min' }
};

function flat(items: Item[]): Item[] {
  return items.flatMap((i) => [i, ...(i.submenu ? flat(i.submenu) : [])]);
}
const find = (items: Item[], label: string) => flat(items).find((i) => i.label === label);

describe('menu bar', () => {
  const idle = buildAppMenu(initialMenuState()) as Item[];

  it('has the same menus as before', () => {
    expect(idle.map((m) => m.label)).toEqual(['Lectern', 'Edit', 'View', 'Go', 'Playback', 'Window']);
  });

  it('keeps every shortcut', () => {
    const keys = Object.fromEntries(flat(idle).flatMap((i) => (i.accelerator ? [[i.label ?? i.role, i.accelerator]] : [])));
    expect(keys).toMatchObject({
      'Settings…': 'CommandOrControl+,',
      'Quit Lectern': 'CommandOrControl+Q',
      'Now Playing': 'CommandOrControl+Shift+F',
      'Mini Player': 'CommandOrControl+Shift+M',
      Search: 'CommandOrControl+F',
      Home: 'CommandOrControl+1',
      Library: 'CommandOrControl+2',
      Series: 'CommandOrControl+3',
      Authors: 'CommandOrControl+4',
      Collections: 'CommandOrControl+5',
      Downloads: 'CommandOrControl+6',
      Listening: 'CommandOrControl+7',
      Back: 'CommandOrControl+[',
      Forward: 'CommandOrControl+]'
    });
  });

  it('keeps the transport disabled until something is loaded', () => {
    for (const label of ['Play', 'Skip Back', 'Skip Forward', 'Previous Chapter', 'Next Chapter', 'Faster', 'Slower', 'Add Bookmark']) {
      expect(find(idle, label)?.enabled).toBe(false);
    }
    expect(find(idle, 'Sleep Timer')?.enabled).toBe(false);
    const live = buildAppMenu(playing) as Item[];
    expect(find(live, 'Pause')?.enabled).toBe(true);
    expect(find(live, 'Play')).toBeUndefined();
    expect(find(live, 'Sleep Timer (15 min)')?.enabled).toBe(true);
  });

  it('relabels the mini player item', () => {
    expect(find(buildAppMenu({ ...playing, mini: true }) as Item[], 'Exit Mini Player')?.action).toBe('mini-player');
    expect(find(idle, 'Mini Player')?.action).toBe('mini-player');
  });

  it('offers the sleep timer choices', () => {
    const sleep = find(idle, 'Sleep Timer');
    expect(sleep?.submenu?.map((s) => [s.label, s.action])).toEqual([
      ['Off', 'sleep-off'],
      ['15 minutes', 'sleep-15'],
      ['30 minutes', 'sleep-30'],
      ['45 minutes', 'sleep-45'],
      ['1 hour', 'sleep-60'],
      ['End of Chapter', 'sleep-chapter']
    ]);
  });

  it('only sends actions the page understands', () => {
    for (const item of flat(idle)) if (item.action) expect(isAction(item.action)).toBe(true);
  });
});

describe('tray menu', () => {
  it('shows what is playing and the controls', () => {
    const items = buildTrayMenu(playing) as Item[];
    expect(items[0]).toMatchObject({ label: 'Dune', enabled: false });
    expect(items[1]).toMatchObject({ label: 'Frank Herbert', hidden: false });
    expect(find(items, 'Pause')).toMatchObject({ action: 'play-pause', enabled: true });
    expect(find(items, 'Quit Lectern')?.action).toBe('quit');
    expect(find(items, 'Show Lectern')?.action).toBe('show');
    expect(find(items, 'Sleep Timer (15 min)')?.submenu).toHaveLength(6);
  });

  it('says so when nothing is playing, and disables the controls', () => {
    const items = buildTrayMenu(initialMenuState()) as Item[];
    expect(items[0]?.label).toBe('Nothing playing');
    expect(items[1]?.hidden).toBe(true);
    expect(find(items, 'Play')?.enabled).toBe(false);
    expect(find(items, 'Skip Back')?.enabled).toBe(false);
    // The window and quit entries always work.
    expect(find(items, 'Mini Player')?.enabled).toBe(true);
    expect(find(items, 'Quit Lectern')?.enabled).toBe(true);
  });
});

describe('actions', () => {
  it('knows which ones come to the page', () => {
    for (const id of ['nav:/library', 'sleep-30', 'play-pause', 'search', 'back', 'forward', 'mini-player', 'now-playing']) expect(isAction(id)).toBe(true);
    for (const id of ['quit', 'show', '', 'sleep', 'rm -rf']) expect(isAction(id)).toBe(false);
  });

  it('brings the window forward for the ones that show something', () => {
    expect(needsWindow('nav:/settings')).toBe(true);
    expect(needsWindow('search')).toBe(true);
    expect(needsWindow('now-playing')).toBe(true);
    expect(needsWindow('mini-player')).toBe(true);
    expect(needsWindow('play-pause')).toBe(false);
    expect(needsWindow('sleep-15')).toBe(false);
  });

  it('labels the sleep timer', () => {
    expect(sleepTitle({ ...playing.nowPlaying, sleepLabel: null })).toBe('Sleep Timer');
    expect(sleepTitle(playing.nowPlaying)).toBe('Sleep Timer (15 min)');
  });
});
