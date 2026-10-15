import { mount, unmount } from 'svelte';
import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel: string;
  danger?: boolean;
  /** Label for an extra checkbox (e.g. "Also delete the file"); its state comes back in the result. */
  option?: string;
}

export interface ConfirmResult {
  option: boolean;
}

/**
 * Ask before doing something that can't be undone. Resolves to null when cancelled. Mounted on its own, so it
 * can be opened from anywhere (a context menu action) without a host component.
 */
export function confirmDialog(opts: ConfirmOptions): Promise<ConfirmResult | null> {
  return new Promise((resolve) => {
    const app = mount(ConfirmDialog, {
      target: document.body,
      props: {
        ...opts,
        onanswer: (r: ConfirmResult | null) => {
          resolve(r);
          // Not from inside its own close handler.
          setTimeout(() => void unmount(app));
        }
      }
    });
  });
}

/**
 * Attachment for a dialog's content: keys typed in it stay there instead of reaching the app's global shortcuts
 * (Space would otherwise play/pause behind the dialog). Escape still closes the dialog: that's the browser's.
 */
export function containKeys(el: HTMLElement) {
  const stop = (e: KeyboardEvent) => e.stopPropagation();
  el.addEventListener('keydown', stop);
  return () => el.removeEventListener('keydown', stop);
}
