import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import './styles/app.css';
import './styles/globe.css';
import './styles/native.css';
import App from './App.jsx';
import { isNative } from './lib/platform.js';

// In a desktop browser the app sits in a phone-sized frame (see native.css); phones fill the screen.
if (!isNative()) document.documentElement.classList.add('web');

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
