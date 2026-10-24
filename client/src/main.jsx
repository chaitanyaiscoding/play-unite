import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { PlayerProvider } from './PlayerContext.jsx';
import { NotificationsProvider } from './NotificationsContext.jsx';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <PlayerProvider>
        <NotificationsProvider>
          <App />
        </NotificationsProvider>
      </PlayerProvider>
    </BrowserRouter>
  </React.StrictMode>
);
