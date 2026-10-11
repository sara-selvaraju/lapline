// Entry point: mount React, then connect the stream. The scene mounts itself
// onto the canvas TrackArea renders.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './style.css';
import { connect, watchVisibility } from './stream/sse.js';

const root = document.getElementById('root');
if (!root) throw new Error('no #root to mount into');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

connect();
watchVisibility();
