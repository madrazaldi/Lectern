// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { bytes, clock, duration, plain, plural, safeHtml } from './format';

describe('clock', () => {
  it('formats positions', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(65)).toBe('1:05');
    expect(clock(3723)).toBe('1:02:03');
    expect(clock(-4)).toBe('0:00');
    expect(clock(NaN)).toBe('0:00');
  });
});

describe('duration', () => {
  it('formats lengths', () => {
    expect(duration(41_100)).toBe('11 h 25 min');
    expect(duration(7200)).toBe('2 h');
    expect(duration(20)).toBe('1 min');
    expect(duration(41_100, { short: true })).toBe('11h 25m');
    expect(duration(0, { short: true })).toBe('0m');
  });
});

describe('bytes and plural', () => {
  it('scales units', () => {
    expect(bytes(0)).toBe('0 B');
    expect(bytes(512)).toBe('512 B');
    expect(bytes(1536)).toBe('1.5 KB');
    expect(bytes(3 * 1024 ** 3)).toBe('3.0 GB');
  });

  it('pluralises', () => {
    expect(plural(1, 'book')).toBe('1 book');
    expect(plural(2, 'book')).toBe('2 books');
    expect(plural(2, 'series', 'series')).toBe('2 series');
  });
});

describe('safeHtml', () => {
  it('strips scripts, handlers and unknown tags but keeps formatting', () => {
    const out = safeHtml('<p onclick="x()">Hi <b>there</b><script>alert(1)</script><img src=x onerror=alert(1)></p>');
    expect(out).toBe('<p>Hi <b>there</b>alert(1)</p>');
  });

  it('keeps only http(s) links and opens them externally', () => {
    const out = safeHtml('<a href="javascript:alert(1)">bad</a> <a href="https://example.com">good</a>');
    expect(out).toBe('<a target="_blank" rel="noreferrer">bad</a> <a href="https://example.com" target="_blank" rel="noreferrer">good</a>');
  });

  it('turns plain text paragraphs into escaped <p>s', () => {
    expect(safeHtml('One & two\n\nThree')).toBe('<p>One &amp; two</p><p>Three</p>');
  });

  it('plain() flattens markup', () => {
    expect(plain('<p>One</p>\n<p>Two</p>')).toBe('One Two');
  });
});
