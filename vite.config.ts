import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, process.cwd(), '');
  
  // Get the API key from the loaded environment variables
  const apiKey = env.API_KEY || '';

  return {
    plugins: [react()],
    build: {
      outDir: 'dist',
      target: 'esnext',
      minify: 'esbuild',
    },
    define: {
      // Safely replace ONLY the API_KEY access, preserving other process.env properties like NODE_ENV
      'process.env.API_KEY': JSON.stringify(apiKey)
    }
  };
});