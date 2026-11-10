/** @type {import('tailwindcss').Config} */
const colors = require('tailwindcss/colors')

// Fehu-Gold aus dem Logo (#e5bf78 = 300). 600 ist die erste Stufe mit
// ausreichend Kontrast für weiße Schrift (4,6:1).
const fehu = {
  50: '#fbf7ee',
  100: '#f6ecd4',
  200: '#eedaa9',
  300: '#e5bf78',
  400: '#d8a754',
  500: '#c28d36',
  600: '#9a6c24',
  700: '#7e5620',
  800: '#67461e',
  900: '#563b1c',
  950: '#30200e'
}

// Farbrollen mit eingebautem Dunkelmodus (v1.64): text-success-fg, bg-success-soft,
// border-success-edge statt „text-success-700 dark:text-success-400“.
const role = (name, scale) => ({
  ...scale,
  fg: `rgb(var(--${name}-fg) / <alpha-value>)`,
  soft: `rgb(var(--${name}-soft) / <alpha-value>)`,
  edge: `rgb(var(--${name}-edge) / <alpha-value>)`
})

// Farbrollen: Seiten verwenden accent/success/warning/danger/info statt
// konkreter Farbtöne. Ein Markenwechsel passiert dann nur hier.
// Breite von <main> (bzw. vom Fenster bei Dialogen), ab der eine Stufe gilt.
// Bei 1024 px Fenster ohne KI-Panel sind lg an, xl aus; mit KI-Panel nur sm und md.
const CONTAINER_BREAKPOINTS = { sm: '36rem', md: '44rem', lg: '56rem', xl: '72rem' }

module.exports = {
  darkMode: 'class',
  content: ['./src/renderer/src/**/*.{js,ts,jsx,tsx}', './src/renderer/index.html'],
  theme: {
    extend: {
      // Eine Bewegung (v1.63): fast für Hover/Farben, DEFAULT für Auf-/Zuklappen,
      // slow nur für wachsende Balken und Ringe.
      transitionDuration: { fast: '120ms', DEFAULT: '200ms', slow: '300ms' },
      transitionTimingFunction: { DEFAULT: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)' },
      // Feste Typo-Skala. Die Basisschrift ist fluide (13,5–16 px), deshalb
      // bekommen die kleinen Stufen eine Untergrenze: nie unter 12 px.
      fontSize: {
        xs: ['max(12px, 0.75rem)', { lineHeight: '1.35' }],
        sm: ['max(13px, 0.875rem)', { lineHeight: '1.45' }]
      },
      colors: {
        accent: role('accent', fehu),
        success: role('success', colors.emerald),
        // Warnung in Orange, damit sie sich vom goldenen Akzent abhebt
        warning: role('warning', colors.orange),
        danger: role('danger', colors.rose),
        info: role('info', colors.sky),
        // Neutrale Rollen (Werte in assets/index.css, hell und dunkel).
        // Statt „text-gray-500 dark:text-slate-400“ einfach „text-ink-muted“.
        ink: {
          DEFAULT: 'rgb(var(--ink) / <alpha-value>)',
          2: 'rgb(var(--ink-2) / <alpha-value>)',
          muted: 'rgb(var(--ink-muted) / <alpha-value>)',
          subtle: 'rgb(var(--ink-subtle) / <alpha-value>)',
          faint: 'rgb(var(--ink-faint) / <alpha-value>)'
        },
        // App-Hintergrund hinter allen Karten (hell gray-50, dunkel slate-950)
        canvas: 'rgb(var(--canvas) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        sunken: {
          DEFAULT: 'rgb(var(--sunken) / <alpha-value>)',
          soft: 'rgb(var(--sunken-soft) / <alpha-value>)'
        },
        track: 'rgb(var(--track) / <alpha-value>)',
        line: {
          DEFAULT: 'rgb(var(--line) / <alpha-value>)',
          soft: 'rgb(var(--line-soft) / <alpha-value>)',
          strong: 'rgb(var(--line-strong) / <alpha-value>)',
          // Rand von Eingabe- und Auswahlflächen: hell wie line, dunkel wie line-strong
          control: 'rgb(var(--line-control) / <alpha-value>)'
        }
      }
    }
  },
  plugins: [
    // Container-Breakpoints (v1.72): Spalten richten sich nach der Breite des
    // Inhaltsbereichs (<main>), nicht nach dem Fenster. So bleibt das Layout
    // stabil, wenn Seitenleiste oder KI-Panel Platz wegnehmen. Werte in rem,
    // damit größere Schrift (Einstellung „Schriftgröße“) früher umbricht.
    // Gebrauch: @md:grid-cols-2, @lg:flex-row, @max-lg:fixed. Regeln: docs/design-regeln.md
    function containerBreakpoints({ addVariant }) {
      for (const [name, size] of Object.entries(CONTAINER_BREAKPOINTS)) {
        addVariant(`@${name}`, `@container (min-width: ${size})`)
        addVariant(`@max-${name}`, `@container not (min-width: ${size})`)
      }
    }
  ]
}
