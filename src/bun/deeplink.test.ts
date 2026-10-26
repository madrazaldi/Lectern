import { afterEach, describe, expect, it } from 'bun:test';
import { LOOPBACK_PORT, SCHEMES, startLoopback, stopLoopback } from './deeplink';
import { LOOPBACK_REDIRECT_URI, SCHEME_REDIRECT_URIS } from '../shared/oauth';

afterEach(() => stopLoopback());

describe('redirect URIs', () => {
  it('match what the server admin was told to allow', () => {
    expect(SCHEMES).toEqual(['audiobookshelf', 'lectern']);
    expect(SCHEME_REDIRECT_URIS).toEqual(['audiobookshelf://oauth', 'lectern://oauth']);
    expect(LOOPBACK_REDIRECT_URI).toBe('http://127.0.0.1:47017/oauth');
    expect(LOOPBACK_PORT).toBe(47017);
  });
});

describe('loopback redirect', () => {
  it('hands the page the query the server sent back, and tells the browser it can close', async () => {
    const links: string[] = [];
    const port = startLoopback((l) => links.push(l), 0);
    const res = await fetch(`http://127.0.0.1:${port}/oauth?code=abc&state=xyz`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('go back to Lectern');
    expect(links).toEqual([`http://127.0.0.1:${port}/oauth?code=abc&state=xyz`]);
  });

  it('answers nothing else', async () => {
    const links: string[] = [];
    const port = startLoopback((l) => links.push(l), 0);
    expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${port}/oauth`, { method: 'POST' })).status).toBe(404);
    expect(links).toEqual([]);
  });

  it('is gone once stopped', async () => {
    const port = startLoopback(() => {}, 0);
    stopLoopback();
    expect(await fetch(`http://127.0.0.1:${port}/oauth`).catch(() => 'refused')).toBe('refused');
  });

  it('stops by itself, so a sign-in that never finishes does not hold the port', async () => {
    const port = startLoopback(() => {}, 0, 50);
    await Bun.sleep(150);
    expect(await fetch(`http://127.0.0.1:${port}/oauth`).catch(() => 'refused')).toBe('refused');
  });

  it('can be started again', async () => {
    startLoopback(() => {}, 0);
    const port = startLoopback(() => {}, 0);
    expect((await fetch(`http://127.0.0.1:${port}/oauth`)).status).toBe(200);
  });
});
