import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' makes the build work on GitHub Pages regardless of repo name
export default defineConfig({
  base: './',
  plugins: [react()],
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
});
