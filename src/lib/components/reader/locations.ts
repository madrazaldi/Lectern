/**
 * epub.js "locations" (a CFI every so many characters) turn a position into a percentage. Generating them reads
 * the whole book, so they're kept for the few books read most recently.
 */
const PREFIX = 'lectern.reader.locations.';
const KEEP = 8;

interface Entry {
  locations: string;
  usedAt: number;
}

function entries(storage: Storage) {
  const out: { key: string; usedAt: number }[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(PREFIX)) continue;
    try {
      out.push({ key, usedAt: (JSON.parse(storage.getItem(key)!) as Entry).usedAt ?? 0 });
    } catch {
      out.push({ key, usedAt: 0 });
    }
  }
  return out;
}

export function loadLocations(id: string, storage: Storage = localStorage): string | null {
  try {
    const entry = JSON.parse(storage.getItem(PREFIX + id) ?? 'null') as Entry | null;
    if (!entry?.locations) return null;
    storage.setItem(PREFIX + id, JSON.stringify({ ...entry, usedAt: Date.now() }));
    return entry.locations;
  } catch {
    return null;
  }
}

export function saveLocations(id: string, locations: string, storage: Storage = localStorage) {
  const old = entries(storage)
    .filter((e) => e.key !== PREFIX + id)
    .sort((a, b) => b.usedAt - a.usedAt)
    .slice(KEEP - 1);
  for (const e of old) storage.removeItem(e.key);
  try {
    storage.setItem(PREFIX + id, JSON.stringify({ locations, usedAt: Date.now() } satisfies Entry));
  } catch {
    // Quota: they'll be generated again next time.
  }
}
