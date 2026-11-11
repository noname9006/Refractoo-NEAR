import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { initTheme } from './utils/theme.js';
import './styles.css';

// Mirror saved display prefs (theme/density/texture/logo) onto <html> before
// the first paint so there's no flash of the wrong theme.
initTheme();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
