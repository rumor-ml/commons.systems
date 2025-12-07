import dsPreset from '@commons/design-system/tailwind/preset';

/** @type {import('tailwindcss').Config} */
export default {
  presets: [dsPreset],
  content: ['./web/templates/**/*.templ', './web/static/js/**/*.{ts,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
};
