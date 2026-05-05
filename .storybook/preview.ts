import type { Preview } from '@storybook/react-vite';
// Import the shared design token stylesheet so all stories render with the
// real CSS custom properties (--color-brand, etc.) and Tailwind classes.
import '../src/renderer/styles/globals.css';

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      test: 'todo',
    },
    layout: 'centered',
  },
};

export default preview;
