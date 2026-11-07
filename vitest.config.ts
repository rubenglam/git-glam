import { defineConfig } from 'vitest/config'

// Component flow tests only. The framework-free tests in test/*.test.ts run with `node --test`.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['test/components/**/*.test.tsx'],
    setupFiles: ['test/components/setup.ts'],
  },
})
