import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { installSessionStore } from './store/session';
import './styles.css';

// restore the last session (if any) before the first render
installSessionStore();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
