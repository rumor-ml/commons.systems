/**
 * Tailwind CSS Preset
 * For hybrid apps that want to use Tailwind alongside our design system
 *
 * Note: All colors use CSS variables for automatic theme switching.
 * The CSS variables are defined in the design system's theme files.
 */

export default {
  darkMode: 'media',
  theme: {
    screens: {
      'sm': '375px',
      'md': '768px',
      'lg': '1024px',
      'xl': '1440px',
    },
    extend: {
      colors: {
        // Backgrounds - use CSS variables for theme switching
        'bg-void': 'var(--color-bg-void)',
        'bg-base': 'var(--color-bg-base)',
        'bg-surface': 'var(--color-bg-surface)',
        'bg-elevated': 'var(--color-bg-elevated)',
        'bg-hover': 'var(--color-bg-hover)',
        'bg-active': 'var(--color-bg-active)',

        // Text - use CSS variables for theme switching
        'text-primary': 'var(--color-text-primary)',
        'text-secondary': 'var(--color-text-secondary)',
        'text-tertiary': 'var(--color-text-tertiary)',

        // Primary - Electric Cyan
        primary: {
          DEFAULT: 'var(--color-primary)',
          hover: 'var(--color-primary-hover)',
          active: 'var(--color-primary-active)',
          muted: 'var(--color-primary-muted)',
        },

        // Secondary - Soft Violet
        secondary: {
          DEFAULT: 'var(--color-secondary)',
          hover: 'var(--color-secondary-hover)',
          active: 'var(--color-secondary-active)',
          muted: 'var(--color-secondary-muted)',
        },

        // Tertiary - Amber
        tertiary: {
          DEFAULT: 'var(--color-tertiary)',
          hover: 'var(--color-tertiary-hover)',
          active: 'var(--color-tertiary-active)',
          muted: 'var(--color-tertiary-muted)',
        },

        // Semantic
        success: {
          DEFAULT: 'var(--color-success)',
          hover: 'var(--color-success-hover)',
          muted: 'var(--color-success-muted)',
        },
        warning: {
          DEFAULT: 'var(--color-warning)',
          hover: 'var(--color-warning-hover)',
          muted: 'var(--color-warning-muted)',
        },
        error: {
          DEFAULT: 'var(--color-error)',
          hover: 'var(--color-error-hover)',
          muted: 'var(--color-error-muted)',
        },
      },

      fontFamily: {
        sans: ['Geist', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['Geist Mono', 'SF Mono', 'Monaco', 'Cascadia Code', 'Roboto Mono', 'Consolas', 'monospace'],
      },

      fontSize: {
        xs: ['0.75rem', { lineHeight: '1.5' }],
        sm: ['0.875rem', { lineHeight: '1.5' }],
        base: ['1rem', { lineHeight: '1.5' }],
        md: ['1.125rem', { lineHeight: '1.5' }],
        lg: ['1.25rem', { lineHeight: '1.375' }],
        xl: ['1.5rem', { lineHeight: '1.375' }],
        '2xl': ['2rem', { lineHeight: '1.25' }],
        '3xl': ['2.5rem', { lineHeight: '1.25' }],
        '4xl': ['3rem', { lineHeight: '1.25' }],
      },

      spacing: {
        0: '0',
        0.5: '0.125rem',
        1: '0.25rem',
        2: '0.5rem',
        3: '0.75rem',
        4: '1rem',
        5: '1.25rem',
        6: '1.5rem',
        8: '2rem',
        10: '2.5rem',
        12: '3rem',
        16: '4rem',
        20: '5rem',
        24: '6rem',
        32: '8rem',
      },

      borderRadius: {
        none: '0',
        sm: '0.25rem',
        DEFAULT: '0.375rem',
        md: '0.375rem',
        lg: '0.5rem',
        xl: '0.75rem',
        '2xl': '1rem',
        '3xl': '1.5rem',
        full: '9999px',
      },

      boxShadow: {
        xs: '0 1px 2px 0 rgba(0, 0, 0, 0.3)',
        sm: '0 1px 3px 0 rgba(0, 0, 0, 0.4), 0 1px 2px -1px rgba(0, 0, 0, 0.3)',
        DEFAULT: '0 4px 6px -1px rgba(0, 0, 0, 0.4), 0 2px 4px -2px rgba(0, 0, 0, 0.3)',
        md: '0 4px 6px -1px rgba(0, 0, 0, 0.4), 0 2px 4px -2px rgba(0, 0, 0, 0.3)',
        lg: '0 10px 15px -3px rgba(0, 0, 0, 0.4), 0 4px 6px -4px rgba(0, 0, 0, 0.3)',
        xl: '0 20px 25px -5px rgba(0, 0, 0, 0.4), 0 8px 10px -6px rgba(0, 0, 0, 0.3)',
        '2xl': '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
        inner: 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.3)',
        // Primary glow effects - use CSS variables for theme switching
        glow: 'var(--shadow-glow)',
        'glow-subtle': 'var(--shadow-glow-subtle)',
        'glow-sm': 'var(--shadow-glow-sm)',
        'glow-md': 'var(--shadow-glow-md)',
        'glow-intense': 'var(--shadow-glow-intense)',
      },

      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
        'out-back': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },

      transitionDuration: {
        fast: '100ms',
        DEFAULT: '200ms',
        normal: '200ms',
        slow: '300ms',
        slower: '500ms',
      },

      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'slide-up': {
          from: { transform: 'translateY(1rem)', opacity: '0' },
          to: { transform: 'translateY(0)', opacity: '1' },
        },
        'spinner-rotate': {
          to: { transform: 'rotate(360deg)' },
        },
        'pulse-glow': {
          '0%, 100%': { boxShadow: '0 0 20px var(--color-primary-glow)' },
          '50%': { boxShadow: '0 0 30px var(--color-primary-glow-intense)' },
        },
      },

      animation: {
        'fade-in': 'fade-in 200ms cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-up': 'slide-up 300ms cubic-bezier(0.16, 1, 0.3, 1)',
        'spin': 'spinner-rotate 500ms linear infinite',
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
