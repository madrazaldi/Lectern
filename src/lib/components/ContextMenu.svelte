<script lang="ts">
  import { tick } from 'svelte';
  import { contextMenu, type MenuAction } from '$lib/util/contextMenu.svelte';
  import { firstEnabled, menuKey, placeMenu } from '$lib/util/menu';

  /** The single context menu, drawn wherever `contextMenu.open()` asked for it. */

  let el = $state<HTMLDivElement>();
  let index = $state(-1);
  let pos = $state({ left: 0, top: 0 });

  const menu = $derived(contextMenu.current);

  $effect(() => {
    if (!menu || !el) return;
    index = firstEnabled(menu.items);
    const r = el.getBoundingClientRect();
    pos = placeMenu(menu.x, menu.y, { width: r.width, height: r.height }, { width: innerWidth, height: innerHeight });
    void tick().then(() => focusItem(index));

    const onDown = (e: PointerEvent) => {
      if (!el?.contains(e.target as Node)) contextMenu.close(false);
    };
    const onBlur = () => contextMenu.close(false);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('blur', onBlur);
    window.addEventListener('resize', onBlur);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('resize', onBlur);
    };
  });

  function focusItem(i: number) {
    el?.querySelectorAll<HTMLElement>('[role="menuitem"]')[i]?.focus();
  }

  function activate(a: MenuAction) {
    if (a.disabled) return;
    // Focus goes back to the card first, so a dialog the action opens returns there when it closes.
    contextMenu.close(true);
    void a.run();
  }

  function onKey(e: KeyboardEvent) {
    if (!menu) return;
    // Nothing typed in an open menu reaches the page's own shortcuts (Space, ←/→).
    e.stopPropagation();
    const r = menuKey(e.key, index, menu.items);
    if (!r) return;
    e.preventDefault();
    if (r.type === 'close') contextMenu.close(true);
    else if (r.type === 'activate') activate(menu.items[r.index]);
    else if (r.index >= 0) {
      index = r.index;
      focusItem(index);
    }
  }
</script>

{#if menu}
  <div
    class="menu"
    role="menu"
    tabindex="-1"
    aria-label={menu.label}
    bind:this={el}
    style:left="{pos.left}px"
    style:top="{pos.top}px"
    onkeydown={onKey}
    oncontextmenu={(e) => e.preventDefault()}
  >
    {#each menu.items as a, i (a.id)}
      {#if i > 0 && a.section !== menu.items[i - 1].section}<div class="sep" role="separator"></div>{/if}
      <button
        role="menuitem"
        tabindex="-1"
        class:danger={a.danger}
        aria-disabled={a.disabled || undefined}
        onclick={() => activate(a)}
        onpointermove={() => {
          if (!a.disabled && index !== i) {
            index = i;
            focusItem(i);
          }
        }}
      >
        <span class="ic"
          >{#if a.icon}<a.icon size={15} />{/if}</span
        >
        {a.label}
      </button>
    {/each}
  </div>
{/if}

<style>
  .menu {
    position: fixed;
    z-index: 60;
    min-width: 210px;
    max-width: 300px;
    padding: 5px;
    border-radius: var(--r-md);
    background: var(--raised-2);
    border: 1px solid var(--rule);
    box-shadow: 0 18px 40px -12px rgb(0 0 0 / 0.55);
    animation: pop 110ms var(--ease);
    outline: none;
  }
  button {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    height: 32px;
    padding: 0 10px;
    border-radius: var(--r-sm);
    font-size: var(--t-sm);
    text-align: left;
    white-space: nowrap;
  }
  button:focus,
  button:focus-visible {
    outline: none;
    background: var(--accent-soft);
    color: var(--text);
  }
  button[aria-disabled='true'] {
    opacity: 0.45;
    cursor: default;
  }
  .danger {
    color: var(--danger);
  }
  .ic {
    display: inline-grid;
    place-items: center;
    width: 16px;
    color: var(--text-2);
  }
  .danger .ic {
    color: inherit;
  }
  .sep {
    height: 1px;
    margin: 4px 6px;
    background: var(--rule-soft);
  }
  @keyframes pop {
    from {
      opacity: 0;
      scale: 0.97;
    }
  }
</style>
