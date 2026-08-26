/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/renderer/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'sans-serif',
        ],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      colors: {
        theme: {
          primary: 'var(--bg-primary)',
          secondary: 'var(--bg-secondary)',
          tertiary: 'var(--bg-tertiary)',
        },
        accent: {
          primary: 'var(--accent-primary)',
          secondary: 'var(--accent-secondary)',
        },
        hud: {
          void: 'var(--hud-void)',
          base: 'var(--hud-base)',
          panel: 'var(--hud-panel)',
          line: 'var(--hud-line)',
          lineMuted: 'var(--hud-line-muted)',
          cyan: 'rgb(var(--hud-cyan-rgb) / <alpha-value>)',
          'cyan-dim': 'var(--hud-cyan-dim)',
          magenta: 'rgb(var(--hud-magenta-rgb) / <alpha-value>)',
          'magenta-dim': 'var(--hud-magenta-dim)',
          glow: 'rgb(var(--hud-glow-rgb) / <alpha-value>)',
        },
        ui: {
          primary: 'var(--ui-primary)',
          secondary: 'var(--ui-secondary)',
          muted: 'var(--ui-muted)',
          subtle: 'var(--ui-subtle)',
        },
        surface: {
          overlay: 'var(--surface-overlay)',
          wash: 'var(--surface-wash)',
          inset: 'var(--surface-inset)',
          pill: 'var(--surface-pill)',
        },
        backdrop: {
          overlay: 'var(--backdrop-overlay)',
        },
        dark: {
          50: '#f5f5f5',
          100: '#e5e5e5',
          200: '#d4d4d4',
          300: '#a3a3a3',
          400: '#737373',
          500: '#525252',
          600: '#404040',
          700: '#2a2a2a',
          800: '#1a1a1a',
          900: '#0a0a0a',
          950: '#050505',
        },
      },
      boxShadow: {
        hud: 'var(--shadow-hud)',
        'hud-magenta': 'var(--shadow-hud-magenta)',
        'hud-inner': 'var(--shadow-hud-inner)',
        scale: 'var(--shadow-scale-active)',
      },
      backgroundImage: {
        'grid-hud': 'var(--bg-grid)',
        'mesh-radial': 'var(--bg-mesh)',
      },
      animation: {
        'fade-in': 'fadeIn 0.35s ease-out',
        'pulse-hud': 'pulseHud 2.8s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        pulseHud: {
          '0%, 100%': { opacity: '0.55' },
          '50%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};
