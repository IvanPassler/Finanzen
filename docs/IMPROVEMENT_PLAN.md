# IMPROVEMENT_PLAN.md

Umsetzungsplan basierend auf ANALYSE.md §8.
Stand: 2026-06-21. Codeänderungen noch nicht begonnen.

---

## Ausführungsreihenfolge (nummeriert)

```
1.  ✅ A2  pension_stand – Migration & Schema  (bereits erledigt)
2.  A3  netWorthSeries() – Dead Code entfernen
3.  A4  miete_brutto – toten Zweig entfernen
4.  A1  KEST = 0.26 – Steuerkonstante einführen
5.  A5  isoDate() – Datums-Helper extrahieren
6.  A6  Inline-Farben auf CSS-Variablen umstellen
7.  A7  schema.sql – Dokumentationskommentare
8.  B9  workIncomeYear() – Duplikat in renderIncomeOverview beseitigen
9.  B12 renderImmoTx() – Datumsfilter anwenden
10. B11 Button-Disable – Doppelklick-Schutz für alle Formulare
11. B13 restschuld – Sync beim Löschen eines Schuld-Stands
12. B8  latestPortfolioMap() – gemeinsame Funktion extrahieren
13. B10 Promise.all – Lade-Koordination beim Login
14. C14 renderDashboard() – aufteilen
15. C15 wealthSeries() – inkrementelle Berechnung
16. C16 Pagination – Transaktionsliste (⚠ Rollback-Plan, Backup)
17. C17 bank als FK-Migration (⚠ Rollback-Plan, Backup)
```

Schritte 2–7 sind unabhängig voneinander und können in beliebiger Reihenfolge angegangen werden.
Schritte 8–11 können nach Abschluss von 2–7 ebenfalls in beliebiger Reihenfolge erfolgen.
Schritt 12 (B8) und 13 (B10) müssen vor 14 (C14) fertig sein.
Schritt 15 ist unabhängig von 14, aber sinnvollerweise danach.

---

## Schritt 1 — ✅ A2: `pension_stand` – Migration & Schema

**Status: erledigt** (Commit `8b27bb0`, 2026-06-21)

Migration `20260621184305_add_pension_stand.sql` gepusht. Tabelle mit PK, FK (`ON DELETE CASCADE` zu `pensionsfonds`), RLS-Policies (join-basiert über `pensionsfonds.user_id`) in Produktions-DB vorhanden. `schema.sql` aktualisiert.

---

## Schritt 2 — A3: `netWorthSeries()` – Dead Code entfernen

**Datei:** `index.html`  
**Zeilen:** 2276–2307 (32 Zeilen)

**Was geändert wird:**  
Funktion `netWorthSeries()` vollständig löschen. Sie wird nirgendwo aufgerufen (kein Aufrufer im gesamten Code). Die Dashboard-Vermögensentwicklung nutzt `wealthSeries()` + `drawWealthChart()`.

**Abhängigkeiten:** keine

**Risiko:** niedrig — reines Löschen von unerreichbarem Code, keine Laufzeitwirkung

**Akzeptanzkriterium:**  
`grep -n "netWorthSeries" index.html` liefert 0 Treffer. Dashboard öffnet ohne JS-Fehler in der Browserkonsole, alle Charts werden korrekt gerendert.

---

## Schritt 3 — A4: `d.miete_brutto` – toten Zweig entfernen

**Datei:** `index.html`  
**Zeilen:** 2752–2757

**Was geändert wird:**  
In `immoKPIs()`:
```js
// vorher
const mieteIstBrutto = d.miete_brutto !== false;
if (verm && mieteIstBrutto) {

// nachher
if (verm) {
```
`miete_brutto` ist kein DB-Feld und wird nirgendwo gesetzt – der Check ist immer `true`. Variable und Kommentar entfernen.

**Abhängigkeiten:** keine

**Risiko:** niedrig — Verhalten ändert sich nicht, da Bedingung immer `true` war

**Akzeptanzkriterium:**  
`grep -n "miete_brutto" index.html` liefert 0 Treffer. Immobilien-Karten zeigen identische KPI-Werte wie vor der Änderung (Nettomietrendite, ROE, Cashflow).

---

## Schritt 4 — A1: `KEST = 0.26` – Steuerkonstante einführen

**Datei:** `index.html`  
**Betroffene Zeilen:** 2171, 2199, 2202, 2418, 3014, 3015, 3445, 3446, 3461, 3517 (9 Stellen)

**Was geändert wird:**  
Am Anfang des `<script>`-Blocks (nach den globalen `let`-Deklarationen) einfügen:
```js
const KEST = 0.26;   // Kapitalertragsteuer IT
const KEST_FAKTOR = 1 - KEST;  // = 0.74, für Netto-Berechnungen
```
Alle `0.26` und `0.74` in Berechnungskontexten durch `KEST` bzw. `KEST_FAKTOR` ersetzen. SVG-Farbwerte (die zufällig `.26` enthalten) bleiben unverändert – nur arithmetische Ausdrücke.

**Abhängigkeiten:** keine (kann parallel zu 2, 3 gemacht werden)

**Risiko:** niedrig — rein textueller Ersatz, Wert identisch

**Akzeptanzkriterium:**  
`grep -nP "[^#\w]0\.26|[^#\w]0\.74" index.html` liefert 0 Treffer in arithmetischen Kontexten. Dashboard-KPIs (latente Steuer, Nettovermögen), Beteiligungen-Erträge und Steuerseite zeigen identische Werte.

---

## Schritt 5 — A5: `isoDate()` – Datums-Helper extrahieren

**Datei:** `index.html`  
**Betroffene Zeilen (vollständiges Datum `YYYY-MM-DD`):** 1822–1824, 1849, 2951, 3335  
**Betroffene Zeilen (nur Monat `YYYY-MM`):** 2153, 2181, 2183, 2348, 2350, 3403, 3405

**Was geändert wird:**  
Zwei Hilfsfunktionen einfügen (neben `euro`, `fmtNum` ab Zeile 889):
```js
const isoDate  = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const isoMonth = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
```
Alle 11 Inline-Formatierungen durch Aufrufe ersetzen.

**Abhängigkeiten:** keine

**Risiko:** niedrig — Ausgabe identisch, nur Extraktion

**Akzeptanzkriterium:**  
`grep -n "padStart.*getDate\|getMonth.*padStart" index.html` liefert 0 Treffer. Datumsfelder in Immobilien- und Pensionsfonds-Karten sind korrekt vorbelegt. Bulk-Stand-Erfassung im Portfolio zeigt korrektes Datum.

---

## Schritt 6 — A6: Inline-Farben auf CSS-Variablen umstellen

**Datei:** `index.html`  
**Betroffene Zeilen:** 1681, 2137

**Was geändert wird:**

Zeile 1681 (Portfolio-Chart-Tooltip, innerhalb von `innerHTML`):
```js
// vorher
const gewColor = gew >= 0 ? "#2E7D32" : "#C62828";
// … style="color:${gewColor}"

// nachher
const gewColor = gew >= 0 ? "var(--green)" : "var(--red)";
```

Zeile 2137 (Dashboard Portfolio-Gewinn-KPI):
```js
// vorher
gainEl.style.color = pGain >= 0 ? "#2E7D32" : "#C62828";

// nachher
gainEl.style.color = pGain >= 0 ? "var(--green)" : "var(--red)";
```

**Nicht geändert:** Hardcodierte Hex-Werte in Chart-Farb-Arrays (`donut`, `drawInvestmentChart`, `drawCashflowChart`) bleiben als-is – SVG-`fill`/`stroke`-Attribute und JS-Objekt-`color`-Properties unterstützen CSS-Variablen nicht zuverlässig. Kein `#8a6d00` (Warning-Textfarbe), da dafür keine CSS-Variable existiert.

**Abhängigkeiten:** keine

**Risiko:** niedrig — nur Darstellung

**Akzeptanzkriterium:**  
Portfolio-Gewinn-KPI und Chart-Tooltip zeigen grüne/rote Farbe. Bei Theme-Änderung (falls `--green`/`--red` angepasst werden) reagieren diese Elemente mit.

---

## Schritt 7 — A7: `schema.sql` – Dokumentationskommentare

**Datei:** `supabase/schema.sql`

**Was geändert wird:**  
Kommentarblock am Anfang der Datei (nach dem PostgreSQL-Dump-Header) einfügen, der folgendes erklärt:
- `transactions.bank` und `portfolio.bank` sind TEXT, kein FK auf `banks.id` – Verknüpfung via Stringvergleich
- `pension_stand` hat kein `user_id`-Feld; RLS-Zugang erfolgt über Join zu `pensionsfonds.user_id`
- `immobilien.restschuld` ist denormalisiert (Spiegel des letzten `immo_schuld`-Eintrags)

**Abhängigkeiten:** keine

**Risiko:** keines — nur Kommentare, keine Schema-Änderung

**Akzeptanzkriterium:**  
`schema.sql` öffnen und Kommentare sind vorhanden. Kein funktioneller Test nötig.

---

## Schritt 8 — B9: `workIncomeYear()` in `renderIncomeOverview()` nutzen

**Datei:** `index.html`  
**Betroffene Zeilen:** 2344–2357 (Duplikat in `renderIncomeOverview`)

**Was geändert wird:**  
`renderIncomeOverview()` berechnet `aktivJahr` (Zeilen 2351–2357) mit identischer Logik wie `workIncomeYear()` (Zeile 3401). Den Duplikat-Block ersetzen:
```js
// vorher
let aktivJahr = 0;
allRows.forEach((r) => {
  if (r.umbuchung || r.immo_id || ...) return;
  ...
  aktivJahr += ...;
});

// nachher
const aktivJahr = workIncomeYear();
```

**Abhängigkeiten:** Schritt 2–7 sollten abgeschlossen sein (saubere Baseline)

**Risiko:** niedrig — `workIncomeYear()` ist identische Logik, existiert bereits

**Akzeptanzkriterium:**  
Dashboard „Einkommensübersicht"-Donut zeigt identischen Wert für „Arbeit (12 Mon.)" wie vorher. Wert stimmt mit dem auf der Steuer-Seite unter „Arbeitseinkommen / Jahr" überein.

---

## Schritt 9 — B12: `renderImmoTx()` – Datumsfilter anwenden

**Datei:** `index.html`  
**Zeile:** 2719

**Was geändert wird:**
```js
// vorher
const rows = allRows.filter((r) => r.immo_id === activeImmo);

// nachher
const rows = allRows.filter((r) => r.immo_id === activeImmo && inRange(r));
```

**Abhängigkeiten:** keine

**Risiko:** niedrig — korrigiert inkonsistentes Verhalten; Nutzer sehen nun weniger Zeilen wenn ein Datumsfilter gesetzt ist (erwartetes Verhalten)

**Akzeptanzkriterium:**  
Datumsfilter auf „Dieses Jahr" setzen, dann eine Immobilie mit Transaktionen aus Vorjahren öffnen. „Zugeordnete Transaktionen" zeigt nur Transaktionen im gewählten Zeitraum. Filter zurücksetzen → alle Transaktionen sichtbar.

---

## Schritt 10 — B11: Button-Disable – Doppelklick-Schutz

**Datei:** `index.html`  
**Betroffene Formulare/Handler:**

| Element | Zeile | Aktion |
|---|---|---|
| `entry-form` submit | 1382 | Transaktion speichern |
| `ub-save` click | 1851 | Umbuchung speichern |
| `pf-form` submit | 1724 | Portfolio-Stand speichern |
| `bank-form` submit | 2019 | Bank speichern |
| `[data-immo-save]` click | 2987 | Immobilie speichern |
| `[data-bet-save]` click | 3144 | Beteiligung speichern |
| `[data-pens-save]` click | 3367 | Pensionsfonds speichern |
| CSV-Import-Button | 3616 | Import |

**Was geändert wird:**  
Pattern: Submit-Button vor dem `await`-Call deaktivieren, nach dem `await` (Erfolg oder Fehler) wieder aktivieren. Analog zum bereits bestehenden Login-Button (Zeile 929).

**Abhängigkeiten:** Schritt 2–7

**Risiko:** niedrig — rein defensiv, kein fachliches Verhalten ändert sich

**Akzeptanzkriterium:**  
Transaktion speichern: Button ist während des Requests ausgegraut. Nach Antwort wieder klickbar. Doppelklick in schneller Folge erzeugt keine doppelten DB-Einträge.

---

## Schritt 11 — B13: `restschuld` – Sync beim Löschen eines Schuld-Stands

**Datei:** `index.html`  
**Zeilen:** 2981–2985 (Delete-Handler für `data-immo-schuld-del`)

**Was geändert wird:**  
Nach erfolgreichem Delete eines `immo_schuld`-Eintrags wird der neue neueste Stand (nach dem Löschen) auf `immobilien.restschuld` zurückgeschrieben. Wenn keine Stände mehr vorhanden sind, wird `restschuld` auf `null` gesetzt:
```js
const schuldDel = e.target.closest("[data-immo-schuld-del]");
if (schuldDel) {
  const delId = schuldDel.getAttribute("data-immo-schuld-del");
  const immoId = card.getAttribute("data-id");
  const { error } = await sb.from("immo_schuld").delete().eq("id", delId);
  if (error) { alert("Fehler: " + error.message); return; }
  // Neuen letzten Stand ermitteln und auf immobilien schreiben
  const remaining = immoSchuldHistory(immoId).filter((s) => s.id !== delId);
  const newRestschuld = remaining.length > 0
    ? Number(remaining[remaining.length - 1].restschuld)
    : null;
  await sb.from("immobilien").update({ restschuld: newRestschuld }).eq("id", immoId);
  loadImmo();
  return;
}
```

**Abhängigkeiten:** Schritt 2–7

**Risiko:** mittel — schreibt auf `immobilien.restschuld`, das im Dashboard und in KPI-Berechnungen genutzt wird; Logik muss korrekt sein

**Akzeptanzkriterium:**  
Immobilie mit 3 Schuld-Ständen anlegen. Neuesten Stand löschen: `immobilien.restschuld` zeigt danach den zweitjüngsten Wert. Alle Stände löschen: `restschuld` ist leer/`null`. KPIs (LTV, EK) im Dashboard stimmen mit manueller Berechnung überein.

---

## Schritt 12 — B8: `latestPortfolioMap()` – gemeinsame Funktion extrahieren

**Datei:** `index.html`  
**Duplikate an:** Zeilen 2105–2112, 1466–1471, 1904–1912, 2393–2401, 3452–3457 (5 Stellen)

**Was geändert wird:**  
Neue Funktion nach `renderBindung()` einfügen (~Zeile 1622):
```js
// Gibt Map zurück: "bank|bezeichnung" → neuester portfolioRows-Eintrag
// Optional: nur Einträge für bankFilter-Menge berücksichtigen
function latestPortfolioMap(rows, useFilter = false) {
  const latest = {};
  rows.forEach((r) => {
    const bank = r.bank || "";
    if (useFilter && !bankSelected(bank)) return;
    const key = bank + "|" + (r.bezeichnung || "");
    const st = (r.datum || "") + (r.created_at || "");
    if (!latest[key] || st >= latest[key].st) latest[key] = { ...r, st, bank };
  });
  return latest;
}
```

Alle 5 Duplikate durch Aufrufe ersetzen. Parameter `useFilter = true` für Dashboard-Kontext (wo `dashBankFilter` gilt), `false` für Portfolio-Seite und Steuer-Seite.

**Abhängigkeiten:** Schritte 2–11 abgeschlossen

**Risiko:** mittel — berührt Dashboard, Portfolio-Seite, Banken-Tabelle und Steuer-Seite gleichzeitig; alle müssen nach dem Refactor identische Werte zeigen

**Akzeptanzkriterium:**  
Alle fünf Stellen prüfen: Dashboard-Portfolio-KPI, Portfolio-Übersicht-Summen, Banken-Tabelle Portfolio-Spalte, Steuer-Latent-Berechnung, Vermögensverlauf-Chart — alle zeigen identische Werte wie vor dem Refactor. `grep -c "const latest = {}" index.html` liefert 0.

---

## Schritt 13 — B10: Promise.all – Lade-Koordination beim Login

**Datei:** `index.html`  
**Zeilen:** 939–958 (`onAuthStateChange`-Handler)

**Was geändert wird:**  
Alle `load*()`-Aufrufe in `Promise.all` wickeln; `renderDashboard()` explizit danach einmalig aufrufen. Alle `typeof renderDashboard === "function"`-Guards aus den einzelnen `load*()`-Funktionen entfernen (da `renderDashboard` nach dem gemeinsamen Await garantiert existiert).

```js
sb.auth.onAuthStateChange(async (_event, session) => {
  if (session) {
    loginView.classList.add("hidden");
    appView.classList.remove("hidden");
    document.getElementById("user-email").textContent = session.user.email;
    currentUserName = session.user.email;
    const un = document.getElementById("bank-user-name");
    if (un) un.textContent = currentUserName;
    await Promise.all([
      loadData(), loadPortfolio(), loadBanks(),
      loadImmo(), loadBet(), loadPens(), loadSteuer(),
    ]);
    renderDashboard();
  } else {
    appView.classList.add("hidden");
    loginView.classList.remove("hidden");
    document.getElementById("password").value = "";
  }
});
```

Zu entfernen: `if (typeof renderDashboard === "function") renderDashboard();` an Zeilen 1887, 2781, 3029, 3210 (aus `loadBanks`, `loadImmo`, `loadBet`, `loadPens`).  
Zu entfernen: alle `typeof immoRows !== "undefined"`, `typeof betRows !== "undefined"` etc. Guards in `renderDashboard()` (Zeilen 2116, 2118, 2120, 2201–2203), da beim Aufruf alle Daten garantiert geladen sind.

**Abhängigkeiten:** Schritt 12 (B8) – nach B8 ist renderDashboard übersichtlicher und leichter zu testen

**Risiko:** mittel — ändert Initialisierungsreihenfolge; bei einem Lade-Fehler (z.B. Netzwerk) hängt jetzt alles statt nur ein Teilbereich

**Akzeptanzkriterium:**  
Nach Login erscheint Dashboard mit vollständig befüllten KPIs in einem einzigen Render. Browserkonsole zeigt 0 Fehler. Alle Bereiche (Immobilien, Portfolio, Steuern, Pensionsfonds) zeigen identische Werte wie vorher. Performance-Test: Ladezeit bis erstes vollständiges Dashboard messen (sollte ≤ vorher sein, da parallel statt sequenziell).

---

## Schritt 14 — C14: `renderDashboard()` aufteilen

**Datei:** `index.html`  
**Zeilen:** 2094–2250 (~156 Zeilen)

**Was geändert wird:**  
`renderDashboard()` in fokussierte Teilfunktionen zerlegen:

| Neue Funktion | Zuständigkeit | Ungefähre Zeilen |
|---|---|---|
| `computeWealthSnapshot()` | liquid, pInv, pWert, immoEk, betVerm, pensWert, networth | 2097–2121 |
| `computeCashflow(viewRows)` | cfEin, cfAus, letzter-Monat-Ausgaben | 2123–2160 |
| `computeFinanzielleFreiheit(liquid, latest)` | avgAus, avail, luecke | 2179–2222 |
| `renderDashKPIs(...)` | alle `setText`/`textContent`-Zuweisungen | verstreut |
| `renderDashboard()` | Orchestrator: ruft obige auf, dann Charts | bleibt |

**Abhängigkeiten:** Schritte 12 (B8) und 13 (B10) abgeschlossen

**Risiko:** hoch — größtes Refactor bisher; alle Dashboard-Werte müssen nach Umbau identisch sein

**Akzeptanzkriterium:**  
Vor dem Refactor Testwerte notieren (Nettovermögen, Cashflow, Finanzielle Freiheit, alle KPI-Karten). Nach Umbau dieselben Werte prüfen. Zusätzlich: alle vier Sektionen des Dashboards scrollen und alle Charts rendern lassen. Keine JS-Fehler in Konsole.

---

## Schritt 15 — C15: `wealthSeries()` – inkrementelle Berechnung

**Datei:** `index.html`  
**Zeilen:** 2403–2422 (innere Schleife)

**Was geändert wird:**  
Die O(n×m)-Schleife (für jeden Monat alle Transaktionen filtern) durch eine einmalige chronologische Vorab-Aggregation ersetzen:

```js
// Einmalig: kumuliertes Banksaldo je Monat vorberechnen
const txDeltaByBankMonth = {};
allRows.forEach((r) => {
  if (!r.buchungsdatum || !bankSelected(r.bank || "")) return;
  const key = (r.bank || "") + "|" + r.buchungsdatum.slice(0, 7);
  txDeltaByBankMonth[key] = (txDeltaByBankMonth[key] || 0)
    + (Number(r.soll) || 0) + (Number(r.haben) || 0);
});
// Dann je Monat kumulieren statt filtern
```

**Abhängigkeiten:** Schritt 14 (C14) abgeschlossen (sauberere Struktur erleichtert die Änderung)

**Risiko:** mittel — Performance-Verbesserung, aber Rechenergebnis muss identisch bleiben

**Akzeptanzkriterium:**  
Vermögensentwicklungs-Chart vor und nach der Änderung: alle Datenpunkte (Datum + Wert) müssen identisch sein. Performance messen: bei 2000+ Transaktionen sollte `wealthSeries()` messbar schneller sein (Browserkonsole `console.time`).

---

## Schritt 16 — C16: Pagination – Transaktionsliste ⚠

> **Voraussetzung:** Alle vorherigen Schritte committed. Vor Beginn DB-Export als Backup erstellen (Supabase Dashboard → Project Settings → Database → Backup).

**Datei:** `index.html`  
**Zeilen:** 964–972 (`loadData()`), 985–1039 (`render()`)

**Was geändert wird:**  
- `loadData()`: Initial nur die letzten 12 Monate laden (`.gte("buchungsdatum", ...)`)
- Pagination-Controls unter der Transaktionstabelle einfügen (z.B. „Ältere laden"-Button oder Seiten-Navigation)
- Chart-Serien (`cashflowSeries()`, `wealthSeries()`) erhalten separaten Datensatz oder eigene aggregierte Abfragen, da sie historische Daten brauchen

**Abhängigkeiten:** Schritte 13 (B10) und 15 (C15) — B10 klärt Ladestruktur, C15 macht Charts unabhängig von `allRows`-Vollständigkeit

**Risiko:** hoch — verändert Datenmodell der App (allRows nicht mehr vollständig); Charts könnten unvollständig werden wenn nicht sauber entkoppelt

**Rollback-Plan:**
1. `git revert <commit-hash>` für diesen Schritt
2. Falls DB-Daten verändert wurden (nicht der Fall bei reiner Client-Änderung): DB-Backup aus Supabase einspielen
3. Testen: `loadData()` lädt wieder alle Zeilen, Charts zeigen vollständige Historie

**Akzeptanzkriterium:**  
Transaktionsliste zeigt korrekte Einträge mit Pagination. Charts (Cashflow, Vermögen) zeigen identische Kurven wie vor der Änderung (vollständige Daten). Import älterer CSV-Dateien bleibt möglich. Performance-Test: Initialladezeit bei 5000 Transaktionen deutlich kürzer.

---

## Schritt 17 — C17: `bank` als FK-Migration ⚠

> **Voraussetzung:** Alle vorherigen Schritte committed und getestet. Vollständiger DB-Export als Backup (Supabase Dashboard → Project Settings → Database → Backup downloaden, lokal sichern).

**Dateien:** `index.html`, neue Migrationsdatei `supabase/migrations/`

**Was geändert wird:**

*Datenbank (Migration):*
- Neue Spalte `bank_id uuid REFERENCES banks(id)` zu `transactions` und `portfolio` hinzufügen
- Datenmigration: bestehende `bank`-Textwerte per `UPDATE ... SET bank_id = banks.id WHERE banks.name = transactions.bank` befüllen
- Altspalte `bank` (text) entfernen oder als deprecated belassen
- RLS-Policies ggf. anpassen

*JS-Code:*
- Alle Stellen, die `r.bank` oder `r.bank === activeTxBank` nutzen, auf `r.bank_id` umstellen
- `fillBankSelect()` liefert UUIDs statt Namen, Anzeige weiterhin mit `banks.find(...).name`
- CSV-Import: `bank`-Spalte im CSV löst Lookup auf `banks.name` → UUID auf

**Abhängigkeiten:** alle vorherigen Schritte; besonders Schritt 13 (B10) für saubere Ladereihenfolge

**Risiko:** hoch — Datenmigration auf Produktionsdaten, Breaking Change in JS-Logik an vielen Stellen, CSV-Import-Format ändert sich für bestehende Nutzer nicht (Name bleibt im CSV), aber interne Verarbeitung ändert sich komplett

**Rollback-Plan:**
1. `git revert <commit-hash>` für JS-Änderungen
2. Migrations-Rollback in Supabase: `ALTER TABLE transactions DROP COLUMN bank_id; ALTER TABLE portfolio DROP COLUMN bank_id;`
3. Falls `bank`-Textspalte bereits gedroppt: DB-Backup einspielen (deswegen Backup vor Schritt 17 Pflicht)
4. Nach Rollback: `supabase db push` mit dem reverted Schema

**Akzeptanzkriterium:**  
Alle bestehenden Transaktionen haben eine gültige `bank_id`. Umbenennung einer Bank in der UI aktualisiert alle zugehörigen Transaktionen automatisch (FK-Vorteil). Dashboard, Transaktionsliste, Portfolio-Seite zeigen identische Daten. CSV-Import mit alter Vorlage funktioniert weiterhin (Lookup via Name).

---

## Nicht im Scope

Die folgenden Punkte werden **bewusst nicht** angefasst – entweder weil sie außerhalb des aktuellen Verbesserungsziels liegen oder weil der Aufwand/Risiko unverhältnismäßig ist:

| Thema | Grund |
|---|---|
| **Versicherungs-Bereich** | Placeholder-UI, noch kein fachlicher Inhalt |
| **Investment-Simulator** | Placeholder-UI, noch kein fachlicher Inhalt |
| **Accessibility** (`<label for>`, ARIA) | Eigenständiges Thema, kein Sicherheits- oder Korrektheitsproblem |
| **Mobile-Responsiveness** | Grundlegendes CSS vorhanden; kein akutes Problem gemeldet |
| **Testing-Framework** (Unit/E2E) | Würde Build-System erfordern; Scope zu groß |
| **Passwort-Reset / Auth-Flow** | Supabase bietet das out-of-the-box; UI-Aufwand eigenständig |
| **Multi-User-Features** (Admin, Sharing) | Single-User-App by design |
| **Offline-Support / PWA** | Kein Use Case beschrieben |
| **Datenexport** (Excel, PDF) | Kein Use Case beschrieben |
| **Kategorie-Management** (vordefinierte Listen) | Fachliche Entscheidung, kein Tech-Debt |
| **`eigentuemer`-JSONB zu eigener Tabelle** | Zu riskant ohne klaren Vorteil für Ein-Nutzer-Tool |
| **`steuer_einstellungen` Duplikat-Guard** | Sehr unwahrscheinliches Edge Case, `UNIQUE`-Constraint schützt bereits |
