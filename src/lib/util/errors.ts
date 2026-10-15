/** Turn low-level failures into sentences a person can act on. */

const NETWORK =
  /failed to fetch|load failed|networkerror|network request failed|fetch failed|error sending request|connection (refused|reset)|could not connect|nothing answered|can't reach|timed? ?out/i;
const CERTIFICATE = /certificate|ssl|tls|self[- ]signed/i;

export function messageOf(err: unknown) {
  return err instanceof Error ? err.message : String(err ?? '');
}

/** True for failures that mean "the server wasn't reached" (as opposed to the server saying no). */
export function isUnreachable(err: unknown) {
  const status = (err as { status?: unknown } | null)?.status;
  return status === 0 || NETWORK.test(messageOf(err));
}

/**
 * Sign-in errors. `server` is the address as typed; `url` the normalised one we tried (https:// is assumed
 * when no scheme is typed, which is the usual reason a local server "isn't there").
 */
export function friendlyLoginError(err: unknown, server: string, url?: string) {
  const msg = messageOf(err);
  const shown = url || server.trim();
  if (err instanceof TypeError && /invalid url|url/i.test(msg)) {
    return `“${server.trim()}” doesn't look like a server address. Try something like abs.example.com or 192.168.1.20:13378.`;
  }
  if (CERTIFICATE.test(msg)) return `The server at ${shown} has a security certificate this computer doesn't trust.`;
  // Not isUnreachable(): sign-in also reports "isn't an Audiobookshelf server" with status 0.
  if (NETWORK.test(msg)) {
    const guessedHttps = !/^https?:\/\//i.test(server.trim());
    return (
      `Couldn't reach the server at ${shown}. Check the address, and that the server is running and reachable from this computer.` +
      (guessedHttps ? ' If it doesn’t use HTTPS, type the address with http:// in front.' : '')
    );
  }
  return msg || 'Something went wrong. Try again.';
}
