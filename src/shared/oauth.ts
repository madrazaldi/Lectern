// Where the server may send the browser back to after single sign-on, by platform. See src/bun/deeplink.ts.
export const SCHEME_REDIRECT_URIS = ['audiobookshelf://oauth', 'lectern://oauth'] as const;
/** Windows and Linux (and a fallback anywhere else): the app answers on this loopback address itself. */
export const LOOPBACK_REDIRECT_URI = 'http://127.0.0.1:47017/oauth';
