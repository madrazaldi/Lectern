/** Window title for a page: "Long Night — Lectern". Empty parts (still loading) are skipped. */
export function pageTitle(...parts: (string | null | undefined | false)[]) {
  return [...parts.filter(Boolean), 'Lectern'].join(' — ');
}
