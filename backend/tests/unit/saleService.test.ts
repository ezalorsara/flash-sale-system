import { describe, expect, it } from 'vitest';
import { deriveSaleStatus } from '../../src/services/saleService.js';
import type { SaleConfig } from '../../src/types.js';

const config: SaleConfig = {
  productId: 'unit-item',
  productName: 'Unit Item',
  totalStock: 10,
  startAt: new Date('2026-01-01T00:00:00Z'),
  endAt: new Date('2026-01-01T01:00:00Z'),
};

describe('deriveSaleStatus', () => {
  it('is upcoming before the start time', () => {
    expect(deriveSaleStatus(config, new Date('2025-12-31T23:59:59Z'))).toBe('upcoming');
  });

  it('is active at the exact start time', () => {
    expect(deriveSaleStatus(config, new Date('2026-01-01T00:00:00Z'))).toBe('active');
  });

  it('is active in the middle of the window', () => {
    expect(deriveSaleStatus(config, new Date('2026-01-01T00:30:00Z'))).toBe('active');
  });

  it('is ended after the end time', () => {
    expect(deriveSaleStatus(config, new Date('2026-01-01T01:00:01Z'))).toBe('ended');
  });
});
