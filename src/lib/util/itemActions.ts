/**
 * Registry of actions offered for a title (its context menu). Features add their own with
 * `registerItemAction` instead of editing the menu: each action decides per title whether it applies.
 */
import type { LibraryItem, PodcastEpisode } from '$lib/api/types';
import type { MenuAction, MenuRequest } from './contextMenu.svelte';

export interface ItemTarget {
  item: LibraryItem;
  /** Set for an episode row, or a shelf entry standing for a podcast's latest episode. */
  episode?: PodcastEpisode | null;
}

/** Menu sections in display order; actions in a later or unknown section go below. */
export const SECTIONS = ['play', 'library', 'organize', 'go'] as const;

export interface ItemActionDef {
  id: string;
  section: (typeof SECTIONS)[number] | (string & {});
  /** Position within its section (lower first). */
  order?: number;
  /** The action for this title, or null if it doesn't apply. */
  build: (target: ItemTarget) => Omit<MenuAction, 'id' | 'section'> | null;
}

const registry = new Map<string, ItemActionDef>();

/** Add (or replace, by id) an action. Returns a function that removes it. */
export function registerItemAction(def: ItemActionDef) {
  registry.set(def.id, def);
  return () => {
    if (registry.get(def.id) === def) registry.delete(def.id);
  };
}

function rank(section: string) {
  const i = (SECTIONS as readonly string[]).indexOf(section);
  return i < 0 ? SECTIONS.length : i;
}

/** Everything that applies to a title, in menu order. */
export function itemActions(target: ItemTarget): MenuAction[] {
  return [...registry.values()]
    .toSorted((a, b) => rank(a.section) - rank(b.section) || (a.order ?? 0) - (b.order ?? 0))
    .flatMap((def) => {
      const built = def.build(target);
      return built ? [{ ...built, id: def.id, section: def.section }] : [];
    });
}

export function itemMenuRequest(target: ItemTarget): MenuRequest | null {
  const items = itemActions(target);
  if (!items.length) return null;
  const title = target.episode?.title ?? target.item.collapsedSeries?.name ?? target.item.media.metadata.title;
  return { label: `Actions for ${title}`, items };
}
