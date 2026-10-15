import type { ReaderFont, ReaderPrefs, ReaderTheme } from './prefs.svelte';

export type Paper = 'light' | 'dark' | 'sepia';

/** Page colours. The reader's chrome takes them on too (they stand in for the app's tokens inside it). */
export interface Palette {
  scheme: 'light' | 'dark';
  paper: string;
  raised: string;
  raised2: string;
  rule: string;
  ink: string;
  ink2: string;
  ink3: string;
  link: string;
}

export const PALETTES: Record<Paper, Palette> = {
  // The app's own dark and light grounds, so following the app theme looks like the app.
  dark: {
    scheme: 'dark',
    paper: '#1b1922',
    raised: '#23202b',
    raised2: '#2c2836',
    rule: '#353040',
    ink: '#e9e2d5',
    ink2: '#b3abbd',
    ink3: '#958da1',
    link: '#e0b56f'
  },
  light: {
    scheme: 'light',
    paper: '#f9f8fb',
    raised: '#efedf2',
    raised2: '#ffffff',
    rule: '#d6d1dd',
    ink: '#211d29',
    ink2: '#57506a',
    ink3: '#696279',
    link: '#93621a'
  },
  // Faint text still clears 4.5:1 on the paper.
  sepia: {
    scheme: 'light',
    paper: '#f4ecd8',
    raised: '#ebe1c9',
    raised2: '#faf4e6',
    rule: '#d8cbac',
    ink: '#3f3224',
    ink2: '#5e4c38',
    ink3: '#6e5a43',
    link: '#8a4f12'
  }
};

export function resolvePaper(theme: ReaderTheme, appLight: boolean): Paper {
  return theme === 'auto' ? (appLight ? 'light' : 'dark') : theme;
}

export const FONT_STACKS: Record<Exclude<ReaderFont, 'book'>, string> = {
  serif: "'Literata Variable', 'Iowan Old Style', Georgia, serif",
  sans: "'Schibsted Grotesk Variable', -apple-system, 'Segoe UI', sans-serif"
};

/**
 * The stylesheet laid over the book's own. It wins over the publisher's colours (dark text on a dark page is
 * unreadable) and, when one is chosen, its typeface; sizes scale from the book's own so headings keep their rank.
 */
export function contentCss(prefs: ReaderPrefs, palette: Palette, fontFaces = '') {
  const family = prefs.font === 'book' ? null : FONT_STACKS[prefs.font];
  return `${fontFaces}
html { color-scheme: ${palette.scheme}; }
html, body { background: transparent !important; color: ${palette.ink} !important; }
body { font-size: ${prefs.fontSize}% !important; }
body * { color: inherit !important; background-color: transparent !important; border-color: ${palette.rule} !important; }
p, li, blockquote, dd, dt, div, span, td, th { line-height: ${prefs.lineHeight} !important; }
${family ? `body, body *:not(code):not(pre):not(kbd):not(samp) { font-family: ${family} !important; }` : ''}
a, a * { color: ${palette.link} !important; }
::selection { background: ${palette.link}44; }`;
}

/**
 * The app's @font-face rules for its reading faces, so the book's frame (a separate document) can use them.
 * URLs are made absolute: the frame's base URL is the book's, not the app's.
 */
export function appFontFaces(doc: Document = document) {
  const out: string[] = [];
  for (const sheet of Array.from(doc.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    const base = sheet.href ?? doc.baseURI;
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSFontFaceRule) || !/Literata|Schibsted/.test(rule.style.getPropertyValue('font-family'))) continue;
      out.push(rule.cssText.replace(/url\((['"]?)([^'")]+)\1\)/g, (_, q, u) => `url(${q}${new URL(u, base).href}${q})`));
    }
  }
  return out.join('\n');
}
