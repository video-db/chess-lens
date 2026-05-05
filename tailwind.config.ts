import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: ['./src/renderer/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // ─── Fonts ───────────────────────────────────────────────────────────
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['Geist Mono', 'ui-monospace', 'monospace'],
        'jb-mono': ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },

      // ─── Colors ──────────────────────────────────────────────────────────
      //
      //  These map the CSS custom properties defined in globals.css to
      //  Tailwind utility classes. To use them:
      //
      //    text-brand          → color: var(--color-brand)
      //    bg-surface-muted    → background: var(--color-surface-muted)
      //    border-border-default → border-color: var(--color-border-default)
      //
      //  shadcn/ui tokens (used by the ui/ primitive components) are kept
      //  alongside the new brand tokens.
      //
      colors: {
        // shadcn/ui tokens — do not remove; used by Radix-wrapped ui/ components
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },

        // ── Brand color tokens ──────────────────────────────────────────
        brand: {
          DEFAULT:  'var(--color-brand)',           // text-brand / bg-brand
          hover:    'var(--color-brand-hover)',      // bg-brand-hover
          cta:      'var(--color-brand-cta)',        // bg-brand-cta (main CTA button)
          'cta-hover': 'var(--color-brand-cta-hover)',
          disabled: 'var(--color-brand-disabled)',   // bg-brand-disabled
        },

        // ── Text color tokens ───────────────────────────────────────────
        'text-heading':     'var(--color-text-heading)',
        'text-body':        'var(--color-text-body)',
        'text-muted-brand': 'var(--color-text-muted)',
        'text-faint':       'var(--color-text-faint)',
        'text-heading-alt': 'var(--color-text-heading-alt)',
        'text-label':       'var(--color-text-label)',

        // ── Surface / background tokens ─────────────────────────────────
        surface: {
          page:    'var(--color-surface-page)',
          muted:   'var(--color-surface-muted)',
          overlay: 'var(--color-surface-overlay)',
          hover:   'var(--color-surface-hover)',
        },
        'input-bg': 'var(--color-input-bg)',

        // ── Border tokens ───────────────────────────────────────────────
        'border-default': 'var(--color-border-default)',
        'border-subtle':  'var(--color-border-subtle)',
        'border-input':   'var(--color-border-input)',
        'border-card':    'var(--color-border-card)',

        // ── Sidebar tokens ──────────────────────────────────────────────
        'sidebar-active':      'var(--color-sidebar-active-bg)',
        'sidebar-icon-active': 'var(--color-sidebar-icon-active)',

        // ── Chess / game colors ──────────────────────────────────────────
        'chess-best-move':    'var(--color-chess-best-move)',
        'chess-best-move-bg': 'var(--color-chess-best-move-bg)',
        'chess-win':          'var(--color-chess-win)',
        'chess-loss':         'var(--color-chess-loss)',
        'chess-draw':         'var(--color-chess-draw)',
        'chess-insight':      'var(--color-chess-insight)',

        // ── Result badges ────────────────────────────────────────────────
        'badge-win':  'var(--color-badge-win-bg)',
        'badge-loss': 'var(--color-badge-loss-bg)',
        'badge-draw': 'var(--color-badge-draw-bg)',

        // ── Chat bubbles ─────────────────────────────────────────────────
        'chat-coach':        'var(--color-chat-coach-bg)',
        'chat-coach-border': 'var(--color-chat-coach-border)',
        'chat-user':         'var(--color-chat-user-bg)',
        'chat-user-border':  'var(--color-chat-user-border)',
        'chat-note-border':  'var(--color-chat-note-border)',

        // ── Input states ─────────────────────────────────────────────────
        'input-focus':       'var(--color-input-focus-border)',
        'input-hover':       'var(--color-input-hover-border)',
        'input-error-bg':    'var(--color-input-error-bg)',
        'input-error':       'var(--color-input-error-border)',
        'input-error-text':  'var(--color-input-error-text)',

        // ── Widget ───────────────────────────────────────────────────────
        'widget-header': 'var(--color-widget-header-bg)',
        'widget-stop':   'var(--color-widget-stop-bg)',

        // ── Settings ─────────────────────────────────────────────────────
        'settings-card':    'var(--color-settings-card-border)',
        'settings-heading': 'var(--color-settings-heading)',

        // ── Dropdown ─────────────────────────────────────────────────────
        'dropdown-selected':      'var(--color-dropdown-selected-bg)',
        'dropdown-selected-text': 'var(--color-dropdown-selected-text)',

        // ── Status tokens ───────────────────────────────────────────────
        danger: {
          DEFAULT: 'var(--color-status-danger)',
          hover:   'var(--color-status-danger-hover)',
        },
        'status-error':     'var(--color-status-error)',
        'status-error-alt': 'var(--color-status-error-alt)',

        // ── Warm tint tokens (permission item active states) ────────────
        'warm-tint':        'var(--color-warm-tint-bg)',
        'warm-tint-border': 'var(--color-warm-tint-border)',

        // ── Progress tokens ─────────────────────────────────────────────
        'progress-track': 'var(--color-progress-track)',
        'progress-alt':   'var(--color-progress-alt)',
      },

      // ─── Border Radius ───────────────────────────────────────────────────
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },

      // ─── Type Scale ──────────────────────────────────────────────────────
      //
      //  Semantic type sizes extracted from the pervasive arbitrary Tailwind
      //  values (text-[11px], text-[12px], text-[13px], text-[14px], etc.).
      //  When the Figma design changes type sizes, update here — all
      //  components using these names will update automatically.
      //
      fontSize: {
        //  [font-size, { lineHeight, letterSpacing }]
        'xs-label':  ['11px', { lineHeight: '16px', letterSpacing: '0px' }],
        'sm-label':  ['12px', { lineHeight: '18px', letterSpacing: '0px' }],
        'sm':        ['13px', { lineHeight: '19.5px', letterSpacing: '0.26px' }],
        'base':      ['14px', { lineHeight: '21px', letterSpacing: '0.14px' }],
        'base-lg':   ['15px', { lineHeight: '22px', letterSpacing: '0px' }],
        'md':        ['16px', { lineHeight: '22.5px', letterSpacing: '0px' }],
        'lg':        ['18px', { lineHeight: '25.5px', letterSpacing: '-0.17px' }],
        'xl':        ['22px', { lineHeight: '33px', letterSpacing: '-0.44px' }],
        '2xl':       ['24px', { lineHeight: '32px', letterSpacing: '0.12px' }],
        '3xl':       ['28px', { lineHeight: '36px', letterSpacing: '-0.5px' }],
      },

      // ─── Spacing Scale ───────────────────────────────────────────────────
      //
      //  Fills gaps in Tailwind's default scale for the values used pervasively
      //  across the codebase (gap-[10px], gap-[14px], px-[17px], etc.).
      //
      spacing: {
        '2.5':  '10px',
        '3.5':  '14px',
        '4.25': '17px',
        '4.5':  '18px',
        '5.5':  '22px',
        '7.5':  '30px',
        '15':   '60px',
      },

      // ─── Keyframes & Animations ──────────────────────────────────────────
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        pulse: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        pulse: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
