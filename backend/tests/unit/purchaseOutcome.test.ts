import { describe, expect, it } from 'vitest';
import { httpStatusForOutcome } from '../../src/routes/purchase.js';

describe('httpStatusForOutcome', () => {
  it.each([
    ['purchased', 201],
    ['duplicate', 409],
    ['sold_out', 410],
    ['ended', 410],
    ['not_started', 425],
    ['error', 503],
  ] as const)('maps %s to %i', (outcome, status) => {
    expect(httpStatusForOutcome(outcome)).toBe(status);
  });
});
