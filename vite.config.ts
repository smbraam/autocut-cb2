import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/moonraker': {
        target: 'http://127.0.0.1:7125',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/moonraker/, '')
      }
    },
    watch: {
      ignored: ['**/.venv/**', '**/node_modules/**', '**/.git/**']
    }
  }
});
