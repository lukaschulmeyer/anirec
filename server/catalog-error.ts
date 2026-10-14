/** Public, sanitized provider errors. Never attach credentials or raw upstream responses. */
export class CatalogError extends Error {
  constructor(message: string, public status = 503, public retryAfterSeconds?: number) { super(message); }
}
