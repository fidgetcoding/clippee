import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    maxWorkers: 2,
    include: ['tests/**/*.test.ts'],
  },
});
