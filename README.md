# Fehu Orders (Beta)

Mac-App, um viele gestaffelte Limit-Orders auf einmal zu planen und an Kraken zu senden. Design aus dem FF Lifemanager.

## Was die Beta kann

- Handelspaar wählen (alle EUR-Paare von Kraken), Kauf oder Verkauf, Preisbereich, Anzahl Stufen (1–200) und Gesamtbetrag
- Preisabstände: gleiche Euro-Schritte oder gleiche Prozent-Schritte (logarithmisch)
- Mengenverteilung: gleich, linear, logarithmisch, exponentiell (mit einstellbarem Verhältnis letzte zu erster Stufe), Fibonacci oder eigene Prozente je Stufe
- Vorlagen: Pläne unter einem Namen speichern und wieder laden
- Kurs-Chart (30 Tage, 90 Tage, 1 Jahr) mit den geplanten Stufen als Linien
- Gebühren (Maker/Taker von Kraken) und verfügbares Guthaben vor dem Senden; bei zu wenig Guthaben ist Senden gesperrt
- Gewinnstaffel: für einen Kaufplan mit Ausführungen schlägt die App eine Verkaufsstaffel 10–50 % über dem Durchschnittspreis vor
- Ausführungen: die App prüft jede Minute die Pläne der letzten 90 Tage, zeigt Ausgeführt und Ø Preis und meldet neue Ausführungen als macOS-Mitteilung
- Vorschau als Diagramm und Tabelle, Stufen unter Krakens Mindestgröße werden markiert
- **Probelauf:** Kraken prüft alle Orders (`validate`), legt aber nichts an. Kraken hat für Spot keine Spielgeld-Umgebung, deshalb ist das der sichere Test.
- Echt senden in Paketen zu 15 Orders, Post-only als Standard
- Offene Orders, Guthaben, gesendete Pläne und „Plan stornieren“ (alle Orders eines Plans tragen dieselbe `userref`)

## Sicherheit

- Der API-Schlüssel wird mit Electron `safeStorage` verschlüsselt, der Generalschlüssel liegt im macOS-Schlüsselbund (wie beim Lifemanager). Datei: `~/Library/Application Support/fehu-orders/kraken-key.bin`.
- Der Schlüssel verlässt nie den Hauptprozess, das Fenster spricht nicht selbst mit dem Netz.
- Obergrenze pro Plan in EUR (Standard 500 €), geprüft im Hauptprozess.
- Kraken-Schlüssel nur mit: Guthaben abfragen, Offene/geschlossene Orders abfragen, Orders erstellen und ändern, Orders stornieren. **Keine Auszahlungen.**

## Entwicklung

```bash
npm install
npm run dev        # App starten
npm test           # Tests (Vitest)
npm run typecheck
npm run dist       # unsignierte .dmg
```

## Aufbau

| Datei | Aufgabe |
|---|---|
| `src/shared/ladder.ts` | Rechenkern: Verteilungsfunktionen, Rundung, Mindestgrößen |
| `src/main/kraken.ts` | Kraken-REST: Signatur, Paare, Kurs, Guthaben, Orders, Batch-Senden, Stornieren |
| `src/main/store.ts` | Schlüssel (Schlüsselbund), Einstellungen, Pläne |
| `src/main/index.ts` | Fenster und IPC |
| `src/renderer/src/pages` | Planer, Offene Orders, Einstellungen |
| `src/renderer/src/components/ui`, `assets/index.css`, `tailwind.config.js` | aus dem FF Lifemanager übernommen |
