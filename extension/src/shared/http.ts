/**
 * The router rejects an unauthenticated `authReq` with **400**, not 401 — its
 * body reads `{"error":"[Router] 'factQuick' requires authentication"}`.
 *
 * Keying only on 401 meant the signed-out block NEVER fired: a reader with no
 * session saw "Failed · HTTP 400 [Router]…" instead of a sign-in button. Found
 * in the prod error log, not in testing.
 */
export function isAuthRejection(status: number, body: string): boolean {
  if (status === 401) return true;
  return status === 400 && /requires authentication/i.test(body);
}
