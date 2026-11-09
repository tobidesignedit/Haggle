import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'copy-studio-assets',
        buildStart() {
          try {
            const srcImages = path.resolve(__dirname, 'src/assets/images');
            const pubImages = path.resolve(__dirname, 'public/src/assets/images');
            if (fs.existsSync(srcImages)) {
              fs.mkdirSync(pubImages, { recursive: true });
              fs.cpSync(srcImages, pubImages, { recursive: true });
            }
          } catch {
            // Ignored
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
