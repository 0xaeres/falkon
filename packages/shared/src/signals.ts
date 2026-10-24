// The change and request signals (cycle 18, D155/D156/D160): bare pings on Redis pub/sub, no payload.
// `changed`: something a status or thread list shows may differ. `request`: a row the worker claims was written.
// Publishing is best effort and never throws; the durable record is always the database row, and the worker's tick is the fallback.
import { EventEmitter } from "node:events";
import { Redis } from "ioredis";
import { env } from "./env";

export type Signals = {
  changed(): void;
  request(): void;
  /** Returns the unsubscribe function. */
  onChanged(cb: () => void): () => void;
  onRequest(cb: () => void): () => void;
  close(): void;
};

const CHANNELS = { changed: "falkon:changed", request: "falkon:request" } as const;
type Channel = (typeof CHANNELS)[keyof typeof CHANNELS];

/** In-process signals: the default for services built without Redis and the fake for tests. */
export function memorySignals(): Signals {
  const bus = new EventEmitter();
  const publish = (c: Channel) => {
    for (const cb of bus.listeners(c)) {
      try {
        cb();
      } catch {
        // a subscriber's failure is not the publisher's
      }
    }
  };
  const listen = (c: Channel, cb: () => void) => {
    bus.on(c, cb);
    return () => void bus.off(c, cb);
  };
  return {
    changed: () => publish(CHANNELS.changed),
    request: () => publish(CHANNELS.request),
    onChanged: (cb) => listen(CHANNELS.changed, cb),
    onRequest: (cb) => listen(CHANNELS.request, cb),
    close: () => void bus.removeAllListeners(),
  };
}

/**
 * Signals over Redis. ioredis reconnects by itself and resubscribes after a reconnect; the publisher has no offline queue,
 * so a publish while Redis is down is dropped at once instead of piling up. Errors are swallowed: Redis down only costs latency.
 */
export function redisSignals(url: string = env.redisUrl): Signals {
  const quiet = (r: Redis) => r.on("error", () => {});
  const pub = new Redis(url, { enableOfflineQueue: false });
  quiet(pub);
  const local = memorySignals();
  let sub: Redis | undefined;
  const subscribed = new Set<Channel>();
  const listen = (c: Channel, cb: () => void) => {
    if (!sub) {
      // null: a SUBSCRIBE issued while Redis is down waits in the queue and is sent on connect, instead of being flushed after 20 retries
      sub = new Redis(url, { maxRetriesPerRequest: null });
      quiet(sub);
      // `local` fans a received ping out to this process's subscribers
      sub.on("message", (channel: string) => (channel === CHANNELS.changed ? local.changed() : local.request()));
    }
    if (!subscribed.has(c)) {
      subscribed.add(c);
      sub.subscribe(c).catch(() => {});
    }
    return c === CHANNELS.changed ? local.onChanged(cb) : local.onRequest(cb);
  };
  const publish = (c: Channel) => void pub.publish(c, "").catch(() => {});
  return {
    changed: () => publish(CHANNELS.changed),
    request: () => publish(CHANNELS.request),
    onChanged: (cb) => listen(CHANNELS.changed, cb),
    onRequest: (cb) => listen(CHANNELS.request, cb),
    close: () => {
      pub.disconnect();
      sub?.disconnect();
      local.close();
    },
  };
}
