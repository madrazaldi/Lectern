/** App-wide dialogs that can be opened from anywhere (a context menu, a shortcut). Drawn in the layout. */
import { SvelteSet } from 'svelte/reactivity';
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

  /** Dialogs mounted on their own (a confirmation, the collection picker), each by how to dismiss it. */
  #standalone = new SvelteSet<() => void>();

  /** Is any of them open? (Escape and the global shortcuts leave the page alone while one is.) */
  get any() {
    return !!this.playlist || this.shortcuts || this.#standalone.size > 0;
  }

  /** Count a dialog mounted on its own as open until the returned function is called. `dismiss` cancels it. */
  track(dismiss: () => void) {
    this.#standalone.add(dismiss);
    return () => void this.#standalone.delete(dismiss);
  }

  /** Close (cancel) every dialog, e.g. going to the mini player, which can't show them. */
  closeAll() {
    this.playlist = null;
    this.shortcuts = false;
    for (const dismiss of [...this.#standalone]) dismiss();
  }
}

export const dialogs = new Dialogs();
