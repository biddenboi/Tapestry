import { markStartup, registerStaticModule } from '@shared/performance/startupPerf.js';
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@shared/styles/index.css'
import '@shared/styles/themes.css'
import '@shared/styles/traversal.css'
import App from '@app/App.jsx'
import { installDynamicResourceRecovery } from '@shared/runtime/DynamicResourceRecovery.js'
import { registerTapestryServiceWorker } from '@shared/runtime/PwaRuntime.js'


//Note: possibly move BrowserRouter to App.jsx
import { HashRouter } from 'react-router-dom';


registerStaticModule('main');
markStartup('main-evaluated');
installDynamicResourceRecovery();
void registerTapestryServiceWorker();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>
)
