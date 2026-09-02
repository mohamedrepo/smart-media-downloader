import React from 'react';
import { createRoot } from 'react-dom/client';
import OptionsPage from './options-page';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('Options root element missing');
createRoot(container).render(
  <React.StrictMode>
    <OptionsPage />
  </React.StrictMode>,
);
