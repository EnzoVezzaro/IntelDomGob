import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { version, name } from './package.json';

// Studio is a pure client of the API. It talks to the API gateway ONLY
// (api.localhost / api.intel.dom.gob) via the SDK — never to services/providers.
export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'import.meta.env.APP_NAME': JSON.stringify(name),
      'import.meta.env.APP_VERSION': JSON.stringify(version),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        // The @intel.dom.gob/ui package declares react as a peerDependency and
        // points its "main" at raw TypeScript source. Without deduping, Vite can
        // resolve a second copy of react (or jsx-runtime) for that package, which
        // makes its <Panel>/<Button> elements use a different React instance and
        // crash with "A React Element from an older version of React was rendered".
        react: path.resolve(__dirname, '../../node_modules/react'),
        'react-dom': path.resolve(__dirname, '../../node_modules/react-dom'),
        'react/jsx-runtime': path.resolve(__dirname, '../../node_modules/react/jsx-runtime'),
      },
      dedupe: ['react', 'react-dom', 'react/jsx-runtime'],
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
