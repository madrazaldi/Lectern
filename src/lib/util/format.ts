/** 1:02:03 / 4:05 — clock-style position. */
export function clock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

/** "11 h 25 min" — human length for a whole book. */
export function duration(seconds: number, opts: { short?: boolean } = {}) {
  if (!Number.isFinite(seconds) || seconds <= 0) return opts.short ? '0m' : '0 min';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (opts.short) return h ? `${h}h ${m}m` : `${Math.max(m, 1)}m`;
  if (h && m) return `${h} h ${m} min`;
  if (h) return `${h} h`;
  return `${Math.max(m, 1)} min`;
}

export function timeLeft(seconds: number) {
  return `${duration(seconds, { short: true })} left`;
}

export function bytes(n: number) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export function relative(ms: number) {
  const diff = (ms - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function date(ms: number | string | null | undefined) {
  if (!ms) return '';
  const d = new Date(ms);
  if (Number.isNaN(d.valueOf())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Strip tags from server-provided HTML descriptions for one-line previews. */
export function plain(html: string | null | undefined) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Keep only harmless formatting tags from server descriptions before rendering them as HTML. */
export function safeHtml(html: string | null | undefined) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const allowed = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'UL', 'OL', 'LI', 'A', 'BLOCKQUOTE', 'H3', 'H4']);
  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      walk(child);
      if (!allowed.has(child.tagName)) {
        child.replaceWith(...Array.from(child.childNodes));
        continue;
      }
      for (const attr of Array.from(child.attributes)) {
        if (child.tagName === 'A' && attr.name === 'href' && /^https?:/i.test(attr.value)) continue;
        child.removeAttribute(attr.name);
      }
      if (child.tagName === 'A') {
        child.setAttribute('target', '_blank');
        child.setAttribute('rel', 'noreferrer');
      }
    }
  };
  walk(doc.body);
  // Plain-text descriptions: keep their paragraph breaks.
  if (!doc.body.children.length) {
    return (doc.body.textContent ?? '')
      .split(/\n{2,}/)
      .map((p) => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`)
      .join('');
  }
  return doc.body.innerHTML;
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}
