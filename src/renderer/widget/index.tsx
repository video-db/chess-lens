import React from 'react';
import { createRoot } from 'react-dom/client';
import { WidgetApp } from './App';
// Import the shared design token stylesheet so the widget overlay can use
// CSS custom properties (--color-brand, --color-surface-muted, etc.)
// and Tailwind utility classes just like the main app.
import '../styles/globals.css';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <WidgetApp />
    </React.StrictMode>
  );
}
