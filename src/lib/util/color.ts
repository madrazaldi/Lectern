import { fetchBlob } from '$lib/api/client';

export interface Tint {
  /** Saturated mid-tone, used for accents (fills, focus, the chapter shelf). */
  accent: string;
  /** Very dark variant for washes behind the now-playing view. */
  deep: string;
  rgb: [number, number, number];
  h: number;
  s: number;
}

const cache = new Map<string, Promise<Tint | null>>();

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

/**
 * Pick the cover's most characterful colour: bucket pixels by hue, weight each bucket by
 * saturation and how far it sits from pure black/white, then return the winner normalised
 * into a lightness band that reads on the dark ground.
 */
async function extract(url: string): Promise<Tint | null> {
  const blob = await fetchBlob(url);
  const bitmap = await createImageBitmap(blob, { resizeWidth: 48, resizeHeight: 48 });
  const canvas = new OffscreenCanvas(48, 48);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, 48, 48);
  const { data } = ctx.getImageData(0, 0, 48, 48);

  const buckets = new Map<number, { w: number; h: number; s: number; n: number }>();
  for (let i = 0; i < data.length; i += 4) {
    const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    if (l < 0.08 || l > 0.94) continue;
    const key = Math.round(h / 20) % 18;
    const weight = s * s * (1 - Math.abs(l - 0.5) * 1.4);
    const b = buckets.get(key) ?? { w: 0, h: 0, s: 0, n: 0 };
    b.w += weight;
    b.h += h * weight;
    b.s += s * weight;
    b.n++;
    buckets.set(key, b);
  }
  let best: { w: number; h: number; s: number; n: number } | null = null;
  for (const b of buckets.values()) if (!best || b.w > best.w) best = b;
  if (!best || best.w < 0.5) return null;

  const hue = best.h / best.w;
  const sat = Math.min(Math.max(best.s / best.w, 0.38), 0.72);
  return {
    accent: `hsl(${hue.toFixed(0)} ${(sat * 100).toFixed(0)}% 64%)`,
    deep: `hsl(${hue.toFixed(0)} ${(sat * 55).toFixed(0)}% 13%)`,
    rgb: hslToRgb(hue, sat, 0.64),
    h: Math.round(hue),
    s: Math.round(sat * 100)
  };
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

export function tintFor(url: string): Promise<Tint | null> {
  let p = cache.get(url);
  if (!p) {
    // A cover with no usable colour is remembered; a failed fetch (offline, server busy) is tried again next time.
    p = extract(url).catch(() => {
      cache.delete(url);
      return null;
    });
    cache.set(url, p);
  }
  return p;
}
