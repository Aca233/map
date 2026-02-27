import { defineConfig } from 'vite';
import glsl from 'vite-plugin-glsl';
import path from 'node:path';

export default defineConfig({
  plugins: [glsl()],
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/lib/index.ts'),
      name: 'Hoi4Map',
      formats: ['es'],
      fileName: 'index',
    },
    rollupOptions: {
      external: ['three'],
      output: {
        globals: {
          three: 'THREE',
        },
      },
    },
    sourcemap: true,
    outDir: 'dist-lib',
    emptyOutDir: true,
  },
});
