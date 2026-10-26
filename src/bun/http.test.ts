import { afterAll, describe, expect, it } from 'bun:test';
import { describeError, httpAbort, httpFetch } from './http';

const server = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  async fetch(req) {
    const url = new URL(req.url);
    switch (url.pathname) {
      case '/echo':
        return Response.json({ method: req.method, body: await req.text(), auth: req.headers.get('authorization') });
      case '/binary':
        return new Response(Uint8Array.from([0, 255, 128, 1]), { headers: { 'content-type': 'application/octet-stream' } });
      case '/cookies':
        return new Response('ok', {
          headers: [
            ['set-cookie', 'a=1; Path=/'],
            ['set-cookie', 'b=2; HttpOnly'],
            ['x-one', '1']
          ]
        });
      case '/redirect':
        return new Response(null, { status: 302, headers: { location: '/echo' } });
      case '/401':
        return new Response('nope', { status: 401, statusText: 'Unauthorized' });
      case '/slow':
        await Bun.sleep(5000);
        return new Response('late');
    }
    return new Response('missing', { status: 404 });
  }
});
afterAll(() => server.stop(true));
const base = `http://127.0.0.1:${server.port}`;
let n = 0;
const req = (path: string, extra: Record<string, unknown> = {}) => ({ id: `t${++n}`, url: base + path, method: 'GET', headers: {}, ...extra }) as never;
const text = (b64: string) => Buffer.from(b64, 'base64').toString();

describe('http_fetch', () => {
  it('sends the method, headers and body, and returns the body as base64', async () => {
    const res = await httpFetch(req('/echo', { method: 'POST', headers: { authorization: 'Bearer t' }, body: Buffer.from('héllo').toString('base64') }));
    expect(res.status).toBe(200);
    expect(JSON.parse(text(res.body))).toEqual({ method: 'POST', body: 'héllo', auth: 'Bearer t' });
  });

  it('keeps binary bodies intact', async () => {
    const res = await httpFetch(req('/binary'));
    expect([...Buffer.from(res.body, 'base64')]).toEqual([0, 255, 128, 1]);
  });

  it('keeps every Set-Cookie, which a Headers object would merge', async () => {
    const res = await httpFetch(req('/cookies'));
    expect(res.headers.filter(([k]) => k === 'set-cookie').map(([, v]) => v)).toEqual(['a=1; Path=/', 'b=2; HttpOnly']);
    expect(res.headers).toContainEqual(['x-one', '1']);
  });

  it('does not pass on headers that describe the wire encoding', async () => {
    const res = await httpFetch(req('/echo'));
    const names = res.headers.map(([k]) => k);
    for (const n of ['content-length', 'content-encoding', 'transfer-encoding']) expect(names).not.toContain(n);
  });

  it('follows redirects, or reports them when told to', async () => {
    const followed = await httpFetch(req('/redirect'));
    expect(followed.status).toBe(200);
    expect(followed.url).toBe(`${base}/echo`);
    const manual = await httpFetch(req('/redirect', { redirect: 'manual' }));
    expect(manual.status).toBe(302);
    expect(manual.headers).toContainEqual(['location', '/echo']);
  });

  it('returns error statuses instead of throwing', async () => {
    const res = await httpFetch(req('/401'));
    expect(res.status).toBe(401);
    expect(text(res.body)).toBe('nope');
  });

  it('throws a message for network errors', async () => {
    const dead = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('') });
    const port = dead.port;
    dead.stop(true);
    const err = await httpFetch({ id: 'dead', url: `http://127.0.0.1:${port}/`, method: 'GET', headers: {} } as never).catch((e) => e);
    expect(typeof err).toBe('string');
    expect(err.length).toBeGreaterThan(0);
  });

  it('can be aborted by id', async () => {
    const r = req('/slow');
    const pending = httpFetch(r).catch((e) => e);
    await Bun.sleep(50);
    httpAbort({ id: (r as { id: string }).id });
    const t = Date.now();
    expect(typeof (await pending)).toBe('string');
    expect(Date.now() - t).toBeLessThan(2000);
  });

  it('puts the error code in the message so the page can recognise certificate problems', () => {
    const e = Object.assign(new Error('unable to verify the first certificate'), { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' });
    expect(describeError(e)).toBe('UNABLE_TO_VERIFY_LEAF_SIGNATURE: unable to verify the first certificate');
    expect(describeError(Object.assign(new Error('CERT_HAS_EXPIRED here'), { code: 'CERT_HAS_EXPIRED' }))).toBe('CERT_HAS_EXPIRED here');
    expect(describeError('plain')).toBe('plain');
  });
});
