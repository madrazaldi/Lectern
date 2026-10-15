export type Theme = 'system' | 'dark' | 'light';

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
  /** Closing the window hides it and playback carries on from the menu bar. */
  keepPlayingWhenClosed: boolean;
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
  keepPlayingWhenClosed: true
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
