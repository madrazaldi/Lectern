<script lang="ts">
  import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
  import { onMount } from 'svelte';
  import type { BookView, TocEntry, ViewProps } from './view';

  /** A PDF, one page at a time, fitted to the space. Pages are drawn to a canvas, so nothing in the file runs. */
  let { data, start, ontoc, onrelocate, onerror }: ViewProps = $props();

  let stage: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let doc: PDFDocumentProxy | null = null;
  let page = $state(1);
  let pages = $state(0);
  /** First page of each table of contents entry. */
  let tocPages: number[] = [];
  let task: RenderTask | null = null;
  let size = $state({ w: 0, h: 0 });

  type Outline = Awaited<ReturnType<PDFDocumentProxy['getOutline']>>;

  async function pageOf(dest: Outline[number]['dest']): Promise<number> {
    if (!doc || !dest) return -1;
    try {
      const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
      const ref = explicit?.[0];
      if (typeof ref === 'number') return ref + 1;
      return ref ? (await doc.getPageIndex(ref)) + 1 : -1;
    } catch {
      return -1;
    }
  }

  async function flatten(items: Outline, depth = 0, out: TocEntry[] = []) {
    for (const it of items) {
      const p = await pageOf(it.dest);
      if (p > 0) out.push({ label: it.title.trim(), target: String(p), depth });
      if (it.items?.length) await flatten(it.items, depth + 1, out);
    }
    return out;
  }

  function report() {
    let chapter = -1;
    tocPages.forEach((p, i) => {
      if (p <= page && (chapter < 0 || p >= tocPages[chapter])) chapter = i;
    });
    // Measured the way the Audiobookshelf web reader does, so both agree on the percentage.
    onrelocate({ location: String(page), progress: Math.min(1, Math.max(0, (page - 1) / pages)), chapter, atStart: page <= 1, atEnd: page >= pages });
  }

  async function draw() {
    if (!doc || !size.w || !size.h) return;
    task?.cancel();
    const p = await doc.getPage(page);
    const natural = p.getViewport({ scale: 1 });
    const scale = Math.min(size.w / natural.width, size.h / natural.height);
    const ratio = window.devicePixelRatio || 1;
    const viewport = p.getViewport({ scale: scale * ratio });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${Math.floor(viewport.width / ratio)}px`;
    canvas.style.height = `${Math.floor(viewport.height / ratio)}px`;
    const t = (task = p.render({ canvas, viewport }));
    try {
      await t.promise;
    } catch (err) {
      if ((err as Error)?.name !== 'RenderingCancelledException') throw err;
    }
  }

  function goTo(n: number) {
    const next = Math.min(pages, Math.max(1, Math.round(n)));
    if (!pages || next === page) return;
    page = next;
    report();
  }

  onMount(() => {
    let alive = true;
    let loading: { destroy(): Promise<void> } | null = null;
    const observer = new ResizeObserver(([entry]) => {
      size = { w: entry.contentRect.width, h: entry.contentRect.height };
    });
    observer.observe(stage);

    void (async () => {
      const [pdfjs, worker] = await Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')]);
      if (!alive) return;
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      // No WebAssembly (the app's CSP doesn't allow it) and no XFA forms (scripted).
      const task = (loading = pdfjs.getDocument({ data: new Uint8Array(data.slice(0)), useWasm: false, enableXfa: false }));
      const loaded = await task.promise;
      if (!alive) return;
      doc = loaded;
      pages = loaded.numPages;
      const saved = Number(start);
      page = Number.isInteger(saved) && saved >= 1 && saved <= pages ? saved : 1;
      const toc = await flatten((await loaded.getOutline()) ?? []);
      if (!alive) return;
      tocPages = toc.map((t) => Number(t.target));
      ontoc(toc);
      report();
    })().catch((err) => {
      if (alive) onerror(err);
    });

    return () => {
      alive = false;
      observer.disconnect();
      task?.cancel();
      // Also stops a load still under way, and the worker.
      void loading?.destroy();
      doc = null;
    };
  });

  $effect(() => {
    void [page, pages, size.w, size.h];
    draw().catch((err) => onerror(err));
  });

  export const view: BookView = {
    next: () => goTo(page + 1),
    prev: () => goTo(page - 1),
    go: (target) => goTo(Number(target)),
    linkAt: () => null,
    follow: () => {}
  };
</script>

<div class="pdf" bind:this={stage}>
  <canvas bind:this={canvas} aria-label={pages ? `Page ${page} of ${pages}` : undefined}></canvas>
</div>

<style>
  .pdf {
    width: 100%;
    height: 100%;
    display: grid;
    place-items: center;
    overflow: hidden;
  }
  canvas {
    display: block;
    background: #fff;
    box-shadow: var(--shadow-cover);
  }
</style>
