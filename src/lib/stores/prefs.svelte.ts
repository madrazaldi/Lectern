export type Theme = 'system' | 'dark' | 'light';

/** A window's place on screen, in points (origin at the top-left of the primary display). */
export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
  fullscreen: boolean;
}

export interface Prefs {
  theme: Theme;
  /** Let the playing book's cover colour the interface. */
  coverTint: boolean;
  skipBack: number;
  skipForward: number;
  playbackRate: number;
  volume: number;
  /** Seconds to rewind when resuming after a pause longer than a minute. */
  smartRewind: number;
  /** Prefer the series-collapsed view in the library grid. */
  collapseSeries: boolean;
  librarySort: string;
  librarySortDesc: boolean;
  libraryView: 'grid' | 'list';
  /** Remember a separate speed for each book instead of one speed for everything. */
  perItemSpeed: boolean;
  /** Speeds chosen per item, keyed by library item id. `playbackRate` is the default. */
  itemRates: Record<string, number>;
  /** When something finishes and Up Next is empty, carry on with the next book in the series or the next episode. */
  autoContinue: boolean;
  /** The player's scrubber and times cover the current chapter instead of the whole title. */
  chapterTrack: boolean;
  /** Closing the window hides it and playback carries on from the menu bar. */
  keepPlayingWhenClosed: boolean;
  /** The window is the compact mini player (and comes back that way on the next launch). */
  miniMode: boolean;
  /** Keep the mini player above other windows. */
  miniPinned: boolean;
  /** The full window's bounds from before it became the mini player, to return to. */
  miniRestore: WindowBounds | null;
  /** Where the mini player was last put (points). */
  miniPosition: { x: number; y: number } | null;
}

const KEY = 'lectern.prefs';

const defaults: Prefs = {
  theme: 'dark',
  coverTint: true,
  skipBack: 15,
  skipForward: 30,
  playbackRate: 1,
  volume: 1,
  smartRewind: 5,
  collapseSeries: false,
  librarySort: 'media.metadata.title',
  librarySortDesc: false,
  libraryView: 'grid',
  perItemSpeed: true,
  itemRates: {},
  autoContinue: true,
  chapterTrack: false,
  keepPlayingWhenClosed: true,
  miniMode: false,
  miniPinned: true,
  miniRestore: null,
  miniPosition: null
};

function load(): Prefs {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...defaults };
  }
}

export const prefs = $state<Prefs>(load());

$effect.root(() => {
  $effect(() => {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  });
  $effect(() => {
    const media = matchMedia('(prefers-color-scheme: light)');
    const apply = () => {
      const light = prefs.theme === 'light' || (prefs.theme === 'system' && media.matches);
      document.documentElement.dataset.theme = light ? 'light' : 'dark';
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  });
});
