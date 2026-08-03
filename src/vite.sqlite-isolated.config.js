import { mergeConfig } from 'vite';
import baseConfig from './vite.config.js';

const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default mergeConfig(baseConfig, {
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
});
