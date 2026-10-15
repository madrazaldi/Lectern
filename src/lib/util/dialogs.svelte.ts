/** App-wide dialogs that can be opened from anywhere (a context menu, a shortcut). Drawn in the layout. */
import type { PlaylistEntry } from '$lib/api/abs';

interface PlaylistTarget {
  libraryId: string;
  entry: PlaylistEntry;
  title: string;
}

class Dialogs {
  /** "Add to playlist" for one title. */
  playlist = $state<PlaylistTarget | null>(null);
  /** The keyboard shortcut list ("?"). */
  shortcuts = $state(false);

  /** Is any of them open? (Escape and the global shortcuts leave the page alone while one is.) */
  get any() {
    return !!this.playlist || this.shortcuts;
  }
}

export const dialogs = new Dialogs();
