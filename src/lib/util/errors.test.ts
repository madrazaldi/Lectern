import { describe, expect, it } from 'vitest';
import { friendlyLoginError, isUnreachable } from './errors';
import { shuffled } from './shuffle';

describe('friendlyLoginError', () => {
  it('explains a server that never answered', () => {
    const msg = friendlyLoginError(new TypeError('Failed to fetch'), 'abs.local:13378', 'https://abs.local:13378');
    expect(msg).toMatch(/^Couldn't reach the server at https:\/\/abs\.local:13378\./);
    expect(msg).toMatch(/http:\/\//);
  });

  it('skips the http hint when a scheme was typed', () => {
    const msg = friendlyLoginError(Object.assign(new Error('Nothing answered'), { status: 0 }), 'http://x', 'http://x');
    expect(msg).not.toMatch(/HTTPS/);
  });

  it('explains certificate problems', () => {
    expect(friendlyLoginError(new Error('invalid peer certificate: UnknownIssuer'), 'x')).toMatch(/certificate/);
  });

  it('does not mistake a wrong kind of server for an unreachable one', () => {
    expect(friendlyLoginError(Object.assign(new Error('https://x isn’t an Audiobookshelf server.'), { status: 0 }), 'x')).toMatch(/isn’t an Audiobookshelf/);
  });

  it('passes server answers through', () => {
    expect(friendlyLoginError(Object.assign(new Error('That username and password combination didn’t work.'), { status: 401 }), 'x')).toBe(
      'That username and password combination didn’t work.'
    );
  });

  it('knows which failures mean the server was never reached', () => {
    expect(isUnreachable({ status: 0 })).toBe(true);
    expect(isUnreachable(new Error('Load failed'))).toBe(true);
    expect(isUnreachable(Object.assign(new Error('Forbidden'), { status: 403 }))).toBe(false);
  });
});

describe('shuffled', () => {
  const xs = Array.from({ length: 50 }, (_, i) => i);

  it('is a permutation, stable for a seed', () => {
    const a = shuffled(xs, 42);
    expect(a.toSorted((x, y) => x - y)).toEqual(xs);
    expect(shuffled(xs, 42)).toEqual(a);
    expect(shuffled(xs, 43)).not.toEqual(a);
    expect(xs[0]).toBe(0);
  });
});
