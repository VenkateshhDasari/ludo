/** @type {import('tailwindcss').Config} */
// -------------------------------------------------------------------------
// Design tokens. Keeping color/radius/shadow names semantic (not hex)
// so the rest of the app reads as a design system, not ad-hoc classes.
// -------------------------------------------------------------------------
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Fredoka', 'system-ui', 'sans-serif'],
        sans: ['Bricolage Grotesque', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Ludo pieces — bright, classic mobile-game palette.
        ludo: {
          red: '#E53935',
          'red-dark': '#AD1F1A',
          green: '#43A047',
          'green-dark': '#2E7D32',
          yellow: '#FDD835',
          'yellow-dark': '#C8A714',
          blue: '#1E88E5',
          'blue-dark': '#155F9F',
        },
        // App chrome — deep navy "starry night" playroom.
        chrome: {
          950: '#06112B',
          900: '#0A1835',
          800: '#122552',
          700: '#1A3875',
          600: '#2A4FA0',
          500: '#3E67C5',
        },
        board: {
          cell: '#FFFDF6',
          line: '#0F193C',
          ink: '#0F193C',
        },
        gold: {
          400: '#F5C34E',
          500: '#E6A732',
          600: '#C8871C',
        },
      },
      boxShadow: {
        plate: '0 10px 24px -10px rgba(6, 17, 43, 0.6), inset 0 1px 0 rgba(255,255,255,0.4)',
        token: '0 4px 6px -2px rgba(0,0,0,0.45), inset 0 -3px 0 rgba(0,0,0,0.28), inset 0 2px 0 rgba(255,255,255,0.55)',
        dock: 'inset 0 2px 4px rgba(15,25,60,0.25)',
        dice: '0 6px 10px -2px rgba(0,0,0,0.35), inset 0 -4px 0 rgba(15,25,60,0.12), inset 0 2px 0 rgba(255,255,255,0.9)',
      },
      dropShadow: {
        glow: '0 0 12px rgba(245,195,78,0.55)',
      },
      keyframes: {
        pop: {
          '0%': { transform: 'scale(0.9)' },
          '50%': { transform: 'scale(1.08)' },
          '100%': { transform: 'scale(1)' },
        },
        bob: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-3px)' },
        },
        spin6: {
          '0%': { transform: 'rotate(0)' },
          '100%': { transform: 'rotate(360deg)' },
        },
      },
      animation: {
        pop: 'pop 220ms ease-out',
        bob: 'bob 1.4s ease-in-out infinite',
        spin6: 'spin6 500ms ease-out',
      },
    },
  },
  plugins: [],
};
