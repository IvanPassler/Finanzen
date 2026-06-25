# STEUER_PLAN.md

Umsetzungsplan für den erweiterten Steuern-Bereich gemäß `Konzept_Steuern-Bereich.md`.  
Stand: 2026-06-21. Keine Codeänderungen bisher.

---

## 1. Ist-Stand-Analyse

### Bereits vorhanden (inkl. abweichender Umsetzung)

| Was | Wo im Code | Abweichung vom Konzept |
|---|---|---|
| `irpef(income)` — 23/33/43 %-Berechnung | `index.html:3403` | korrekt, vollständig |
| IRPEF-Stufentabelle (`ste-body`) | `index.html:3504`, `page-steuer-einkommen` | Tabelle vorhanden, **Stufen-Grafik fehlt** |
| `workIncomeYear()` | `index.html:3411` | Heuristik (alle `haben` ohne `immo_id`/`umbuchung`), kein explizites Einkommens-Flag |
| Mieteinnahmen-Steuer (Cedolare/IRPEF) via `immoKPIs()` | `index.html:2740`, `page-steuer-miete` | Berechnung korrekt, aber **keine eigene Kachel** auf Übersicht |
| IMU als Kachel | `index.html:3449`, `st-imu` | Manuell per `imu_jahr` — **kein Katasterwert × Gemeinde-Satz** |
| Kapitalertrag aus **Beteiligungen** (Zinsen + Dividenden) | `index.html:3453–3458` | Beteiligungen korrekt; **Portfolio-Ausschüttungen / realisierte Gewinne fehlen** |
| Latente Steuer (ETF + Beteiligungen Buchgewinne) | `index.html:3461–3466`, `computeWealthSnapshot()` | vorhanden, korrekt (26 %) |
| Absetzbare Pensionsbeiträge | `index.html:3468–3472`, `page-steuer-absetzbar` | vorhanden, korrekt (max 5.164,57 €) |
| Ist/Plan-Differenz (`st-diff`) | `index.html:3487` | nur „laufend vs. Vorauszahlung", **kein YTD-Ist / Jahreshochrechnung** |
| `steuer_einstellungen` | `supabase/schema.sql:193` | nur `grenzsteuersatz` + `vorauszahlung`; **addizionale fehlen** |
| Nav-Struktur Steuern | `index.html:290–296` | 6 Unterseiten vorhanden |

### Fehlt komplett

| Was | Priorität |
|---|---|
| Ist/Plan-Kopfblock (YTD-Ist + Jahreshochrechnung) | P1 |
| IRPEF-Stufen-Grafik (visueller Balken) | P1 |
| Addizionale regionale + comunale (Zuschlag auf IRPEF) | P1 |
| Bollo Depot (0,20 % auf Depotwert) | P1 |
| `transactions.ist_einkommen / einkommensart / betrag_brutto / ritenuta` | P1 |
| `steuer_einstellungen.zu_versteuerndes_einkommen / addizionale_*` | P1 |
| Bollo Konten (34,20 € je Konto bei Ø-Saldo > 5.000 €) | P2 |
| IMU mit Katasterwert × Gemeinde-Satz (Auto-Berechnung) | P2 |
| Cedolare secca als eigene Kachel (10 %/26 %-Varianten) | P2 |
| Pensionsfonds-Ertragsbesteuerung (20 % auf Rendite) | P2 |
| IVAFE / IVIE (Auslandsvermögen) | P2 |
| `banks.im_ausland` / `immobilien.erstwohnsitz` Felder | P2 |
| Was-wäre-wenn-Schieberegler | P3 – nicht in diesem Umbau |
| Tobin Tax, Plusvalenza immobiliare, Erbschaft | P3 – nicht in diesem Umbau |
| Pauschale Haushaltssteuern (RAI, Bollo auto, TARI) | P3 – nicht in diesem Umbau |

---

## 2. Backward-Compatibility-Analyse: `transactions`-Felder

Die vier neuen Spalten (`ist_einkommen`, `einkommensart`, `betrag_brutto`, `ritenuta`) betreffen die am stärksten genutzte Tabelle.

**Risiko:** `ist_einkommen boolean default false` → alle Bestandsdaten haben `false`. Wenn `workIncomeYear()` auf `ist_einkommen = true` umgestellt wird, produziert es sofort `0` für jeden User, der noch keine Transaktionen markiert hat.

**Lösung — additive Parallelstrategie:**

- `workIncomeYear()` bleibt **unverändert** (Heuristik, Basis für bestehenden IRPEF-Block und `renderIncomeOverview()`).
- Neue Funktion `incomeYearTagged()` liest nur Transaktionen mit `ist_einkommen = true` und benutzt `betrag_brutto` + `ritenuta` für präzise Brutto/Netto-Rechnung.
- Der neue **Ist-Block** nutzt `incomeYearTagged()` und zeigt einen CTA `„Transaktionen als Einkommen markieren"`, solange keine getaggten Einträge vorhanden.
- Der **Plan-Block** nutzt weiter `workIncomeYear()` (Heuristik) oder `zu_versteuerndes_einkommen` falls manuell gepflegt.
- Kein Data-Migration-Script nötig. Kein falscher Wert für Bestandsdaten.

**Semantik der neuen Felder:**

| Feld | Null-Fall | Bedeutung |
|---|---|---|
| `ist_einkommen = false/null` | ignoriert von `incomeYearTagged()` | Transaktion ist kein Einkommen (oder noch nicht markiert) |
| `einkommensart = null` | wird als `'sonstige'` behandelt | keine Einkommensart-spezifische Logik |
| `betrag_brutto = false/null` | `haben` = Nettobetrag | ritenuta addieren für Brutto |
| `ritenuta = null` | kein Einbehalt bekannt | nur `haben` wird verwendet |

---

## 3. P3 – explizit ausgeschlossen

Folgende Konzept-Punkte werden in diesem Umbau **nicht** angefasst:

- Was-wäre-wenn-Schieberegler (§ 3.5)
- Tobin Tax, Plusvalenza immobiliare, Erbschaft/Schenkung
- Pauschale Haushaltssteuern (Canone RAI, Bollo auto, TARI)
- Kapitalertrag-Differenzierung nach Staatsanleihen-12,5 %-Satz

---

## 4. Welle 1 — P1 (Kernausbau)

### W1.1 — Schema-Migration: `steuer_einstellungen` erweitern

**Datei:** neues `supabase/migrations/YYYYMMDDHHMMSS_steuer_einstellungen_addizionale.sql`

**SQL:**
```sql
-- steuer_einstellungen: Addizionale-Zuschläge + planbares Jahreseinkommen
alter table public.steuer_einstellungen
  add column zu_versteuerndes_einkommen numeric,
  add column addizionale_regionale       numeric default 1.23,
  add column addizionale_comunale        numeric default 0.8;
```

**RLS-Check:** Keine neuen Policies nötig. Die bestehenden 4 Policies (select/insert/update/delete, alle `auth.uid() = user_id`) decken neue Spalten automatisch ab.

**Schema-Änderung für `schema.sql`:** Die 3 Spalten in den `CREATE TABLE`-Block bei `steuer_einstellungen` einfügen.

**Abhängigkeiten:** keine

**Risiko:** niedrig — `alter table add column` mit DEFAULT ist in PostgreSQL nicht-blockierend, keine Datenverluste.

**Akzeptanzkriterium:** Migration läuft ohne Fehler. `select zu_versteuerndes_einkommen, addizionale_regionale, addizionale_comunale from steuer_einstellungen limit 1` gibt Zeile zurück.

---

### W1.2 — Schema-Migration: `transactions` Einkommens-Felder

**Datei:** neues `supabase/migrations/YYYYMMDDHHMMSS_transactions_einkommen.sql`

**SQL:**
```sql
-- transactions: Einkommens-Klassifizierung für präzise IRPEF-Ist-Berechnung.
-- Bestehende Zeilen behalten default-Werte; backward-compatible (siehe STEUER_PLAN §2).
alter table public.transactions
  add column ist_einkommen  boolean default false,
  add column einkommensart  text,       -- 'dipendente' | 'autonomo' | 'affitto' | 'sonstige'
  add column betrag_brutto  boolean default false,  -- haben = brutto (true) oder netto (false)
  add column ritenuta       numeric;                -- bereits einbehaltene Steuer
```

**RLS-Check:** Keine neuen Policies. Bestehende `tx_*` Policies greifen auf alle Spalten der Tabelle.

**Constraint-Überlegung:** `einkommensart` sollte ein `CHECK`-Constraint bekommen oder als `text` ohne Check bleiben (flexibler für spätere Erweiterungen). Empfehlung: ohne CHECK, da Validierung im JS ausreicht.

**Schema-Änderung für `schema.sql`:** 4 Spalten in den `transactions CREATE TABLE`-Block einfügen.

**Abhängigkeiten:** keine

**Risiko:** mittel — größte Tabelle der App. `alter table add column` ist non-blocking in PG 17+. Jedoch: kein UNIQUE/FK → kein Deadlock-Risiko. Bestehende `workIncomeYear()` liest die Felder nicht und läuft unverändert.

**Akzeptanzkriterium:** `select ist_einkommen, einkommensart, betrag_brutto, ritenuta from transactions limit 1` gibt Zeile zurück. Transaktionsliste lädt ohne Fehler, alle Bestandsdaten unverändert.

---

### W1.3 — `loadSteuer()` + Einstellungs-Formular erweitern

**Datei:** `index.html`  
**Betroffene Bereiche:**
- HTML `page-steuer-einstellungen` (~`index.html:533`): 3 neue Eingabefelder
- `loadSteuer()` (~`index.html:3426`): neue Felder in `steuerSettings` einlesen und ins Formular schreiben
- `set-save`-Handler (~`index.html:3550`): neue Felder in payload aufnehmen
- `renderSteuern()` (~`index.html:3434`): `addizionale_regionale + addizionale_comunale` in IRPEF-Berechnung einbeziehen

**Neue Felder im Formular:**
- `set-addiz-regional` (Zahl, %, Default 1,23)
- `set-addiz-kommunal` (Zahl, %, Default 0,80)
- `set-jahreseinkommen` (Betrag, optional — Override für Plan-Berechnung)

**IRPEF-Erweiterung in `renderSteuern()`:**
```js
const addizR = (steuerSettings.addizionale_regionale ?? 1.23) / 100;
const addizK = (steuerSettings.addizionale_comunale ?? 0.8) / 100;
const incomeTax = irpef(workInc) + workInc * (addizR + addizK);
```
`st-einkommen` zeigt damit IRPEF + Addizionale als Gesamtwert.

**Abhängigkeiten:** W1.1 muss in der DB deployed sein.

**Risiko:** niedrig — additive Änderung an bestehender Logik. Wenn `steuer_einstellungen`-Zeile noch nicht existiert, bleiben die Felder `null` → Defaults greifen.

**Akzeptanzkriterium:** Formular zeigt Addizionale-Felder vorausgefüllt mit 1,23 / 0,80. Speichern schreibt Werte. `st-einkommen` enthält jetzt IRPEF + Addizionale (ca. 2 % höher als vorher).

---

### W1.4 — Ist/Plan-Kopfblock auf Übersicht

**Datei:** `index.html`  
**Betroffene Bereiche:**
- HTML `page-steuer-uebersicht` (~`index.html:447`): bestehende 8 KPI-Kacheln bleiben; oben kommt der neue Zweispalten-Block
- `renderSteuern()`: neuen `renderSteuerKopf()`-Aufruf ergänzen
- Neue Funktion `renderSteuerKopf()` (ca. 40 Zeilen)

**Was `renderSteuerKopf()` berechnet:**

*Ist-Seite (aus getaggten Transaktionen):*
```
incomeTagged = incomeYearTagged()      // neue Funktion (W1.2-Abhängig)
istSteuer    = irpef(incomeTagged.brutto) + addizionale
istBezahlt   = incomeTagged.ritenuteSum
istOffen     = max(0, istSteuer - istBezahlt)
ytdMonths    = vergangene Monate dieses Jahres (1–12)
```

*Plan-Seite (aus Heuristik oder manuellem Wert):*
```
planEinkommen = steuerSettings.zu_versteuerndes_einkommen ?? (workIncomeYear() / ytdMonths * 12)
planSteuer    = irpef(planEinkommen) + addizionale(planEinkommen) + vermögenssteuern(Bollo, IMU)
planRest      = planSteuer - (steuerSettings.vorauszahlung ?? 0)
```

*Neue HTML-IDs:* `st-kopf-ist-einkommen`, `st-kopf-ist-steuer`, `st-kopf-ist-monate`, `st-kopf-ist-offen`, `st-kopf-plan-total`, `st-kopf-plan-einkommen`, `st-kopf-plan-kapital`, `st-kopf-plan-immo`, `st-kopf-plan-rest`

Neue Funktion `incomeYearTagged()`:
```js
function incomeYearTagged() {
  let brutto = 0, ritenuteSum = 0;
  const now = new Date();
  const sKey = isoDate(new Date(now.getFullYear(), 0, 1));  // 1. Jan dieses Jahres
  allRows.forEach((r) => {
    if (!r.ist_einkommen || !r.buchungsdatum || r.buchungsdatum < sKey) return;
    const netto = Number(r.haben) || 0;
    const rit   = Number(r.ritenuta) || 0;
    brutto += r.betrag_brutto ? netto : netto + rit;
    ritenuteSum += rit;
  });
  return { brutto, ritenuteSum, hasData: brutto > 0 };
}
```

**Abhängigkeiten:** W1.1, W1.2, W1.3

**Risiko:** mittel — neue Funktion, neues HTML. Bestehende KPI-Kacheln darunter bleiben unverändert. Wenn keine Transaktionen getaggt, zeigt Ist-Seite Nullwerte + Hinweis-CTA.

**Akzeptanzkriterium:** Übersichtsseite zeigt Zweispalten-Kopfblock. Ohne getaggte Transaktionen: Ist = „–" mit Hinweis. Mit getaggter Transaktion: korrekte Ist-IRPEF. Plan-Seite zeigt Jahreshochrechnung.

---

### W1.5 — IRPEF Stufen-Grafik

**Datei:** `index.html`  
**Betroffene Bereiche:**
- HTML `page-steuer-einkommen` (~`index.html:469`): neues `<div id="ste-stufengrafik">` nach den KPI-Kacheln
- `renderSteuern()`: neue Funktion `renderIRPEFGrafik(einkommen)` aufrufen
- CSS: neue Klasse `.irpef-bar` (inline style oder neue CSS-Regel)

**Visualisierung** (wie im Konzept § 3.2):
```
Einkommen: 46.000 €
0 ──────── 28.000 ──────────── 46.000 ──── 50.000
[  23 %  ][       33 %         ][ Luft  ]
Grenzsteuersatz: 33 %   ·   Ø-Satz: 24,7 %
```

Implementierung als flexibler HTML-Div-Stack mit CSS `flex-grow` proportional zu den Beträgen je Stufe. Die Breiten ergeben sich relativ zum Maximum (50.000 € als Bezugsgröße für die ersten zwei Stufen, darüber separat).

**Neue HTML-IDs:** `ste-stufengrafik`, `ste-grenz-satz`, `ste-avg-satz`, `ste-luft-naechste`

**Abhängigkeiten:** W1.3 (addizionale in `renderSteuern()` verfügbar)

**Risiko:** niedrig — rein additiv, bestehende Tabelle `ste-body` bleibt erhalten

**Akzeptanzkriterium:** Auf `page-steuer-einkommen` erscheint ein farbiger Horizontalbalken. Grenzsteuersatz und Ø-Satz korrekt berechnet. Bei Einkommen 0: leerer/grauer Balken, kein JS-Fehler.

---

### W1.6 — Bollo-Depot-Kachel

**Datei:** `index.html`  
**Betroffene Bereiche:**
- HTML `page-steuer-kapital` (~`index.html:497`): neue Kachel + Zeile in `stk-body`
- HTML `page-steuer-uebersicht`: neue Kachel `st-bollo-depot` in KPI-Grid
- `renderSteuern()`: Berechnung + `setText`-Aufrufe

**Berechnung:**
```js
const latest = latestPortfolioMap(portfolioRows);  // bereits vorhanden
let totalDepotWert = 0;
Object.values(latest).forEach((r) => { totalDepotWert += Number(r.wert) * userShare(r.bank); });
const bolloDepot = totalDepotWert * 0.002;  // 0,20 % p.a.
```

**Neue HTML-IDs:** `st-bollo-depot`, `stk-bollo-depot-basis`, `stk-bollo-depot-betrag`

**Aufnahme in `st-total` (Gesamtsteuerlast):** `bolloDepot` zur `laufend`-Summe addieren.  
**Aufnahme in `renderStBreakdown()`:** als eigener Balken.

**Abhängigkeiten:** keine (nutzt bestehende `portfolioRows` + `latestPortfolioMap`)

**Risiko:** sehr niedrig — rein additiv, kein neues DB-Feld

**Akzeptanzkriterium:** `grep -n "bollo-depot" index.html` liefert Treffer. Mit Portfolio-Daten: Betrag = Depotwert × 0,002 (z. B. 100.000 € → 200 €). Mit leerem Portfolio: 0 €, keine JS-Fehler.

---

### W1.7 — Transaktions-UI: `ist_einkommen`-Flag

**Datei:** `index.html`  
**Betroffene Bereiche:**
- HTML Transaktions-Edit-Modal / Detailansicht (~`index.html:583`): neue Felder unterhalb von `f-kategorie`
- `openEditTx()` (~`index.html:1360`): neue Felder befüllen
- Payload-Aufbau beim Speichern (~`index.html:1388`): neue Felder einschließen
- `renderTxTable()` (~`index.html:1000`): optionaler Badge in der Beschreibungsspalte für `ist_einkommen = true`

**Neue Formular-Elemente:**
```html
<div id="f-einkommen-block">
  <label>Als Einkommen markieren</label>
  <select id="f-ist-einkommen">
    <option value="nein">Nein</option>
    <option value="ja">Ja – als Einkommen markieren</option>
  </select>
  <!-- nur wenn f-ist-einkommen = ja sichtbar: -->
  <div id="f-einkommen-detail" style="display:none">
    <select id="f-einkommensart">
      <option value="dipendente">Lavoro dipendente (Angestellt)</option>
      <option value="autonomo">Lavoro autonomo / Freiberuflich</option>
      <option value="sonstige">Sonstige Einnahme</option>
    </select>
    <label>Betrag brutto (vor Abzügen)?</label>
    <select id="f-betrag-brutto">
      <option value="nein">Nein – netto (nach Einbehalt)</option>
      <option value="ja">Ja – brutto</option>
    </select>
    <label>Bereits einbehaltene Steuer (Ritenuta, €)</label>
    <input type="text" inputmode="decimal" id="f-ritenuta" placeholder="0" />
  </div>
</div>
```

**Nur anzeigen wenn `haben > 0`:** Das Formular blendet `f-einkommen-block` aus, wenn `soll > 0` (Ausgabe, kein Einkommen).

**Abhängigkeiten:** W1.2 muss in der DB deployed sein.

**Risiko:** mittel — Änderung an häufig genutztem Modal. `openEditTx()` muss Felder korrekt zurücksetzen (wichtig: Formular öffnet nicht mit Resten vom letzten Edit). Bestehende Transaktionen haben `ist_einkommen = false` → Select zeigt „Nein" (korrekt).

**Akzeptanzkriterium:** Transaktion mit `haben > 0` öffnen: Einkommen-Felder sichtbar. Auf „Ja" stellen: Detailfelder erscheinen. Speichern: `ist_einkommen = true` in DB. Nächstes Öffnen: Felder korrekt vorausgefüllt. Transaktion mit `soll > 0`: Einkommen-Block nicht sichtbar.

---

## 5. Welle 2 — P2 (Kacheln-Erweiterung)

### W2.1 — Schema-Migration: `banks.im_ausland` + `immobilien.erstwohnsitz`

**Datei:** neues `supabase/migrations/YYYYMMDDHHMMSS_ausland_erstwohnsitz.sql`

**SQL:**
```sql
-- banks: Auslandsflag für IVAFE-Berechnung
alter table public.banks
  add column im_ausland boolean default false;

-- immobilien: Erstwohnsitz-Flag für IMU-Befreiung + IVIE-Berechnung
alter table public.immobilien
  add column erstwohnsitz boolean default false;
```

**RLS-Check:** Bestehende Policies für `banks` und `immobilien` greifen. Keine neuen Policies.

**Abhängigkeiten:** keine

**Risiko:** niedrig

**Akzeptanzkriterium:** `select im_ausland from banks limit 1` und `select erstwohnsitz from immobilien limit 1` liefern Zeilen.

---

### W2.2 — Bollo Konten

**Datei:** `index.html`  
**Betroffene Bereiche:**
- HTML `page-steuer-uebersicht`: neue Kachel `st-bollo-konten`
- Neue Unterseite oder Panel auf Übersicht mit Tabelle je Bank
- `renderSteuern()`: Berechnung

**Berechnung (Proxy: aktueller Saldo statt Ø-Saldo):**
```js
let bolloKonten = 0;
banks.forEach((b) => {
  if (!bankSelected(b.name)) return;
  const start = Number(b.saldo_start) || 0;
  const txSum = allRows.filter((r) => (r.bank||"") === b.name)
    .reduce((s, r) => s + (Number(r.soll)||0) + (Number(r.haben)||0), 0);
  const saldo = start + txSum;
  if (saldo > 5000) bolloKonten += 34.20;
});
```
Hinweis im UI: „Schätzung anhand aktuellem Saldo (nicht Jahresdurchschnitt)."

**Abhängigkeiten:** keine

**Risiko:** niedrig — additiv. Saldo-Berechnung ist bereits in `wealthSeries()` ähnlich vorhanden.

**Akzeptanzkriterium:** Mit 2 Konten > 5.000 €: `st-bollo-konten` = 68,40 €. Mit 0 Konten > 5.000 €: 0 €.

---

### W2.3 — Cedolare-secca-Kachel (eigenständig) + 10 %-Variante

**Datei:** `index.html`  
**Betroffene Bereiche:**
- HTML `page-steuer-uebersicht`: separate Kachel `st-cedolare` neben `st-miete`
- `renderSteuern()`: `rentTax` aufteilen in Cedolare-Anteil vs. IRPEF-Anteil
- `page-steuer-miete`: Spalte „Mietart" ergänzen (regulär 21 %, concordato 10 %)

**Für 10 %-Variante:** `immobilien.steuermodell` erhält neuen Wert `'cedolare_concordato'`.  
Bisherige `'cedolare'` = 21 %, `'cedolare_concordato'` = 10 %.  
**Kein Schema-Change nötig** (TEXT-Feld, bestehende Werte bleiben gültig). UI in Immobilien-Karte: zusätzliche Option im Steuermodell-Select.

**Abhängigkeiten:** W2.1 (erstwohnsitz-Flag nutzen um IMU vs. Cedolare korrekt zu trennen)

**Risiko:** niedrig — `steuermodell`-Feld ist bereits vorhanden und flexibel.

**Akzeptanzkriterium:** Immobilie mit `steuermodell = 'cedolare_concordato'` und 10.000 € Jahresmiete → Cedolare-Kachel zeigt 1.000 €.

---

### W2.4 — Pensionsfonds-Ertragsbesteuerung

**Datei:** `index.html`  
**Betroffene Bereiche:**
- `renderSteuern()`: neue Variable `pensTax`
- HTML: neue Kachel `st-pens-ertrag` auf Übersicht
- `page-steuer-absetzbar` oder neue Unterseite: Ertragsbesteuerung erklären

**Berechnung:**
```js
let pensTax = 0;
pensRows.forEach((d) => {
  const wert = pensCurrentWert(d.id);
  const rendite = (Number(d.rendite) || 0) / 100;
  pensTax += wert * rendite * 0.20;  // 20 % auf laufende Erträge
});
```
Hinweis: Auszahlungsbesteuerung (15 %→9 %) wird als informativer Text dargestellt, nicht berechnet (keine Laufzeitdaten vorhanden).

**Abhängigkeiten:** keine (nutzt vorhandene `pensRows` + `pensCurrentWert`)

**Risiko:** sehr niedrig — additiv, kein DB-Change

**Akzeptanzkriterium:** Pensionsfonds mit 50.000 € Wert, 5 % Rendite → `st-pens-ertrag` = 500 €.

---

### W2.5 — IVAFE / IVIE

**Datei:** `index.html`  
**Betroffene Bereiche:**
- `renderSteuern()`: neue Variablen `ivafe`, `ivie`
- HTML: neue Kacheln `st-ivafe`, `st-ivie` (nur wenn Wert > 0, sonst ausgeblendet)
- Bank-Formular: Checkbox `im_ausland`
- Immobilien-Karte: Checkbox `erstwohnsitz`

**Berechnungen:**
```js
// IVAFE: Depot-Ausland 0,20 %, Konto-Ausland 34,20 € fix
let ivafe = 0;
banks.forEach((b) => {
  if (!b.im_ausland || !bankSelected(b.name)) return;
  // Portfolio der Auslandsbank
  const map = latestPortfolioMap(portfolioRows, (bank) => bank === b.name);
  let wert = 0; Object.values(map).forEach((r) => { wert += Number(r.wert) * userShare(r.bank); });
  ivafe += wert * 0.002;
  // Konto-Anteil (Saldo)
  const start = Number(b.saldo_start) || 0;
  // txSum analog W2.2
  const saldo = start + txSum;
  if (saldo > 0) ivafe += 34.20;
});

// IVIE: Auslandsimmobilien 1,06 %
let ivie = 0;
immoRows.forEach((d) => {
  if (!d.im_ausland || d.erstwohnsitz) return;
  ivie += (Number(d.marktwert) || 0) * ((Number(d.anteil_user)||100)/100) * 0.0106;
});
```

**Abhängigkeiten:** W2.1 (Schema), Bank-Form-Erweiterung, Immo-Form-Erweiterung

**Risiko:** mittel — Form-Erweiterungen an Bank + Immobilien, aber alle neuen Felder haben `default false` → kein Effekt für Bestandsdaten

**Akzeptanzkriterium:** Bank ohne `im_ausland`: IVAFE = 0. Bank mit `im_ausland = true` und 50.000 € Portfolio: IVAFE = 100 €. Immo mit `im_ausland = true`, `erstwohnsitz = false`, Marktwert 200.000 €: IVIE = 2.120 €.

---

## 6. Abhängigkeiten und Reihenfolge

```
W1.1 (steuer_einstellungen-Migration) ─┐
                                        ├─→ W1.3 (Formular) ─→ W1.4 (Ist/Plan-Kopf)
W1.2 (transactions-Migration) ─────────┘                          │
                                                                   └─→ W1.7 (Tx-UI)
W1.5 (Stufen-Grafik) ─────────────── nach W1.3
W1.6 (Bollo Depot)   ─────────────── unabhängig, jederzeit

W2.1 (banks/immo-Migration) ─→ W2.5 (IVAFE/IVIE)
W2.2 (Bollo Konten)   ─── unabhängig
W2.3 (Cedolare)       ─── nach W2.1 wegen erstwohnsitz
W2.4 (Pens-Ertrag)    ─── unabhängig
```

**Deployments:** W1.1 und W1.2 müssen in Supabase applied sein, bevor der JS-Code die neuen Felder liest (sonst gibt Supabase keine Fehlermeldung, aber neue Felder sind `undefined`).

---

## 7. Offene fachliche Fragen an Ivan

**F1 — Einkommens-Markierung: manuell oder per Kategorie?**  
Das Konzept sagt „per Einkommens-Transaktion eine kleine Zusatzinfo". Technisch gibt es zwei Wege:
- **(a) Manuell je Transaktion** (Plan W1.7): Nutzer öffnet jede Einnahme-Buchung und setzt `ist_einkommen = true`. Präzise, aber Aufwand bei vielen Buchungen.
- **(b) Automatisch per Kategorie-Mapping**: Eine Tabelle legt fest: Kategorie „Gehalt" → automatisch `ist_einkommen = true, einkommensart = 'dipendente'`. Einmalig konfigurieren, dann läuft's.

Empfehlung: (a) als Einstieg, (b) als spätere Ausbaustufe. Aber es ist Ivans Entscheidung, ob das Kategorie-Mapping die bessere UX wäre.

**F2 — Netto vs. Brutto bei dipendente: Wie kommt der Bruttobetrag ins Tool?**  
Das Gehalt landet als Netto-Eingang auf dem Konto. Für präzise IRPEF-Berechnung braucht das Tool das Brutto. Drei Möglichkeiten:
- **(a) Ritenuta manuell eingeben** (Feld `ritenuta`): Nutzer schaut auf Busta Paga, tippt den Einbehalt ein.
- **(b) Bruttobetrag manuell eingeben**: Feld `betrag_brutto = true` + Nutzer gibt den Bruttobetrag als Betrag ein (statt dem echten Konto-Eingang).
- **(c) Annäherung**: `ritenuta` ignorieren, nur Netto × `1 / (1 - grenzsteuersatz/100)` hochrechnen (ungenau, aber einfach).

Präziseste Lösung: (a). Welcher Aufwand ist für Ivan OK?

**F3 — Addizionale: Welcher Wohnsitz genau?**  
`addizionale_regionale` variiert je Region (z. B. Lombardei 1,23 %, Kalabrien 3,33 %). Das Tool setzt 1,23 % als Default. Soll dieser Wert einmalig in Einstellungen gepflegt werden (aktueller Plan) oder pro Jahr historisiert werden (Aufwand > Nutzen)?

**F4 — IMU: Katasterwert-Berechnung vs. manueller Jahresbetrag?**  
Aktuell: `imu_jahr` (manuell eingetragener Jahresbetrag). Konzept § 3.3 nennt „Katasterwert × Gemeinde-Satz". Soll W2.3 die Auto-Berechnung aus Katasterwert einführen (braucht 2 neue Felder + Eingabefelder in der Immobilien-Karte), oder bleibt der manuelle Jahresbetrag die Eingabe und die Kachel stellt nur dar?

**F5 — Cedolare 26 % (ab 2. Kurzzeitvermietung): relevant?**  
Das Konzept erwähnt 26 % für „ab 2. Kurzzeit-Wohnung". Ist das für Ivan relevant (hat er mehrere Airbnb-Objekte)? Falls ja, braucht `mietart` ein neues `'kurzzeitvermietung'`-Feld mit Zähler.

**F6 — Mieteinnahmen-Transaktionen: Doppelerfassung?**  
Mieteinnahmen sind in `transactions` mit `immo_id` gelinkt. Wenn ein Nutzer eine Mietzahlung zusätzlich als `ist_einkommen = true, einkommensart = 'affitto'` markiert, wird sie doppelt (in IRPEF-Ist + in Cedolare-Secca) erfasst. Lösungsoptionen:
- (a) `einkommensart = 'affitto'` als Option explizit **ausschließen** (Mieteinnahmen laufen nur via `immo_id`)
- (b) Hinweis im UI: „Transaktionen mit Immobilien-Zuordnung hier nicht markieren"

Empfehlung: (a), aber Entscheidung an Ivan.

**F7 — Portfolio-Ausschüttungen vs. latente Steuer: realisierte Gewinne erfassen?**  
Das Konzept nennt als Kapitalertrag-Kachel „realisierte Gewinne / Ausschüttungen". Derzeit hat das Tool nur Snapshot-basierte Portfolio-Stände (kein Verkauf-/Ausschüttungs-Event). Sollen realisierte Gewinne über Transaktionen erfasst werden (z. B. Kategorie „Wertpapierverkauf" → `ist_einkommen = true, einkommensart = 'kapital'`), oder bleibt es bei der latenten-Steuer-Darstellung + Bollo Depot als Kapitalertrag-Kachel-Inhalt?
