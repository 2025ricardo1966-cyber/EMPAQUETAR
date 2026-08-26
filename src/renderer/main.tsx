import React from 'react';
import ReactDOM from 'react-dom/client';
import { AppProviders } from './app/providers/AppProviders';
import { AppShell } from './app/AppShell';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppProviders>
      <AppShell />
    </AppProviders>
  </React.StrictMode>
);
