import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    react(), // JSX, fast refresh (edits appear without losing page state)
    tailwindcss(), // generates only the Tailwind classes we actually use
  ],
  server: {
    // The backend's CORS rule and Google/Slack redirects expect exactly this port,
    // so fail loudly instead of silently moving to 5174 if it's taken.
    port: 5173,
    strictPort: true,
  },
});
