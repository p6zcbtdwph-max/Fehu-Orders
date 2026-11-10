module.exports = {
  root: true,
  extends: ['@electron-toolkit/eslint-config-ts', '@electron-toolkit/eslint-config-ts/eslint-recommended'],
  plugins: ['react-hooks'],
  ignorePatterns: ['out', 'dist', 'dist-builder', 'node_modules', 'ios', 'resources'],
  rules: {
    // Regeln-der-Hooks als Fehler; fehlende Abhängigkeiten nur als Hinweis (viele bewusst weggelassen)
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'off',
    // Diese App nutzt `any` und implizite Return-Types bewusst pragmatisch (z.B. IPC-Payloads) —
    // beide Regeln wären hier reine Stil-Erzwingung ohne Bug-Nutzen, siehe docs/audit-2026-08-31.md #15.
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
  }
}
