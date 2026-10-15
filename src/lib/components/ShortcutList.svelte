<script lang="ts">
  import { inTauri } from '$lib/native';
  import { session } from '$lib/stores/session.svelte';
  import { describeShortcuts, isMacPlatform } from '$lib/util/shortcuts';

  /** The shortcut list, straight from the registry the keyboard handler uses. */
  const groups = $derived(describeShortcuts({ books: session.library?.mediaType !== 'podcast', desktop: inTauri, mac: isMacPlatform() }));
</script>

<div class="groups">
  {#each groups as g (g.group)}
    <section>
      <h3>{g.group}</h3>
      <dl class="keys">
        {#each g.rows as r (r.id)}
          <div>
            <dt>
              {#each r.keys as k, i (k)}{#if i}<span class="or">or</span>{/if}<kbd>{k}</kbd>{/each}
            </dt>
            <dd>{r.label}</dd>
          </div>
        {/each}
      </dl>
    </section>
  {/each}
</div>

<style>
  .groups {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  h3 {
    font-size: var(--t-xs);
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-3);
    margin-bottom: 4px;
  }
  .keys {
    margin: 0;
  }
  .keys > div {
    display: grid;
    grid-template-columns: 210px 1fr;
    align-items: baseline;
    padding: 7px 0;
    border-bottom: 1px solid var(--rule-soft);
    font-size: var(--t-sm);
  }
  dt {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px;
  }
  dd {
    margin: 0;
  }
  .or {
    font-size: var(--t-xs);
    color: var(--text-3);
  }
  kbd {
    font-family: var(--font-sans);
    font-size: var(--t-xs);
    padding: 2px 7px;
    border-radius: 5px;
    border: 1px solid var(--rule);
    background: var(--raised);
    color: var(--text);
    white-space: nowrap;
  }
</style>
