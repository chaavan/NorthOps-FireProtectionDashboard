import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      screens: {
        'sidebar': '1366px',
        'toolbar': '1260px',
      },
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        // Futuristic color palette
        primary: {
          50: '#E8F4FF',
          100: '#C8E4FF',
          200: '#98CEFF',
          300: '#4A90FF',
          400: '#2B7FFF',
          500: '#1E6FE8',
          600: '#1558CC',
          700: '#0D42A0',
          800: '#062D74',
          900: '#031C4D',
        },
        accent: {
          green: {
            light: '#7EFFC5',
            DEFAULT: '#00C48C',
            dark: '#00A67A',
          },
          orange: {
            light: '#FFB199',
            DEFAULT: '#FF5C39',
            dark: '#E64A2E',
          },
          purple: {
            light: '#B8A4FF',
            DEFAULT: '#8B5CF6',
            dark: '#7C3AED',
          },
          pink: {
            light: '#FFB8E6',
            DEFAULT: '#EC4899',
            dark: '#DB2777',
          },
        },
        glass: {
          light: 'rgba(255, 255, 255, 0.7)',
          DEFAULT: 'rgba(255, 255, 255, 0.1)',
          dark: 'rgba(0, 0, 0, 0.1)',
        },
      },
      backgroundImage: {
        'gradient-primary': 'linear-gradient(135deg, #4A90FF 0%, #1E6FE8 100%)',
        'gradient-success': 'linear-gradient(135deg, #00C48C 0%, #00A67A 100%)',
        'gradient-danger': 'linear-gradient(135deg, #FF5C39 0%, #E64A2E 100%)',
        'gradient-purple': 'linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%)',
        'gradient-glass': 'linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.05) 100%)',
      },
      boxShadow: {
        'glass': '0 8px 32px 0 rgba(31, 38, 135, 0.07)',
        'glass-lg': '0 8px 32px 0 rgba(31, 38, 135, 0.15)',
        'neon-blue': '0 0 20px rgba(74, 144, 255, 0.3)',
        'neon-green': '0 0 20px rgba(0, 196, 140, 0.3)',
        'neon-orange': '0 0 20px rgba(255, 92, 57, 0.3)',
      },
      backdropBlur: {
        xs: '2px',
      },
      keyframes: {
        estimateHeroGlow: {
          '0%, 100%': {
            boxShadow:
              '0 0 40px -12px rgba(217, 70, 239, 0.35), inset 0 1px 0 0 rgba(255, 255, 255, 0.06)',
          },
          '50%': {
            boxShadow:
              '0 0 48px -8px rgba(34, 211, 238, 0.25), inset 0 1px 0 0 rgba(255, 255, 255, 0.08)',
          },
        },
        fadeIn: {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'estimate-hero-glow': 'estimateHeroGlow 5s ease-in-out infinite',
        'fade-in': 'fadeIn 220ms ease-out',
      },
    },
  },
  plugins: [],
}
export default config

