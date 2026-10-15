<script lang="ts">
  import { containKeys, type ConfirmOptions, type ConfirmResult } from '$lib/util/confirm';
  import Modal from './Modal.svelte';

  /** A yes/no question, optionally with one checkbox. Opened through `confirmDialog()`, which mounts and removes it. */
  let { title, message, confirmLabel, danger = false, option, onanswer }: ConfirmOptions & { onanswer: (r: ConfirmResult | null) => void } = $props();

  let checked = $state(false);
  let answer: ConfirmResult | null = null;
</script>

<Modal label={title} width={400} onclose={() => onanswer(answer)}>
  {#snippet children({ close })}
    <div class="confirm" {@attach containKeys}>
      <h2 class="serif">{title}</h2>
      {#if message}<p class="muted">{message}</p>{/if}
      {#if option}
        <label class="option"><input type="checkbox" bind:checked /> {option}</label>
      {/if}
      <div class="row">
        <button class="btn btn-quiet" onclick={close}>Cancel</button>
        <button
          class="btn {danger ? 'btn-danger' : 'btn-primary'}"
          onclick={() => {
            answer = { option: checked };
            close();
          }}>{confirmLabel}</button
        >
      </div>
    </div>
  {/snippet}
</Modal>

<style>
  .confirm {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 4px;
  }
  h2 {
    font-size: var(--t-lg);
    font-weight: 620;
  }
  p {
    font-size: var(--t-sm);
  }
  .option {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--t-sm);
  }
  .row {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 6px;
  }
</style>
