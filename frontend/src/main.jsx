import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { AppProvider } from './context/AppContext.jsx';
import './index.css';
import { applyPrefs, readPrefs } from './lib/displayPrefs';

// Apply the saved display settings before the first paint (no flash of the default size).
applyPrefs(readPrefs());

// StrictMode is omitted: its development double-mount would fire every one-time request
// (draft creation, token unlocks, audit-logged views) twice.
ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <AuthProvider>
      <AppProvider>
        <App />
      </AppProvider>
    </AuthProvider>
  </BrowserRouter>
);
