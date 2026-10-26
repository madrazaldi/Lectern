// The menu bar (macOS), the tray menu and the actions they send to the page. Menus here are plain data: the state
// that changes them (playing or not, what is loaded, the sleep timer, mini player or not) goes in, items come out,
// and index.ts hands them to Electrobun, which rebuilds the native menu.
import type { ApplicationMenuItemConfig, MenuItemConfig } from 'electrobun/main';
import type { NowPlayingState } from '../shared/rpc';

export const SLEEP_TITLE = 'Sleep Timer';
export const MINI_ENTER = 'Mini Player';
export const MINI_EXIT = 'Exit Mini Player';

export interface MenuState {
  mini: boolean;
  nowPlaying: NowPlayingState;
}

export const initialMenuState = (): MenuState => ({
  mini: false,
  nowPlaying: { title: null, subtitle: null, playing: false, canControl: false, sleepLabel: null }
});

/** Ids that go to the page as `menu-action`. Everything else is handled here. */
export function isAction(id: string): boolean {
  return (
    id.startsWith('nav:') ||
    id.startsWith('sleep-') ||
    [
      'play-pause',
      'skip-back',
      'skip-forward',
      'prev-chapter',
      'next-chapter',
      'speed-up',
      'speed-down',
      'add-bookmark',
      'now-playing',
      'mini-player',
      'search',
      'back',
      'forward'
    ].includes(id)
  );
}

/** Actions that need the window in front, because they show something. */
export function needsWindow(id: string): boolean {
  return id.startsWith('nav:') || id === 'search' || id === 'now-playing' || id === 'mini-player';
}

const miniLabel = (s: MenuState) => (s.mini ? MINI_EXIT : MINI_ENTER);

function sleepSubmenu(): { id: string; label: string }[] {
  return [
    { id: 'sleep-off', label: 'Off' },
    { id: 'sleep-15', label: '15 minutes' },
    { id: 'sleep-30', label: '30 minutes' },
    { id: 'sleep-45', label: '45 minutes' },
    { id: 'sleep-60', label: '1 hour' },
    { id: 'sleep-chapter', label: 'End of Chapter' }
  ];
}

export const sleepTitle = (np: NowPlayingState) => (np.sleepLabel ? `${SLEEP_TITLE} (${np.sleepLabel})` : SLEEP_TITLE);

/** The full macOS menu bar. Transport items stay disabled until a title is loaded. */
export function buildAppMenu(s: MenuState): ApplicationMenuItemConfig[] {
  const can = s.nowPlaying.canControl;
  const item = (action: string, label: string, accelerator?: string, enabled = true): ApplicationMenuItemConfig => ({ label, action, accelerator, enabled });
  const transport = (action: string, label: string) => item(action, label, undefined, can);
  const sep: ApplicationMenuItemConfig = { type: 'separator' };
  return [
    {
      label: 'Lectern',
      submenu: [
        { role: 'about', label: 'About Lectern' },
        sep,
        item('nav:/settings', 'Settings…', 'CommandOrControl+,'),
        sep,
        { role: 'hide', label: 'Hide Lectern', accelerator: 'CommandOrControl+H' },
        { role: 'hideOthers', accelerator: 'Alt+Command+H' },
        { role: 'showAll' },
        sep,
        { role: 'quit', label: 'Quit Lectern', accelerator: 'CommandOrControl+Q' }
      ]
    },
    {
      label: 'Edit',
      submenu: [{ role: 'undo' }, { role: 'redo' }, sep, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }]
    },
    {
      label: 'View',
      submenu: [
        item('now-playing', 'Now Playing', 'CommandOrControl+Shift+F'),
        item('mini-player', miniLabel(s), 'CommandOrControl+Shift+M'),
        item('search', 'Search', 'CommandOrControl+F'),
        sep,
        { role: 'toggleFullScreen', label: 'Toggle Full Screen', accelerator: 'Control+Command+F' }
      ]
    },
    {
      label: 'Go',
      submenu: [
        item('nav:/', 'Home', 'CommandOrControl+1'),
        item('nav:/library', 'Library', 'CommandOrControl+2'),
        item('nav:/series', 'Series', 'CommandOrControl+3'),
        item('nav:/authors', 'Authors', 'CommandOrControl+4'),
        item('nav:/collections', 'Collections', 'CommandOrControl+5'),
        item('nav:/downloads', 'Downloads', 'CommandOrControl+6'),
        item('nav:/stats', 'Listening', 'CommandOrControl+7'),
        sep,
        item('back', 'Back', 'CommandOrControl+['),
        item('forward', 'Forward', 'CommandOrControl+]')
      ]
    },
    {
      label: 'Playback',
      submenu: [
        transport('play-pause', s.nowPlaying.playing ? 'Pause' : 'Play'),
        transport('skip-back', 'Skip Back'),
        transport('skip-forward', 'Skip Forward'),
        sep,
        transport('prev-chapter', 'Previous Chapter'),
        transport('next-chapter', 'Next Chapter'),
        sep,
        transport('speed-up', 'Faster'),
        transport('speed-down', 'Slower'),
        sep,
        transport('add-bookmark', 'Add Bookmark'),
        sep,
        { label: sleepTitle(s.nowPlaying), enabled: can, submenu: sleepSubmenu().map((o) => ({ label: o.label, action: o.id })) }
      ]
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom', label: 'Zoom' }, sep, { role: 'close', accelerator: 'CommandOrControl+W' }]
    }
  ];
}

/** The tray (menu bar extra) menu: what's playing, the transport, the sleep timer, and the window. */
export function buildTrayMenu(s: MenuState): MenuItemConfig[] {
  const np = s.nowPlaying;
  const can = np.canControl;
  const item = (action: string, label: string, enabled = can): MenuItemConfig => ({ type: 'normal', label, action, enabled });
  const sep: MenuItemConfig = { type: 'divider' };
  const title = np.title || 'Nothing playing';
  return [
    { type: 'normal', label: title, action: 'tray-title', enabled: false },
    { type: 'normal', label: np.subtitle || '', action: 'tray-subtitle', enabled: false, hidden: !np.subtitle },
    sep,
    item('play-pause', np.playing ? 'Pause' : 'Play'),
    item('skip-back', 'Skip Back'),
    item('skip-forward', 'Skip Forward'),
    item('prev-chapter', 'Previous Chapter'),
    item('next-chapter', 'Next Chapter'),
    sep,
    { type: 'normal', label: sleepTitle(np), enabled: can, submenu: sleepSubmenu().map((o) => item(o.id, o.label, true)) },
    sep,
    item('mini-player', miniLabel(s), true),
    item('show', 'Show Lectern', true),
    item('quit', 'Quit Lectern', true)
  ];
}

export function trayTooltip(np: NowPlayingState): string {
  return np.title ? `Lectern — ${np.title}` : 'Lectern';
}
