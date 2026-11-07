import { Controller, Get, HttpException, Inject, Param, Req, Res } from "@nestjs/common";
import type { IncomingMessage, ServerResponse } from "node:http";
import { productEventSchemas, type ProductEventName } from "@falkon/contracts";
import type { Signals } from "@falkon/shared";
import { error } from "./request";
import { isProductName } from "./product";
import type { ThreadService } from "./threads";
import type { UiProductService } from "./ui";

/** Where a stream writes; a ServerResponse fits. */
export type Sink = { write(chunk: string): unknown; end(): unknown; writableLength?: number };
/** A stream whose unsent output passes this is stalled; it is dropped instead of buffering without bound. */
const MAX_BUFFERED = 256 * 1024;
type State = { [K in ProductEventName]: string }; // the JSON last sent per event
type Watcher = { sink: Sink; sent: Partial<State> };

const frame = (name: ProductEventName, json: string) => `event: ${name}\ndata: ${json}\n\n`;
const gone = (e: unknown) => e instanceof HttpException && e.getStatus() === 404;

/**
 * Product event streams (cycle 18, D153, D154, D160, D161). Streams are kept per Product; the service subscribes to the change
 * signal only while a stream is open. On a signal it recomputes the status and thread list of Products with an open stream,
 * at most once per `windowMs` (the first signal at once, signals during the window together after it), and a stream is sent an
 * event only when its data differs from what it was last sent. Reads are the bounded ones `status` and `list` already do.
 */
export class ProductEvents {
  private readonly watchers = new Map<string, Set<Watcher>>();
  private unsubscribe?: () => void;
  private keepalive?: ReturnType<typeof setInterval>;
  private busy = false;
  private dirty = false;

  constructor(
    private readonly ui: Pick<UiProductService, "status">,
    private readonly threads: Pick<ThreadService, "list">,
    private readonly signals: Signals,
    private readonly windowMs = 500,
    private readonly keepaliveMs = 25_000,
  ) {}

  private async read(slug: string): Promise<State> {
    const [status, threads] = await Promise.all([this.ui.status(slug), this.threads.list(slug)]);
    return { status: JSON.stringify(productEventSchemas.status.parse(status)), threads: JSON.stringify(productEventSchemas.threads.parse(threads)) };
  }

  /** Reads the current state (404 for an unknown Product, before `begin` runs), calls `begin` to start the response, sends the state and registers the stream. Returns the close function. */
  async open(slug: string, sink: Sink, begin: () => void): Promise<() => void> {
    const state = await this.read(slug);
    begin();
    const w: Watcher = { sink, sent: state };
    const set = this.watchers.get(slug) ?? new Set();
    set.add(w);
    this.watchers.set(slug, set);
    this.unsubscribe ??= this.signals.onChanged(() => this.signal());
    this.keepalive ??= setInterval(() => this.each((slug, x) => this.send(slug, x, ": keepalive\n\n")), this.keepaliveMs).unref();
    for (const name of ["status", "threads"] as const) this.send(slug, w, frame(name, state[name]));
    return () => this.remove(slug, w);
  }

  private each(fn: (slug: string, w: Watcher) => void) {
    for (const [slug, set] of this.watchers) for (const w of [...set]) fn(slug, w);
  }

  /** Writes to one stream; a throwing or stalled stream is removed and ended, so one client cannot hurt the others. */
  private send(slug: string, w: Watcher, chunk: string) {
    try {
      const ok = w.sink.write(chunk);
      if (ok !== false || (w.sink.writableLength ?? 0) <= MAX_BUFFERED) return;
    } catch {
      // fall through: drop the stream
    }
    this.remove(slug, w);
    try {
      w.sink.end();
    } catch {
      // already gone
    }
  }

  private remove(slug: string, w: Watcher) {
    const set = this.watchers.get(slug);
    set?.delete(w);
    if (set?.size === 0) this.watchers.delete(slug);
    if (this.watchers.size === 0) {
      this.unsubscribe?.();
      this.unsubscribe = undefined;
      clearInterval(this.keepalive);
      this.keepalive = undefined;
    }
  }

  private signal() {
    this.dirty = true;
    if (!this.busy) void this.flush();
  }

  private async flush() {
    this.busy = true;
    try {
      do {
        this.dirty = false;
        await Promise.all([...this.watchers.keys()].map((slug) => this.refresh(slug)));
        await new Promise((resolve) => setTimeout(resolve, this.windowMs).unref());
      } while (this.dirty && this.watchers.size);
    } finally {
      this.busy = false;
    }
  }

  private async refresh(slug: string) {
    let state: State;
    try {
      state = await this.read(slug);
    } catch (e) {
      // A deleted Product ends its streams; any other failure keeps them open for the next signal.
      if (gone(e)) for (const w of [...(this.watchers.get(slug) ?? [])]) (this.remove(slug, w), w.sink.end());
      return;
    }
    for (const w of [...(this.watchers.get(slug) ?? [])])
      for (const name of ["status", "threads"] as const)
        if (w.sent[name] !== state[name]) (w.sent[name] = state[name], this.send(slug, w, frame(name, state[name])));
  }
}

@Controller("ui/products")
export class ProductEventsController {
  constructor(@Inject(ProductEvents) private readonly events: ProductEvents) {}

  /** The Product's state as server-sent events: `status` and `threads` on connect, then each when it changes. */
  @Get(":slug/events")
  async stream(@Param("slug") slug: string, @Req() req: IncomingMessage, @Res() res: ServerResponse) {
    if (!isProductName(slug)) throw error(404, "NOT_FOUND", "Product not found.");
    let closed = false;
    let close = () => {};
    // The client may leave while the first state is read; the stream is closed as soon as it is registered.
    req.on("close", () => ((closed = true), close()));
    close = await this.events.open(slug, res, () => {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
      res.flushHeaders();
    });
    if (closed) close();
  }
}
