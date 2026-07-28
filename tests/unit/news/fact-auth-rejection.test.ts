import { describe, expect, it } from 'vitest';
import { isAuthRejection } from '../../../extension/src/shared/http';

// Found in prod: the popup showed "Failed · HTTP 400 [Router] 'factQuick'
// requires authentication" instead of a sign-in button, because the handlers
// only recognised 401. The framework's router answers 400.
describe('isAuthRejection', () => {
  it('recognises the router 400 that actually happens', () => {
    expect(
      isAuthRejection(
        400,
        `{"error":"[Router] 'factQuick' requires authentication"}`,
      ),
    ).toBe(true);
  });

  it('still recognises a plain 401', () => {
    expect(isAuthRejection(401, '')).toBe(true);
  });

  it('does NOT swallow an unrelated 400', () => {
    // An unregistered route is a deploy bug, not a sign-in prompt — showing the
    // user a login button for it would send them somewhere useless.
    expect(
      isAuthRejection(
        400,
        `{"error":"[Router] 'factQuick' is not registered"}`,
      ),
    ).toBe(false);
  });

  it('does not treat a validation 400 as signed-out', () => {
    expect(isAuthRejection(400, '{"error":"invalid input"}')).toBe(false);
  });

  it('leaves 402 and 500 alone', () => {
    expect(isAuthRejection(402, 'Insufficient balance')).toBe(false);
    expect(isAuthRejection(500, 'requires authentication')).toBe(false);
  });
});
