<script lang="ts">
  import type { Book, Contents, Location, NavItem, Rendition } from 'epubjs';
  import { onMount } from 'svelte';
  import { loadLocations, saveLocations } from './locations';
  import type { BookView, TocEntry, ViewProps } from './view';

  /**
   * An EPUB, paginated by epub.js. Each section renders in an iframe sandboxed without `allow-scripts`
   * (`allowScriptedContent: false`), so scripts in a book never run. In WebKit that sandbox also stops events
   * inside the frame from reaching listeners we attach, so nothing here relies on them: keys go to the app's
   * window, and the chrome lays a layer over the page for clicks and asks `linkAt` what's under the pointer.
   */
  let { data, start, cacheId, css, ontoc, onrelocate, onerror }: ViewProps & { css: string } = $props();

  let stage: HTMLDivElement;
  let book: Book | null = null;
  let rendition: Rendition | null = null;
  let current: Location | null = null;
  /** Spine index of each table of contents entry. */
  let tocSpine: number[] = [];

  const ORIGIN = 'https://book.invalid/';

  /** A path relative to the package (how the spine names sections) for `href` as written in `base`. */
  function resolve(href: string, base: string) {
    const url = new URL(href, ORIGIN + base);
    return decodeURIComponent(url.pathname.slice(1)) + url.hash;
  }

  const spineIndex = (target: string) => book?.spine.get(target.split('#')[0])?.index ?? -1;

  function flatten(items: NavItem[], navBase: string, depth = 0, out: TocEntry[] = []) {
    for (const it of items) {
      const resolved = resolve(it.href, navBase);
      out.push({ label: it.label.trim(), target: spineIndex(resolved) >= 0 ? resolved : it.href, depth });
      if (it.subitems?.length) flatten(it.subitems, navBase, depth + 1, out);
    }
    return out;
  }

  const contentsList = () => (rendition?.getContents() as unknown as Contents[] | undefined) ?? [];

  function report() {
    if (!current || !book) return;
    const { start: s, end } = current;
    let progress: number;
    if (book.locations.length() > 0) {
      progress = book.locations.percentageFromCfi(end.cfi);
    } else {
      // Until locations exist: how far through the spine, counting pages within the section.
      const sections = (book.spine as unknown as { length: number }).length || 1;
      progress = (s.index + s.displayed.page / Math.max(1, s.displayed.total)) / sections;
    }
    let chapter = -1;
    for (let i = 0; i < tocSpine.length; i++) {
      if (tocSpine[i] < 0 || tocSpine[i] > s.index) continue;
      if (chapter < 0 || tocSpine[i] > tocSpine[chapter]) chapter = i;
    }
    onrelocate({
      location: s.cfi,
      progress: Math.min(1, Math.max(0, progress)),
      chapter,
      atStart: current.atStart,
      atEnd: current.atEnd
    });
  }

  onMount(() => {
    let alive = true;
    let observer: ResizeObserver | undefined;
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;

    void (async () => {
      const { default: ePub, EpubCFI } = await import('epubjs');
      if (!alive) return;
      // epub.js keeps the buffer; the caller's copy stays usable.
      const b = (book = ePub(data.slice(0)));
      const r = (rendition = b.renderTo(stage, {
        width: '100%',
        height: '100%',
        flow: 'paginated',
        spread: 'auto',
        minSpreadWidth: 800,
        allowScriptedContent: false
      }));
      r.hooks.content.register((contents: Contents) => contents.addStylesheetCss(css, 'lectern'));
      r.on('relocated', (loc: Location) => {
        current = loc;
        report();
      });

      await b.ready;
      const nav = await b.loaded.navigation;
      if (!alive) return;
      const navBase = b.packaging.navPath || b.packaging.ncxPath || '';
      const toc = flatten(nav.toc, navBase);
      tocSpine = toc.map((t) => spineIndex(t.target));
      ontoc(toc);

      const target = start?.startsWith('epubcfi(') ? start : undefined;
      try {
        await r.display(target);
        // The page breaks move once the frame's fonts arrive (and with them, the page a position falls on).
        await Promise.all(contentsList().map((c) => c.document?.fonts?.ready));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        if (target && alive) {
          await r.display(target);
          // A position that starts a page can round down onto the page before it.
          const end = (r.currentLocation() as unknown as Location | undefined)?.end?.cfi;
          if (end && new EpubCFI().compare(target, end) > 0) await r.next();
        }
      } catch {
        // A position from an older edition of the file: start from the beginning.
        await r.display();
      }

      observer = new ResizeObserver(() => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          if (!alive) return;
          // epub.js sizes itself to the container and re-displays the current position.
          (r as unknown as { resize: () => void }).resize();
        }, 150);
      });
      observer.observe(stage);

      const cached = loadLocations(cacheId);
      if (cached) b.locations.load(cached);
      else {
        await b.locations.generate(1600);
        if (!alive) return;
        saveLocations(cacheId, b.locations.save());
      }
      report();
    })().catch((err) => {
      if (alive) onerror(err);
    });

    return () => {
      alive = false;
      observer?.disconnect();
      clearTimeout(resizeTimer);
      rendition?.destroy();
      book?.destroy();
      rendition = book = null;
    };
  });

  // Typography and colours: restyle what's on screen, then go back to the same place (the page breaks moved).
  $effect(() => {
    const sheet = css;
    const r = rendition;
    if (!r) return;
    for (const c of contentsList()) void c.addStylesheetCss(sheet, 'lectern');
    const cfi = current?.start.cfi;
    if (!cfi) return;
    let frame = requestAnimationFrame(() => (frame = requestAnimationFrame(() => void r.display(cfi))));
    return () => cancelAnimationFrame(frame);
  });

  export const view: BookView = {
    next: () => void rendition?.next(),
    prev: () => void rendition?.prev(),
    go: (target) => void rendition?.display(target),
    linkAt(x, y) {
      for (const contents of contentsList()) {
        const frame = contents.document?.defaultView?.frameElement;
        if (!frame) continue;
        const r = frame.getBoundingClientRect();
        if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
        const a = contents.document.elementFromPoint(x - r.left, y - r.top)?.closest('a[href]');
        const href = a?.getAttribute('href');
        if (!href) return null;
        if (/^[a-z][a-z\d+.-]*:/i.test(href)) return /^(https?|mailto):/i.test(href) ? href : null;
        const section = book?.spine.get(contents.sectionIndex);
        return section ? resolve(href, section.href) : null;
      }
      return null;
    },
    follow(href) {
      void rendition?.display(href);
    }
  };
</script>

<div class="epub" bind:this={stage}></div>

<style>
  .epub {
    width: 100%;
    height: 100%;
  }
</style>
