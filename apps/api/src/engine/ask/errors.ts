export class AskError extends Error {
  constructor(
    readonly statusCode: number,
    readonly errorCode: string,
    message: string,
    /** Seconds the caller should wait, sent as the `retry-after` header. */
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}
