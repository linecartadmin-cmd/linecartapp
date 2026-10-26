import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function demoSectionPlugin(isDemo) {
  return {
    name: 'demo-section-plugin',
    enforce: 'pre',
    resolveId(id) {
      if (!isDemo && id.includes('DemoRoleLoginSection')) {
        return '\0empty-demo-section';
      }
    },
    load(id) {
      if (id === '\0empty-demo-section') {
        return 'export default function DummyDemo() { return null; }';
      }
    }
  };
}

export default defineConfig(({ mode }) => {
  const isDemo = mode === 'demo' || mode === 'development';
  return {
    plugins: [
      demoSectionPlugin(isDemo),
      react()
    ],
    define: {
      'import.meta.env.VITE_ENABLE_DEMO_LOGIN': JSON.stringify(isDemo ? 'true' : 'false')
    },
    server: {
      port: 3000
    }
  };
});
