// Answers being written (S21), kept apart from the request that started them: the turn runs to its end whoever is
// reading, a client that lost its connection reads it again from the first chunk, and only an explicit Stop ends it early.
// In memory: the turn runs in this process, so a buffer here lives exactly as long as the turn can.

type Live = {
  chunks: Uint8Array[];
  done: boolean;
  wake: Set<() => void>;
  stop: AbortController;
  headers?: Headers;
  ready: Promise<void>;
};

export class LiveAnswers {
  private readonly live = new Map<string, Live>();

  /**
   * Starts a turn on `id`: `make` gets the turn's stop signal and returns its response, whose body is drained into a
   * buffer here until it ends (the turn's onFinish included); resolves to a reader of it. Undefined while a turn runs on `id`.
   */
  async start(
    id: string,
    make: (stop: AbortSignal) => Promise<Response>,
  ): Promise<Response | undefined> {
    if (this.live.has(id)) return undefined;
    const stop = new AbortController();
    const entry: Live = {
      chunks: [],
      done: false,
      wake: new Set(),
      stop,
      ready: Promise.resolve(),
    };
    this.live.set(id, entry);
    let response: Response;
    try {
      const pending = make(stop.signal);
      // A resume that arrives while the turn is still starting waits for its headers rather than seeing "nothing running".
      entry.ready = pending.then(
        () => undefined,
        () => undefined,
      );
      response = await pending;
    } catch (e) {
      this.live.delete(id);
      throw e;
    }
    entry.headers = response.headers;
    void this.drain(id, entry, response.body!);
    return this.read(id);
  }

  /** The running turn on `id` from its first chunk, or undefined when none runs. */
  async read(id: string): Promise<Response | undefined> {
    const entry = this.live.get(id);
    await entry?.ready;
    if (!entry?.headers) return undefined;
    let next = 0;
    let waiting: (() => void) | undefined;
    const body = new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        while (next >= entry.chunks.length && !entry.done)
          await new Promise<void>((r) => entry.wake.add((waiting = r)));
        if (next < entry.chunks.length)
          controller.enqueue(entry.chunks[next++]!);
        else controller.close();
      },
      cancel: () => void (waiting && entry.wake.delete(waiting)),
    });
    return new Response(body, { headers: entry.headers });
  }

  /** Stops the running turn on `id`, if any. */
  stop(id: string): void {
    this.live.get(id)?.stop.abort();
  }

  private async drain(
    id: string,
    entry: Live,
    body: ReadableStream<Uint8Array>,
  ) {
    const reader = body.getReader();
    try {
      for (let r = await reader.read(); !r.done; r = await reader.read()) {
        entry.chunks.push(r.value);
        this.notify(entry);
      }
    } catch (e) {
      console.error("[chat]", e);
    } finally {
      entry.done = true;
      this.notify(entry);
      this.live.delete(id);
    }
  }

  private notify(entry: Live) {
    for (const wake of entry.wake) wake();
    entry.wake.clear();
  }
}
