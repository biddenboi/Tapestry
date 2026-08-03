import { mergeConfig } from 'vite';
import baseConfig from './vite.config.js';

export default mergeConfig(baseConfig, {
  define: {
    'import.meta.env.DEV': 'true',
  },
});
