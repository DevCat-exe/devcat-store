/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: '#2f8172',
        'background-light': '#f7f8f6',
        'background-dark': '#202b28',
        'card-dark': '#ffffff',
        'surface-dark': '#eef3ef',
        'border-dark': '#dfe7e2'
      },
      fontFamily: {
        display: ['Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace']
      },
      borderRadius: {
        DEFAULT: '0.25rem',
        lg: '0.5rem',
        xl: '0.75rem',
        full: '9999px'
      }
    },
  },
  plugins: [],
}