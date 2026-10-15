// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';

const mounted = vi.hoisted(() => [] as { props: Record<string, unknown>; unmounted: boolean }[]);
vi.mock('svelte', async (orig) => ({
  ...(await orig<typeof import('svelte')>()),
  mount: (_: unknown, opts: { props: Record<string, unknown> }) => {
    const app = { props: opts.props, unmounted: false };
    mounted.push(app);
    return app;
  },
  unmount: (app: { unmounted: boolean }) => void (app.unmounted = true)
}));
vi.mock('$lib/components/ConfirmDialog.svelte', () => ({ default: {} }));

const { dialogs } = await import('./dialogs.svelte');
const { confirmDialog } = await import('./confirm');

describe('dialogs', () => {
  it('counts a dialog mounted on its own as open until it is released', () => {
    expect(dialogs.any).toBe(false);
    const release = dialogs.track(() => {});
    expect(dialogs.any).toBe(true);
    release();
    expect(dialogs.any).toBe(false);
  });

  it('closes everything at once, cancelling a confirmation', async () => {
    vi.useFakeTimers();
    dialogs.shortcuts = true;
    const answer = confirmDialog({ title: 'Remove?', confirmLabel: 'Remove' });
    expect(dialogs.any).toBe(true);
    dialogs.closeAll();
    expect(await answer).toBeNull();
    expect(dialogs.any).toBe(false);
    vi.runAllTimers();
    expect(mounted.at(-1)?.unmounted).toBe(true);
    // Its own close event arriving afterwards changes nothing.
    (mounted.at(-1)!.props.onanswer as (r: unknown) => void)({ option: false });
    expect(dialogs.any).toBe(false);
    vi.useRealTimers();
  });

  it('answers a confirmation the usual way', async () => {
    const answer = confirmDialog({ title: 'Remove?', confirmLabel: 'Remove', option: 'Also the file' });
    (mounted.at(-1)!.props.onanswer as (r: unknown) => void)({ option: true });
    expect(await answer).toEqual({ option: true });
    expect(dialogs.any).toBe(false);
  });
});
