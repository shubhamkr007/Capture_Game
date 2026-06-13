import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx}', './app/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      boxShadow: {
        board: '0 20px 60px rgba(15, 23, 42, 0.12)',
      },
    },
  },
  plugins: [],
};

export default config;
