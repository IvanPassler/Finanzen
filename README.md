# Finanztool V2

Persönliches Finanzverwaltungs-Tool für Bankkonten, ETF-Portfolio, Immobilien, Beteiligungen, Pensionsfonds, Versicherungen und Steuern (italienisches Steuerrecht).

## Stack

- **Frontend:** Reines statisches HTML/CSS/JS — kein Build-Schritt, kein Framework, kein npm.
- **Backend:** [Supabase](https://supabase.com) (PostgreSQL + Auth + Row Level Security)
- **Bibliotheken (CDN):** `@supabase/supabase-js@2`, `papaparse@5.4.1`

## Lokal starten

```bash
# Option 1 — direkt im Browser öffnen
open index.html

# Option 2 — Static-Server (empfohlen, damit Supabase-Auth korrekt funktioniert)
npx serve .
# oder
python3 -m http.server 8080
```

Dann `http://localhost:8080` aufrufen.

## Deployment

Die App ist eine statische Datei und kann auf jedem Static-Hosting deployt werden (Netlify, Vercel, GitHub Pages, Supabase Storage …). Einfach `index.html`, `styles.css` und `app.js` hochladen.

## Supabase-Konfiguration

`SUPABASE_URL` und `SUPABASE_KEY` stehen am Anfang von `index.html` in einem `<script>`-Block. Der **publishable Key darf öffentlich sein** — alle Daten sind über Row-Level-Security (RLS) geschützt: jede Tabelle erlaubt nur Zugriff auf eigene Zeilen (`auth.uid() = user_id`).

## Datenbankschema

Dokumentiert in `supabase/schema.sql`. Migrationen liegen in `supabase/migrations/`.

| Tabelle | Inhalt |
|---|---|
| `transactions` | Kontobuchungen |
| `banks` | Bankkonten und Depots |
| `portfolio` | ETF/Aktien-Positionsstände |
| `immobilien` | Immobilienobjekte |
| `immo_schuld` | Schuldenverlauf je Immobilie |
| `immo_shares` | Immobilien-Freigaben für andere Nutzer |
| `beteiligungen` | Beteiligungen / Private Equity |
| `pensionsfonds` | Pensionsfonds-Einträge |
| `pension_stand` | Wertverläufe je Pensionsfonds |
| `versicherungen` | Versicherungspolicen |
| `versicherung_stand` | Wertverläufe je Versicherung |
| `steuer_einstellungen` | Steuer-Parameter je Nutzer |
| `kategorien` | Zweistufige Ausgaben-/Einnahmekategorien |
| `einkommen` | Einkommensquellen mit Steuer-Profil |
| `budgets` | Monats-/Jahresbudgets je Kategorie |
| `vermoegensgegenstaende` | Gold, Fahrzeuge, Krypto, etc. |
| `sim_einstellungen` | Simulations-Parameter |
| `sim_ziele` | Finanzielle Ziele |
| `sim_aktionen` | Szenario-Aktionen auf Vermögenswerte |
| `vermoegen_snapshot` | Monatliche Vermögens-Snapshots |

## Dateistruktur

```
index.html        Markup + Konfig + CDN-Einbindung
styles.css        Alle CSS-Stile
app.js            Gesamte JavaScript-Logik
supabase/
  schema.sql      Aktuelles Datenbankschema
  migrations/     Einzelne Migrations-Dateien
docs/
  ANALYSE.md      Analyse und Notizen
  IMPROVEMENT_PLAN.md  Verbesserungsideen
  STEUER_PLAN.md  Steuerbereich-Planung
CLAUDE.md         Anweisungen für Claude Code
```

## Code-Abschnitte in `app.js`

Der Code ist in benannte Abschnitte gegliedert (erkennbar an `// ====…====`-Kommentaren):

- Supabase-Client-Initialisierung
- Hilfsfunktionen (Formatierung, Datum, XSS-Escaping)
- Auth (Login/Logout)
- Daten laden + anzeigen (loadData, render)
- Navigation (switchSection, showPage)
- Transaktionen (CRUD, Filter, CSV-Import)
- Portfolio / ETF & Aktien
- Banken
- Dashboard / Cockpit
- Immobilien + Tilgungsplan
- Beteiligungen
- Pensionsfonds
- Versicherungen
- Kategorien (zweistufig)
- Vermögensgegenstände
- Einkommen
- Budgets
- Steuern
- Simulation (Szenarien, Liquiditätsprognose, Finanzielle Ziele)
