<script lang="ts">
  import { ALargeSmall, Minus, Plus } from '@lucide/svelte';
  import { roving } from '$lib/util/roving';
  import Popover from '../Popover.svelte';
  import { FONT_SIZE, LINE_HEIGHT, readerPrefs, stepped, type ReaderFont, type ReaderTheme } from './prefs.svelte';
  import { PALETTES } from './theme';

  /** Type and page colour. Changes apply as they're made and are remembered for every book. */
  let { pdf = false }: { pdf?: boolean } = $props();

  const fonts: { value: ReaderFont; label: string }[] = [
    { value: 'serif', label: 'Serif' },
    { value: 'sans', label: 'Sans' },
    { value: 'book', label: 'Book’s own' }
  ];
  const themes: { value: ReaderTheme; label: string; swatch: string[] }[] = [
    { value: 'auto', label: 'Match app', swatch: [PALETTES.light.paper, PALETTES.dark.paper] },
    { value: 'light', label: 'Light', swatch: [PALETTES.light.paper] },
    { value: 'sepia', label: 'Sepia', swatch: [PALETTES.sepia.paper] },
    { value: 'dark', label: 'Dark', swatch: [PALETTES.dark.paper] }
  ];

  const size = (d: number) => (readerPrefs.fontSize = stepped(readerPrefs.fontSize + d * FONT_SIZE.step, FONT_SIZE));
  const spacing = (d: number) => (readerPrefs.lineHeight = stepped(readerPrefs.lineHeight + d * LINE_HEIGHT.step, LINE_HEIGHT));
</script>

<Popover label="Reading settings" placement="down">
  {#snippet trigger()}<ALargeSmall size={18} />{/snippet}
  <div class="settings">
    {#if !pdf}
      <div class="row">
        <span class="name" id="rs-size">Text size</span>
        <div class="stepper" role="group" aria-labelledby="rs-size">
          <button class="icon-btn" onclick={() => size(-1)} disabled={readerPrefs.fontSize <= FONT_SIZE.min} aria-label="Smaller text"
            ><Minus size={16} /></button
          >
          <span class="value num" aria-live="polite">{readerPrefs.fontSize}%</span>
          <button class="icon-btn" onclick={() => size(1)} disabled={readerPrefs.fontSize >= FONT_SIZE.max} aria-label="Larger text"><Plus size={16} /></button>
        </div>
      </div>
      <div class="row">
        <span class="name" id="rs-spacing">Line spacing</span>
        <div class="stepper" role="group" aria-labelledby="rs-spacing">
          <button class="icon-btn" onclick={() => spacing(-1)} disabled={readerPrefs.lineHeight <= LINE_HEIGHT.min} aria-label="Tighter lines"
            ><Minus size={16} /></button
          >
          <span class="value num" aria-live="polite">{readerPrefs.lineHeight.toFixed(1)}</span>
          <button class="icon-btn" onclick={() => spacing(1)} disabled={readerPrefs.lineHeight >= LINE_HEIGHT.max} aria-label="Looser lines"
            ><Plus size={16} /></button
          >
        </div>
      </div>
      <div class="seg" role="radiogroup" aria-label="Typeface" {@attach roving()}>
        {#each fonts as f (f.value)}
          <button role="radio" aria-checked={readerPrefs.font === f.value} class:serif={f.value === 'serif'} onclick={() => (readerPrefs.font = f.value)}
            >{f.label}</button
          >
        {/each}
      </div>
    {/if}
    <div class="papers" role="radiogroup" aria-label="Page colour" {@attach roving()}>
      {#each themes as t (t.value)}
        <button role="radio" aria-checked={readerPrefs.theme === t.value} onclick={() => (readerPrefs.theme = t.value)}>
          <span class="swatch" style:background={t.swatch.length > 1 ? `linear-gradient(135deg, ${t.swatch[0]} 50%, ${t.swatch[1]} 50%)` : t.swatch[0]}></span>
          {t.label}
        </button>
      {/each}
    </div>
  </div>
</Popover>

<style>
  .settings {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 280px;
    padding: 4px;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .name {
    font-size: var(--t-sm);
    color: var(--text-2);
  }
  .stepper {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .value {
    min-width: 5ch;
    text-align: center;
    font-weight: 600;
  }
  .seg {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    padding: 3px;
    border-radius: 999px;
    background: var(--raised);
    border: 1px solid var(--rule);
  }
  .seg button {
    height: 28px;
    border-radius: 999px;
    font-size: var(--t-sm);
    font-weight: 600;
    color: var(--text-3);
  }
  .seg button.serif {
    font-family: var(--font-serif);
  }
  .seg button[aria-checked='true'] {
    background: var(--raised-2);
    color: var(--text);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.25);
  }
  .papers {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 4px;
  }
  .papers button {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 8px 2px;
    border-radius: var(--r-sm);
    font-size: var(--t-xs);
    color: var(--text-2);
  }
  .papers button:hover {
    background: var(--raised);
  }
  .swatch {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 1px solid var(--rule);
  }
  .papers button[aria-checked='true'] {
    color: var(--text);
    font-weight: 650;
  }
  .papers button[aria-checked='true'] .swatch {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
</style>
