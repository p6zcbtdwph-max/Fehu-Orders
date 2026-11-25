// Wächter für Fehu Design (Regeln: ~/Documents/KI/Fehu Design, 03 Bausteine.md und 04 Texte.md).
// Harte Regeln müssen auf 0 stehen. Die Zahlen in design-budget.json dürfen nur sinken:
// Wer eine Stelle umbaut, senkt die Zahl dort mit.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'
import budget from './design-budget.json'

const ROOT = join(__dirname)
const SKIP = ['assets/fehu/'] // erzeugte Dateien aus Fehu Design

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return files(p)
    return /\.(tsx?|css)$/.test(p) && !p.endsWith('.test.ts') ? [p] : []
  }).filter((p) => !SKIP.some((s) => relative(ROOT, p).startsWith(s)))
}

const all = files(ROOT).map((p) => ({ path: relative(ROOT, p), src: readFileSync(p, 'utf8') }))
// Kommentare zählen nicht mit
const code = all.map((f) => ({ ...f, src: f.src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '') }))

function hits(re: RegExp, only?: (path: string) => boolean): string[] {
  return code.filter((f) => !only || only(f.path)).flatMap((f) => (f.src.match(re) ?? []).map((m) => `${f.path}: ${m}`))
}
const tsx = (p: string) => p.endsWith('.tsx')

// Deutscher Text: erstes Argument von tr('…', '…') oder Text zwischen > und <
function germanTexts(): string[] {
  return code.filter((f) => tsx(f.path)).flatMap((f) => {
    const out: string[] = []
    for (const m of f.src.matchAll(/\btr\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g)) out.push(`${f.path}: ${m[2]}`)
    for (const m of f.src.matchAll(/>([^<>{}]*[A-Za-zÄÖÜäöüß][^<>{}]*)</g)) out.push(`${f.path}: ${m[1].trim()}`)
    return out
  })
}

describe('Fehu Design: harte Regeln', () => {
  it('keine dark:-Paare (Hell/Dunkel schalten die Tokens um)', () => {
    expect(hits(/(?<![\w-])dark:[\w\-[\]/.]+/g)).toEqual([])
  })
  it('keine rohen Farbskalen (accent-500, slate-900 …), nur Rollen', () => {
    expect(hits(/\b(?:bg|text|border|ring|from|to|via|fill|stroke|outline|divide|accent|shadow)-(?:accent|success|warning|danger|info|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g)).toEqual([])
  })
  it('keine mitwachsende Schrift (feste Stufen, Anzeigegröße über den Zoom)', () => {
    expect(hits(/font-size\s*:\s*(?:clamp|calc)\(|--ui-scale|--fluid-base/g)).toEqual([])
  })
  it('keine Schrift unter 12 px', () => {
    expect(hits(/text-\[(?:[0-9]|1[01])(?:\.\d+)?px\]/g)).toEqual([])
  })
  it('Radien nur sm, md, lg, xl, full', () => {
    expect(hits(/\brounded(?:-[trblse]{1,2})?-(?:2xl|3xl|\[[^\]]+\])/g)).toEqual([])
  })
  it('Schatten nur sm, md, lg', () => {
    expect(hits(/\bshadow-(?:xl|2xl|inner|\[[^\]]+\])/g)).toEqual([])
  })
  it('Texte: keine verbotenen Wörter (04 Texte.md, Abschnitt 9)', () => {
    const bad = germanTexts().filter((t) =>
      /\b(?:Sie|Ihre[nmrs]?|Ihnen)\b|fehlgeschlagen|konnten? nicht|erfolgreich|Fehler aufgetreten|\bUps\b|\bLeider\b|\w\.\.\.(?![\w$])|\bz\.B\./.test(t)
      || /^[^:]+: (?:OK|Erstellen|Erfassen|Sichern)$/.test(t))
    expect(bad).toEqual([])
  })
})

describe('Fehu Design: Budget (darf nur sinken)', () => {
  const zahlen: Record<keyof typeof budget, number> = {
    hexWerte: hits(/(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g).length,
    inlineStyles: hits(/\bstyle=\{\{/g, tsx).length,
    beliebigeWerte: hits(/\b[a-z][\w-]*-\[[^\]\s]+\]/g).length,
    roheKnoepfe: hits(/<button\b/g, tsx).length,
    roheFelder: hits(/<(?:input|select|textarea)\b/g, tsx).length,
    toLocaleInSeiten: hits(/\.toLocale(?:String|DateString|TimeString)\(/g, (p) => p !== 'format.ts').length,
  }
  for (const [name, ist] of Object.entries(zahlen)) {
    it(`${name}: ${ist} ≤ ${budget[name as keyof typeof budget]}`, () => {
      expect(ist).toBeLessThanOrEqual(budget[name as keyof typeof budget])
    })
  }
})
