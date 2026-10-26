/**
 * A known, user-facing failure: a plain message and an HTTP status. The
 * router answers these as JSON; anything else is logged and becomes a 500.
 */
export class HttpError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
