/**
 * The app's one context menu. Anything can open it with a list of actions; ContextMenu.svelte (mounted
 * once in the layout) draws it. `contextMenuFor` wires an element up to right-click, Shift+F10 and the
 * context-menu key.
 */
import type { LucideIcon } from '@lucide/svelte';
import { activeElement, returnFocus } from './dom';
import { opensContextMenu } from './menu';

export interface MenuAction {
  id: string;
  label: string;
  icon?: LucideIcon;
  run: () => unknown;
  disabled?: boolean;
  danger?: boolean;
  /** Actions with different sections are separated by a rule. */
  section?: string;
}

export interface MenuRequest {
  /** Accessible name of the menu, e.g. the title it acts on. */
  label: string;
  items: MenuAction[];
}

interface OpenMenu extends MenuRequest {
  x: number;
  y: number;
  /** Where focus goes back to when the menu closes. */
  returnTo: HTMLElement | null;
}

class ContextMenuState {
  current = $state<OpenMenu | null>(null);

  open(req: MenuRequest, at: { x: number; y: number }, returnTo: HTMLElement | null = activeElement()) {
    if (!req.items.length) return;
    this.current = { ...req, ...at, returnTo };
  }

  close(restoreFocus = true) {
    const was = this.current;
    this.current = null;
    if (restoreFocus && was) returnFocus(was.returnTo);
  }
}

export const contextMenu = new ContextMenuState();

/**
 * Attachment: open a context menu for this element on right-click or from the keyboard. `build` runs
 * at open time, so the actions reflect the current state (queued, finished, downloaded…).
 */
export function contextMenuFor(build: () => MenuRequest | null) {
  return (el: HTMLElement) => {
    const show = (at: { x: number; y: number }, returnTo: HTMLElement | null) => {
      const req = build();
      if (req) contextMenu.open(req, at, returnTo);
      return !!req;
    };
    const onContext = (e: MouseEvent) => {
      // Inside text fields, keep the system menu (copy/paste).
      if ((e.target as HTMLElement).closest('input, textarea, [contenteditable]')) return;
      if (show({ x: e.clientX, y: e.clientY }, activeElement() ?? el)) e.preventDefault();
    };
    const onKey = (e: KeyboardEvent) => {
      if (!opensContextMenu(e)) return;
      const r = (e.target as HTMLElement).getBoundingClientRect();
      if (show({ x: r.left + Math.min(24, r.width / 2), y: r.top + Math.min(r.height, 40) }, e.target as HTMLElement)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    el.addEventListener('contextmenu', onContext);
    el.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('contextmenu', onContext);
      el.removeEventListener('keydown', onKey);
    };
  };
}
