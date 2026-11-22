/** @type {import('tailwindcss').Config} */
// Tailwind is kept for existing screens. New Market ledger values are added as extra keys that read the
// CSS tokens in src/styles/tokens.css; Tailwind's default scales are left untouched so existing utility
// classes render exactly as before. `brand` was unused by any screen and now points at the LineCart blue.
const v = (name) => `var(--lc-${name})`;

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: v('brand-50'),
          100: v('brand-100'),
          500: v('brand-logo'),
          600: v('brand-600'),
          700: v('brand-700'),
          800: v('brand-800'),
          900: v('brand-800')
        },
        lc: {
          ink: v('ink'),
          'ink-2': v('ink-2'),
          muted: v('muted'),
          subtle: v('subtle'),
          bg: v('bg'),
          surface: v('surface'),
          'surface-2': v('surface-2'),
          border: v('border'),
          'border-strong': v('border-strong'),
          success: v('success'),
          'success-bg': v('success-bg'),
          warning: v('warning'),
          'warning-bg': v('warning-bg'),
          danger: v('danger'),
          'danger-bg': v('danger-bg'),
          info: v('info'),
          'info-bg': v('info-bg')
        }
      },
      fontFamily: {
        'lc-body': ['Inter', 'system-ui', 'Segoe UI', 'Roboto', 'Noto Sans Tamil', 'sans-serif'],
        'lc-head': ['Manrope', 'Inter', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
        'lc-tamil': ['Noto Sans Tamil', 'Nirmala UI', 'Latha', 'sans-serif']
      },
      borderRadius: {
        'lc-sm': v('radius-sm'),
        'lc-md': v('radius-md'),
        'lc-lg': v('radius-lg'),
        'lc-xl': v('radius-xl')
      },
      boxShadow: {
        'lc-1': v('shadow-1'),
        'lc-2': v('shadow-2'),
        'lc-3': v('shadow-3')
      }
    },
  },
  plugins: [],
}
