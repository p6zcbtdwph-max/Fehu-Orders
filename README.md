# Fehu Orders (Beta)

Mac-App, um viele gestaffelte Limit-Orders auf einmal zu planen und an eine Krypto-Börse zu senden: **Kraken, Bitvavo oder Coinbase** (Auswahl „Börse“ unten links). Design aus dem FF Lifemanager. Auf Deutsch und Englisch (Umschalter „Sprache“ unten links).

Die Liste unten beschreibt viele Funktionen am Beispiel Kraken, sie gelten genauso für Bitvavo und Coinbase. Wo sich die Börsen unterscheiden, steht es unter [Börsen](#börsen).

> **Wichtiger Risiko-Hinweis / Important risk notice**
>
> Krypto ist hochriskant, du kannst dein eingesetztes Geld teilweise oder ganz verlieren. Orders, die du sendest, werden bei deiner Börse wirklich ausgeführt und lassen sich danach nicht rückgängig machen. Fehu Orders ist ein Werkzeug, keine Anlageberatung, und gibt keine Empfehlungen. Die Beta kann Fehler haben, Nutzung ohne Gewähr. Setze nur Geld ein, dessen Verlust du verkraften kannst. Zur Sicherheit kann am Anfang pro Sendung nur bis 50 € gesendet werden (Einstellungen › Sicherheit).
>
> Crypto is high risk; you can lose some or all of your money. Orders you send are really executed at your exchange and cannot be undone. Fehu Orders is a tool, not investment advice, and makes no recommendations. The beta may contain bugs and comes without warranty. Only use money you can afford to lose. For safety, each send is limited to 50 € at the start (Settings › Safety).

## Was die Beta kann

- Handelspaar wählen (alle EUR-Paare von Kraken), Kauf oder Verkauf, Preisbereich, Anzahl Stufen (1–200) und Gesamtbetrag
- Preisabstände: gleiche Euro-Schritte oder gleiche Prozent-Schritte (logarithmisch)
- Mengenverteilung: gleich, linear, logarithmisch, exponentiell (mit einstellbarem Verhältnis letzte zu erster Stufe), Fibonacci oder eigene Prozente je Stufe
- Vorlagen: Pläne unter einem Namen speichern und wieder laden
- Watchlist: Paare mit dem Stern merken, sie stehen oben als Schnellauswahl
- Anzeige in Euro oder Dollar (Umschalter unten links, Kurs EUR/USD von Kraken). Orders laufen immer in Euro.
- Betrag zum Investieren oben im Planer
- „Davon jetzt senden“: nur die ersten N Stufen nah am Kurs senden, den Rest später unter „Offene Orders“ mit „Rest senden“ (gleiche Plan-Nummer, „Plan stornieren“ erfasst alles)
- Kurs-Chart (30 Tage, 90 Tage, 1 Jahr) mit den geplanten Stufen als Linien
- Gebühren (Maker/Taker von Kraken) und verfügbares Guthaben vor dem Senden; bei zu wenig Guthaben ist Senden gesperrt
- Gewinnstaffel: für einen Kaufplan mit Ausführungen schlägt die App eine Verkaufsstaffel 10–50 % über dem Durchschnittspreis vor
- Ausführungen: die App prüft jede Minute die Pläne der letzten 90 Tage, zeigt Ausgeführt und Ø Preis und meldet neue Ausführungen als macOS-Mitteilung
- Vorschau als Diagramm und Tabelle, Stufen unter Krakens Mindestgröße werden markiert
- **Probelauf:** Kraken prüft alle Orders (`validate`), legt aber nichts an. Kraken hat für Spot keine Spielgeld-Umgebung, deshalb ist das der sichere Test.
- Echt senden in Paketen zu 15 Orders, Post-only als Standard
- **Entwürfe:** Order-Gruppen mit „Als Entwurf“ zwischenspeichern, nach Szenario (z. B. „Crash“) gruppieren und erst mit „Freigeben“ an Kraken senden. Vor der Freigabe zeigt die App den aktuellen Kurs, Kursbewegung seit dem Speichern, Guthaben und Stufen auf der falschen Kursseite.
- **Schlüssel:** eigener Reiter mit Schritt-für-Schritt-Anleitung, Formatprüfung (vertauscht, unvollständig) und Rechte-Prüfung. Schlüssel mit Auszahlungsrecht werden nicht gespeichert.
- Warnung, wenn Kauf-Stufen über bzw. Verkauf-Stufen unter dem aktuellen Kurs liegen
- **Erster Test:** Knopf im Planer lädt einen Mini-Plan (BTC/EUR, 2 Stufen 20 % unter dem Kurs, knapp über Krakens Minimum) und senkt auf Wunsch die Obergrenze auf 50 € (neuer Standard)
- **Kursprüfung beim Senden:** Der Hauptprozess holt den Kurs unmittelbar vor dem Senden und blockiert Stufen auf der falschen Kursseite. Der Planer frischt den Kurs alle 30 Sekunden auf.
- **Notbremse:** „Alle Orders stornieren“ unter „Offene Orders“ (Krakens `CancelAll`)
- **Protokoll:** jedes Senden, Stornieren, jeder Fehler und Kursalarm mit Uhrzeit, Export als CSV (Excel/Numbers)
- **Kursalarm für Entwürfe:** macOS-Mitteilung, wenn der Kurs die erste Stufe erreicht; sendet nichts
- **Wartungshinweis:** Krakens Systemstatus wird alle 2 Minuten abgefragt
- Preise werden auf Krakens Preisschritt (`tick_size`) gerundet
- Guthaben mit lesbaren Namen (BTC statt XXBT), Earn-Guthaben getrennt
- Offene Orders, Guthaben, gesendete Pläne und „Plan stornieren“ (alle Orders eines Plans tragen dieselbe `userref`)

## Sicherheit

- Fenster in der Electron-Sandbox, Content-Security-Policy im Build, Navigation auf fremde Seiten und Webviews gesperrt, alle Berechtigungsanfragen (Kamera, Mikrofon …) abgelehnt, Befehle nur vom eigenen App-Fenster angenommen
- **Datensicherung** unter Einstellungen: Pläne, Entwürfe, Vorlagen, Einstellungen und Protokoll in eine JSON-Datei sichern und wiederherstellen. Der Schlüssel ist nie enthalten; vor dem Wiederherstellen wird der alte Stand automatisch im App-Ordner gesichert.

- Der API-Schlüssel wird mit Electron `safeStorage` verschlüsselt, der Generalschlüssel liegt im macOS-Schlüsselbund (wie beim Lifemanager). Datei: `~/Library/Application Support/fehu-orders/kraken-key.bin`.
- Der Schlüssel verlässt nie den Hauptprozess, das Fenster spricht nicht selbst mit dem Netz.
- Obergrenze pro Sendung in Euro (Standard 50 €), geprüft im Hauptprozess. Sie gilt für jede Sendung einzeln: Senden, „Rest senden“ und „Zone scharf schalten“, jede mit Touch ID. Auf einer Börse, auf der noch nie ein Plan echt angelegt wurde, gilt beim ersten Test höchstens 50 €.
- **Touch ID vor jedem echten Senden** (auch „Rest senden“ und Entwurf freigeben), abgefragt im Hauptprozess. Der Probelauf geht ohne. Macs ohne Touch ID nutzen nur das Bestätigungsfenster; der Reiter Schlüssel zeigt, was gilt.
- Reiter Schlüssel mit **Profi-Tipp IP-Beschränkung** (Schlüssel nur vom eigenen Anschluss nutzbar, mit Hinweis auf wechselnde IP-Adressen)
- **Hinweis zum gesperrten Guthaben:** Planer, Bestätigung, Entwürfe und Einführung erklären, dass jede gesendete Order ihren vollen Betrag bei Kraken sperrt, bis sie ausgeführt oder storniert ist. Entwürfe sperren nichts.
- Kraken-Schlüssel nur mit: Guthaben abfragen, Offene/geschlossene Orders abfragen, Orders erstellen und ändern, Orders stornieren. **Keine Auszahlungen.**

## Kraken-Anbindung

- Eine gemeinsame Verbindung, private Anfragen laufen nacheinander (Nonce immer steigend)
- Zeitlimit 15 s für Abfragen, 30 s für Orders; Orders tragen Krakens `deadline`
- Bricht die Verbindung beim Senden ab, sucht die App die Orders über `userref`, Preis und Menge. Unklare Orders gelten als gesendet, damit nichts doppelt rausgeht.
- Reine Abfragen werden bei „Rate limit“ oder Überlastung bis zu zweimal mit Pause wiederholt, Orders nie
- Status aller Pläne mit einer `ClosedOrders`-Abfrage (seitenweise) statt einer pro Plan
- Netz- und Wartungsfehler als verständliche deutsche Meldungen; Preise und Mengen ohne Exponent-Schreibweise

## Begriffe

So heißen die Dinge in der App, im Code und in diesem Text. Neue Texte nutzen genau diese Wörter.

| Begriff | Bedeutung |
|---|---|
| **Plan** | Alles, was du im Planer einstellst: Paar, Richtung, Preisbereich oder Zonen, Stufen, Betrag. Nach dem ersten echten Senden hat er eine **Plan-Nummer** (bei Kraken `userref`), alle seine Orders tragen sie. |
| **Stufe** | Eine einzelne Limit-Order im Plan mit Preis und Menge. |
| **Sendung** | Ein Klick auf Senden, „Rest senden“ oder „Zone scharf schalten“. Ein Plan kann aus mehreren Sendungen bestehen. |
| **Obergrenze pro Sendung** | Höchster Gegenwert einer einzelnen Sendung (Einstellungen › Sicherheit). Schützt vor Tippfehlern. |
| **Probelauf** | Die Börse oder die App prüft alle Orders, legt aber nichts an. |
| **Entwurf** | Gespeicherter Plan, der noch nicht gesendet ist und kein Geld sperrt. „Freigeben“ sendet ihn. |
| **Preiszone** | Ein eigener Preisbereich mit eigenem Anteil am Betrag. **Scharf** heißt: geht beim Senden mit raus. **Entschärft** heißt: bleibt im Plan und wird später scharf geschaltet. |
| **Davon jetzt senden / Rest senden** | Nur die ersten Stufen nah am Kurs jetzt senden, den Rest später mit derselben Plan-Nummer. |
| **Ausführungsbuch** | Die App speichert ausgeführte Orders deiner Pläne mit Datum (`fills.json`). Sie bleiben nach einem Neustart erhalten und sind Grundlage für Einstand, Haltefrist und Gegenorder. |
| **Mindest-Orderwert** | Kleinster Gegenwert einer Stufe (Standard 10 €). Kleinere Stufen hebt der Planer an. |
| **Post-only** | Order kommt nur ins Orderbuch und wird nie sofort zum Marktpreis ausgeführt. |
| **Notbremse** | Storniert alle offenen Orders auf allen Börsen mit Schlüssel. |

## Börsen

| | Kraken | Bitvavo | Coinbase |
|---|---|---|---|
| Probelauf | Kraken prüft (`validate`) | App prüft selbst (Regeln, Guthaben) | Coinbase-Vorschau je Order plus Guthaben |
| Senden | Pakete zu 15 Orders | einzeln | einzeln |
| Plan-Nummer | `userref` | in der Order-Kennung (UUID) | in der Order-Kennung `fehu-<Nummer>-…` |
| Auszahlungsrecht | App prüft und lehnt ab | App fragt nach, du bestätigst | App prüft und lehnt ab |
| Live getestet | ja | noch offen | noch offen |

## Sprache

Jeder Text steht an seiner Stelle in beiden Sprachen: `tr('Speichern', 'Save')` aus `src/shared/i18n.ts` (geht auch mit JSX). Haupt- und Fensterprozess setzen die Sprache aus `Settings.language`, ohne Einstellung gilt die Systemsprache. Beim Umschalten der Sprache wechselt auch das Zahlenformat mit, es lässt sich danach getrennt zurückstellen. `tr()` nie auf Modulebene in Konstanten auswerten, sondern beim Zeichnen.

## Entwicklung

```bash
npm install
npm run dev        # App starten
npm test           # Tests (Vitest)
npm run typecheck
npm run lint
npm run dist       # unsignierte .dmg
```

Bei jedem Pull Request laufen Typprüfung, Lint und Tests automatisch auf GitHub („Prüfung“, `.github/workflows/pruefung.yml`). Nur mit grünem Haken mergen.

## Aufbau

| Datei | Aufgabe |
|---|---|
| `src/shared/ladder.ts` | Rechenkern: Verteilungsfunktionen, Rundung, Mindestgrößen, `prepareForSend` als letzte Prüfung |
| `src/shared/send-split.ts` | Welche Stufen jetzt rausgehen (Teilsenden, entschärfte Zonen), gleich in Planer und Hauptprozess |
| `src/main/exchange.ts` | Gemeinsame Schnittstelle aller Börsen |
| `src/main/kraken.ts`, `bitvavo.ts`, `coinbase.ts` | Anbindung je Börse: Signatur, Paare, Kurs, Guthaben, Orders, Stornieren |
| `src/main/store.ts` | Schlüssel (Schlüsselbund), Einstellungen, Pläne, Entwürfe, Protokoll, Ausführungsbuch |
| `src/main/index.ts` | Fenster, IPC und der eine Sendeweg `runSend` (Regeln, Obergrenze, Touch ID, frischer Kurs, Senden, Protokoll) |
| `src/renderer/src/pages` | Planer, Entwürfe, Offene Orders, Protokoll, Schlüssel, Einstellungen |
| `src/renderer/src/pages/planner` | Teile des Planers: Ergebnis (Chart, Tabelle), Prüfungen, Fenster, Verteilung, Vorlagen, Paar, Börsendaten |
| `src/renderer/src/components/Hint.tsx` | Erklärungen, die sich mit „Verstanden“ einklappen lassen |
| `src/renderer/src/components/ui`, `assets/index.css`, `tailwind.config.js` | aus dem FF Lifemanager übernommen |
