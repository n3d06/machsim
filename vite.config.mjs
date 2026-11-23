import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' để chạy được dưới /<repo>/ của GitHub Pages
export default defineConfig({ base: './', plugins: [react()] });
