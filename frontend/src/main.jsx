import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Suppress errors from browser extensions (password managers, ad blockers, etc.)
// that don't affect app functionality
const originalConsoleError = console.error;
console.error = function(...args) {
  const msg = args[0]?.toString?.() || '';
  // Filter out extension-related errors that don't affect the app
  if (msg.includes('tabs:outgoing.message.ready') || 
      msg.includes('No Listener:')) {
    return; // Suppress this error
  }
  originalConsoleError.apply(console, args);
};

// Also handle unhandled promise rejections from extensions
window.addEventListener('unhandledrejection', (event) => {
  const msg = event.reason?.toString?.() || '';
  if (msg.includes('tabs:outgoing.message.ready') || 
      msg.includes('No Listener:')) {
    event.preventDefault(); // Prevent error from showing in console
  }
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
