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
  librarySortDesc: false
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
