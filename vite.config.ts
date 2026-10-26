import path from 'node:path';
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

const ROOT = import.meta.dirname;
const API = `http://localhost:${process.env.MOOOTION_API_PORT ?? 8787}`;

export default defineConfig({
  root: path.join(ROOT, 'studio'),
  plugins: [react()],
  define: {__MOOOTION_ROOT__: JSON.stringify(ROOT.replace(/\\/g, '/'))},
  resolve: {dedupe: ['react', 'react-dom', 'remotion']},
  server: {
    port: 5173,
    fs: {allow: [ROOT]},
    // no red overlay over the whole studio when a project's code is half-written by the agent:
    // the studio keeps the project open and says what is wrong itself (CodeBanner)
    hmr: {overlay: false},
    proxy: {
      '/api': API,
      '/files': API,
      '/library': API,
      '/renders': API,
    },
    watch: {ignored: ['**/project.json', '**/renders/**', '**/out/**', '**/.moootion/**']},
  },
});
