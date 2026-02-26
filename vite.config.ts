import { defineConfig } from 'vite';
import glsl from 'vite-plugin-glsl';

export default defineConfig({
  base: '/map/',
  plugins: [glsl()],
  server: {
    port: 3000,
    open: true,
  },
});
