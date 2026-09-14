import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
    env: {
      PRODUCT_ID: 'test-item',
      PRODUCT_NAME: 'Test Item',
      SALE_TOTAL_STOCK: '5',
      REDIS_URL: 'redis://127.0.0.1:6379',
    },
  },
});
