import { EventEmitter } from "node:events";
import type { LiveEvent, LiveEventType } from "@outpost/shared";

type LiveEventPayload = Record<string, unknown>;
type LiveEventListener = (event: LiveEvent) => void;

const emitter = new EventEmitter();
emitter.setMaxListeners(0);
const allSpaceEvents = Symbol("all-space-live-events");

let nextEventId = 0;

function toLiveEvent(input: {
  spaceId: string;
  type: LiveEventType;
  payload?: LiveEventPayload;
}): LiveEvent {
  nextEventId += 1;
  return {
    id: nextEventId,
    spaceId: input.spaceId,
    type: input.type,
    createdAt: new Date().toISOString(),
    payload: input.payload ?? {},
  };
}

export function publishLiveEvent(input: {
  spaceId: string;
  type: LiveEventType;
  payload?: LiveEventPayload;
}) {
  const event = toLiveEvent(input);
  emitter.emit(input.spaceId, event);
  emitter.emit(allSpaceEvents, event);
  return event;
}

export function publishGlobalLiveEvent(input: {
  type: LiveEventType;
  payload?: LiveEventPayload;
}) {
  const event = toLiveEvent({ spaceId: "*", type: input.type, payload: input.payload });
  emitter.emit("*", event);
  return event;
}

export function subscribeSpaceLiveEvents(spaceId: string, listener: LiveEventListener) {
  emitter.on(spaceId, listener);
  return () => emitter.off(spaceId, listener);
}

export function subscribeGlobalLiveEvents(listener: LiveEventListener) {
  emitter.on("*", listener);
  return () => emitter.off("*", listener);
}

/**
 * Internal process-wide observation of space-scoped events. This is kept
 * distinct from the public/global `*` stream so space subscriptions and
 * global instance events retain their existing routing semantics.
 */
export function subscribeAllSpaceLiveEvents(listener: LiveEventListener) {
  emitter.on(allSpaceEvents, listener);
  return () => emitter.off(allSpaceEvents, listener);
}
