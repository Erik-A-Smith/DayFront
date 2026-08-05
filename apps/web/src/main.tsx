import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import './styles.css';
import './visual-refresh.css';

const root = document.querySelector('#root');

if (!root) throw new Error('DayFront root element was not found.');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
