<script lang="ts">
  /** A circular arrow with the skip interval written inside it. */
  let { seconds, direction, size = 26 }: { seconds: number; direction: 'back' | 'forward'; size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 28 28" fill="none" aria-hidden="true">
  <g transform={direction === 'forward' ? 'translate(28 0) scale(-1 1)' : undefined}>
    <path d="M5.2 10.5A10 10 0 1 1 4 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
    <path d="M4.6 5.6v5.4H10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
  </g>
  <text x="14.4" y="17.9" text-anchor="middle" font-size="9.5" font-weight="700" fill="currentColor" font-family="var(--font-sans)">{seconds}</text>
</svg>
