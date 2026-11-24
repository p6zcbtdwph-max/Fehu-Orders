/** @type {import('tailwindcss').Config} */
// Farben, Schriftstufen, Radien, Schatten und Höhen kommen aus Fehu Design
// (src/renderer/src/assets/fehu/). Hier stehen nur Ergänzungen für Orders.
const fehu = require('./src/renderer/src/assets/fehu/fehu-tailwind-preset.cjs')
const v = (n) => `rgb(var(--fd-rgb-${n}) / <alpha-value>)`

// Breite von <main> (bzw. vom Fenster bei Dialogen), ab der eine Stufe gilt.
// Bei 1024 px Fenster ohne KI-Panel sind lg an, xl aus; mit KI-Panel nur sm und md.
const CONTAINER_BREAKPOINTS = { sm: '36rem', md: '44rem', lg: '56rem', xl: '72rem' }

module.exports = {
  presets: [fehu],
  darkMode: 'class',
  content: ['./src/renderer/src/**/*.{js,ts,jsx,tsx}', './src/renderer/index.html'],
  theme: {
    extend: {
      // Übergang: ältere Rollennamen aus dem Lifemanager zeigen auf die Fehu-Rollen
      colors: {
        ink: { 2: v('ink'), subtle: v('ink-muted') },
        sunken: { DEFAULT: v('sunken'), soft: v('sunken') },
        track: v('line-strong'),
        line: { soft: v('line'), control: v('line-strong') }
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
