import { describe, expect, it } from 'vitest';
import type { AudioFile } from '$lib/api/types';
import { planTracks } from './downloads.svelte';

const file = (index: number, duration: number, extra: Partial<AudioFile> = {}): AudioFile => ({
  index,
  ino: `ino${index}`,
  duration,
  bitRate: 64000,
  codec: 'mp3',
  mimeType: 'audio/mpeg',
  metadata: { filename: `Part ${index}.mp3`, ext: '.mp3', size: 1000 * index },
  ...extra
});

describe('planTracks', () => {
  it('lays files end to end in index order and skips excluded ones', () => {
    const tracks = planTracks([file(2, 50), file(1, 100), file(3, 25, { exclude: true }), file(4, 10)]);
    expect(tracks.map((t) => [t.startOffset, t.duration])).toEqual([
      [0, 100],
      [100, 50],
      [150, 10]
    ]);
    expect(tracks.map((t) => t.fileName)).toEqual(['001-ino1.mp3', '002-ino2.mp3', '003-ino4.mp3']);
  });

  it('never lets a server file name or extension escape the download folder', () => {
    const [t] = planTracks([file(1, 1, { ino: '../../etc', metadata: { filename: 'x', ext: '/../../evil', size: 1 } })]);
    expect(t.fileName).toBe('001-______etc');
  });
});
