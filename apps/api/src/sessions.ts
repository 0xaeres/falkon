/** What an MCP session is bound to at creation (ADR 0001, P11). */
export interface SessionBinding {
  productId: number;
  principal: string;
  /** `scopeFingerprint` of the effective repo set the session's tools were built with. */
  fingerprint: string;
}

/**
 * The Nest layer's own session registry, consulted before `mcp.ts` sees a session id. Bounded: past `cap`
 * entries the least recently used session is evicted and `onEvict` closes it in `mcp.ts` too.
 */
export class SessionBindings {
  private readonly map = new Map<string, SessionBinding>();
  constructor(
    private readonly onEvict: (id: string, binding: SessionBinding) => Promise<unknown>,
    readonly cap = 1000,
  ) {}

  get size() {
    return this.map.size;
  }
  /** The binding, marked as recently used; undefined for an unknown id. */
  get(id: string) {
    const b = this.map.get(id);
    if (b) this.map.delete(id), this.map.set(id, b);
    return b;
  }
  add(id: string, binding: SessionBinding) {
    this.map.set(id, binding);
    for (const [oldest, b] of this.map) {
      if (this.map.size <= this.cap) break;
      this.map.delete(oldest);
      void this.onEvict(oldest, b).catch(() => undefined);
    }
  }
  delete(id: string) {
    this.map.delete(id);
  }
}
