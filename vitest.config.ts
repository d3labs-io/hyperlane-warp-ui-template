import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import { coverageConfigDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  assetsInclude: ['**/*.yaml'],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.js'],
    coverage: {
      exclude: [
        ...coverageConfigDefaults.exclude,
        'next.config.js',
        'src/mocks/**',
        'src/test/**',
        'src/**/*.d.ts',
      ],
    },
  },
});
