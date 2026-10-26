// Pushes from the backend to the page. index.ts connects the sink to the window; until then (and in tests) events
// are dropped.
import type { PushEvents } from '../shared/rpc';

type Sink = <K extends keyof PushEvents>(event: K, payload: PushEvents[K]) => void;

let sink: Sink | null = null;

export function setEventSink(next: Sink | null) {
  sink = next;
}

export function emit<K extends keyof PushEvents>(event: K, payload: PushEvents[K]) {
  try {
    sink?.(event, payload);
  } catch (err) {
    console.warn(`could not deliver ${event}:`, err);
  }
}
