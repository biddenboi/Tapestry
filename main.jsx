import { markStartup, registerStaticModule } from '@shared/performance/startupPerf.js';
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@shared/styles/index.css'
import App from '@app/App.jsx'

import { HashRouter } from 'react-router-dom';

registerStaticModule('main');
markStartup('main-evaluated');

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>
)
