import { HttpError } from '../_shared/http.ts';

/** An HttpError that also carries a JSON body (`reason` and friends) and response headers. */
export class ApiError extends HttpError {
  readonly body: Record<string, unknown>;
  readonly headers: Record<string, string>;
  constructor(
    status: number,
    message: string,
    body: Record<string, unknown> = {},
    headers: Record<string, string> = {},
  ) {
    super(status, message);
    this.body = body;
    this.headers = headers;
  }
}

/** The browser reads `reason` on a 404 to tell a lost session from a lost claim. */
export const sessionNotFound = () => new ApiError(404, 'Session not found.', { reason: 'not_found' });

/** Maps an error from a SQL function call by SQLSTATE; anything else is an internal error. */
export function sqlError(error: { code?: string; message?: string }): ApiError | Error {
  switch (error.code) {
    case '22023':
      return new ApiError(400, 'Invalid request.', { reason: 'bad_request' });
    case '55000':
      return new ApiError(503, 'Credits are temporarily unavailable.', { reason: 'credits_paused' });
    case '23503':
      return sessionNotFound();
    default:
      // Only the code is kept: a database message could carry row content.
      return new Error(`sql error ${error.code ?? 'unknown'}`);
  }
}
