// Small HTTP helpers shared by every function.

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

/** Map any thrown value to a response; HttpError keeps its status, everything else is a 500 without details. */
export function errorResponse(err: unknown, headers: HeadersInit = {}): Response {
  if (err instanceof HttpError) return json({ error: err.message }, err.status, headers);
  return json({ error: 'internal error' }, 500, headers);
}
