# ANALYSE.md – Finanztool v2

Codebasis-Analyse von `index.html` (3628 Zeilen) und `supabase/schema.sql`.
Stand: 2026-06-21.

---

## 1. Architekturüberblick

### State-Management
Kein Framework, kein reaktives System. Globale `let`-Variablen halten den gesamten App-State:

| Variable | Inhalt |
|---|---|
| `allRows` | Alle Transaktionen des Nutzers |
| `portfolioRows` | Alle ETF-Positionsstände |
| `banks` | Bankliste |
| `immoRows` / `immoSchuld` | Immobilien + Schuldenverlauf |
| `betRows` | Beteiligungen |
| `pensRows` / `pensStand` | Pensionsfonds + Wertstände |
| `steuerSettings` | Steuereinstellungen |
| `activeTxBank` / `activePfBank` / `activeImmo` | Welches Sub-Menü-Element aktiv ist |
| `dashBankFilter` | Banken-Checkbox-Filter im Dashboard |

State-Änderungen werden durch manuelles Aufrufen von `render*()`-Funktionen propagiert. Es gibt keine automatische Reaktivität.

### Datenfluss: Login → Anzeige

```
onAuthStateChange (session)
  └─ loadData()       → allRows = ...        → render()
  └─ loadPortfolio()  → portfolioRows = ...  → renderPortfolio()
  └─ loadBanks()      → banks = ...          → renderBanks(), renderDashboard()
  └─ loadImmo()       → immoRows = ...       → renderImmo(), renderDashboard()
  └─ loadBet()        → betRows = ...        → renderBet(), renderDashboard()
  └─ loadPens()       → pensRows = ...       → renderPens(), renderDashboard()
  └─ loadSteuer()     → steuerSettings = ... → renderSteuern()
```

**Kritisches Problem**: Die 6 `load*()`-Funktionen werden sequenziell als `async`-Calls gestartet, warten aber nicht aufeinander. `renderDashboard()` wird nach jedem Load erneut aufgerufen (6×), aber beim ersten Aufruf (aus `loadData()`) sind `immoRows`, `betRows`, `pensRows` noch leer. Daher schützen sich alle Dashboard-Berechnungen mit `typeof immoRows !== "undefined"` Guards (Zeilen 2116, 2118, 2120, 2201–2203) – die eigentlich unnötig wären, wenn die Lade-Koordination stimmen würde.

### Navigation

- **Rail** (links, 4 Einträge): `finanzen`, `steuern`, `versicherung`, `simulator`
- `switchSection(section)` wechselt Sektion, zeigt erste Seite der neuen Sektion
- `showPage(pageId, title)`: blendet alle `<section id="page-*">`-Elemente aus außer dem aktiven
- **Unter-Menüs** (Transaktionen → Banken, Portfolio → Banken, Immobilien → Objekte) werden dynamisch nach Datenladen aufgebaut durch `renderTxSubmenu()`, `renderPfSubmenu()`, `renderImmoSubmenu()`
- Aktiver Zustand der Unter-Menüs liegt in `activeTxBank`, `activePfBank`, `activeImmo` (je `null` = Übersicht)

---

## 2. Datenmodell

### Tabellenbeziehungen

```
transactions ──── immo_id ────────────> immobilien
transactions ──── umbuchung_partner ──> transactions (self-ref)
immo_schuld  ──── immo_id ────────────> immobilien (ON DELETE CASCADE)
banks        ──── eigentuemer (JSONB) ─ kein FK, Freitext-Namen
portfolio    ──── bank (TEXT) ─────────  kein FK zu banks
transactions ──── bank (TEXT) ─────────  kein FK zu banks
pensionsfonds ─── (pension_stand.pension_id → pensionsfonds.id, im JS genutzt)
```

### Inkonsistenzen Schema ↔ JS-Code

**1. `pension_stand`-Tabelle fehlt in `schema.sql`** (schwerwiegend)
Der JS-Code greift aktiv auf diese Tabelle zu: `sb.from("pension_stand")` an Zeilen 3204, 3356, 3363. Sie existiert weder in `schema.sql` noch in der Migration `20260621174420_remote_schema.sql`. RLS-Policies fehlen ebenfalls. Entweder wurde die Tabelle manuell in der Supabase-Konsole erstellt (und fehlt in der Schemadokumentation) oder die Funktion ist derzeit broken.

**2. `bank` ist TEXT, kein FK** (in `transactions` und `portfolio`)
Der Bankname wird als String gespeichert. Wird eine Bank in der `banks`-Tabelle umbenannt, werden alle zugehörigen Transaktionen und Portfolio-Einträge zu Waisen – der Zusammenhang geht verloren. Die App löst das per String-Matching bei `renderBanks()` (Zeile 1897) und `renderDashboard()` (Zeile 2101).

**3. Denormalisierung `immobilien.restschuld` ↔ `immo_schuld`**
`immobilien.restschuld` wird als aktueller Wert sowohl direkt bearbeitet (Eingabefeld im Formular) als auch automatisch auf den letzten `immo_schuld`-Eintrag gesetzt (Zeile 2977). Wird ein Schuldstand-Eintrag nachträglich **gelöscht**, wird `immobilien.restschuld` nicht zurückgesetzt. Diese Inkonsistenz wächst mit der Zeit.

**4. `beteiligungen.quote` ungenutzt in Berechnungen**
Das Feld `quote` (Beteiligungsquote %) steht in der DB und im Formular, fließt aber in `betKPIs()` (Zeile 3011) nicht in irgendeine Berechnung ein. Es ist reines Anzeigefeld.

**5. `transactions.umbuchung` bleibt `true` wenn `umbuchung_partner` auf NULL gesetzt wird**
Der FK `umbuchung_partner uuid REFERENCES transactions(id) ON DELETE SET NULL` setzt bei Löschung des Partners `umbuchung_partner = NULL`, lässt aber das `umbuchung`-Flag auf `true`. Diese halbfertigen Umbuchungen werden von `renderGaps()` als Warnung angezeigt, aber nicht automatisch bereinigt.

**6. `steuer_einstellungen` hat UNIQUE auf `user_id`**
Das ist sinnvoll, aber der JS-Code (Zeile 3416) lädt mit `.limit(1)` und prüft nicht, ob mehr als ein Eintrag existiert. Bei einer Migration oder Fehler könnten Duplikate entstehen, die dann stumm ignoriert werden.

---

## 3. Berechnungslogik

### Wo die Berechnungen sitzen

| Funktion | Zeile | Inhalt |
|---|---|---|
| `immoKPIs(d)` | 2742 | Immobilien-KPIs: EK, LTV, Mietrendite, ROE, Cashflow |
| `betKPIs(d)` | 3011 | Beteiligungs-KPIs: Zinsen, Dividende, Jahresertrag |
| `pensKPIs(d, wert)` | 3180 | Pensionsfonds-Prognose (Zinseszins) |
| `irpef(income)` | 3393 | IRPEF-Stufenberechnung 2026 |
| `userShare(bankName)` | 2061 | Nutzereigentumsanteil je Bank |
| `currentPassiveIncome()` | 2370 | Passives Einkommen / Monat |
| `workIncomeYear()` | 3401 | Aktives Einkommen der letzten 12 Monate |

### Duplikate

**1. „Neuester Portfoliostand je Position" – 5 Implementierungen**

Das Muster `latest[bank|bezeichnung]` wird identisch an diesen Stellen gebaut:
- `renderDashboard()` Zeilen 2105–2112
- `renderSteuern()` Zeilen 3452–3457
- `renderBanks()` Zeilen 1904–1912
- `renderPortfolio()` Zeilen 1466–1471
- `wealthSeries()` Zeilen 2393–2401

Keine dieser fünf Kopien ist eine gemeinsame Funktion.

**2. ETF-Buchgewinn – 3 Implementierungen**

- `renderDashboard()` Zeilen 2167–2171
- `renderSteuern()` Zeilen 3451–3461 (inklusive eigenem Latest-Map-Rebuild)
- `wealthSeries()` Zeile 2412: `gain = val - inv`

**3. „Letzte 12 Monate aktives Einkommen" – 2 Implementierungen**

`workIncomeYear()` (Zeile 3401) und der identische Block innerhalb `renderIncomeOverview()` (Zeilen 2347–2357) berechnen dasselbe mit identischer `sKey`/`cmKey`-Logik. `renderIncomeOverview()` hätte `workIncomeYear()` aufrufen sollen.

**4. ISO-Datumsformatierung inline – 5+ Stellen**

```js
`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
```
Erscheint an Zeilen 1822–1824, 1848–1850, 2668–2671, 2951–2952, 3335–3336. Kein gemeinsames `isoDate(d)`-Helper.

**5. 26%-Kapitalertragsteuersatz – 6+ Hardcodes**

Die Magic Number `0.26` (bzw. `0.74`) erscheint an:
- `betKPIs()` Zeilen 3014–3015
- `renderDashboard()` Zeile 2171
- `renderSteuern()` Zeile 3461
- `wealthSeries()` Zeile 2418
- Finanzielle Freiheit Zeile 2199
- `renderDashboard()` Zeile 2202

Kein benanntes Konstante `KAPITALERTRAGSTEUER = 0.26`.

### Fehlerquellen

**6. `d.miete_brutto`-Check ist toter Zweig** (Zeile 2752)
`immoKPIs()` prüft `d.miete_brutto !== false`, aber `miete_brutto` ist kein Feld in der DB (`schema.sql`) und wird nirgendwo in `readImmoCard()` gelesen. Der Wert ist immer `undefined`, also immer `true`. Die Fallunterscheidung (Miete netto oder brutto) ist damit nie aktiv.

**7. `renderImmoTx()` ignoriert den globalen Datumsfilter** (Zeile 2718)
```js
const rows = allRows.filter((r) => r.immo_id === activeImmo);
```
Alle anderen Bereiche wenden `inRange()` an. Das Panel "Zugeordnete Transaktionen" zeigt immer alle Zeiten, unabhängig vom gewählten Zeitraum.

**8. `netWorthSeries()` ist dead code** (Zeilen 2276–2307)
Die Funktion wird nirgendwo aufgerufen. Die Dashboard-Vermögensentwicklung nutzt `wealthSeries()` + `drawWealthChart()`. `drawAreaChart()` (Zeile 2482) verwendet `{m, v}`-Punkte, `wealthSeries()` liefert `{m, cash, invested, gain, value, freiheit}` – eine gemeinsame Schnittstelle fehlt.

---

## 4. Code-Qualität & technische Schulden

### Wiederholter Code (über das unter §3 Genannte hinaus)

**`readImmoCard()`**, **`readBetCard()`**, **`readPensCard()`** (Zeilen 2878, 3086, 3283): Alle drei lesen Formulardaten aus `.immo-card`-Elementen mit dem gleichen `g(f)` Helper-Muster. Identische Struktur, nicht abstrahiert.

**Event-Handler-Muster**: `immoListEl`, `betListEl`, `pensListEl` haben je drei identisch strukturierte Listener (`input`, `change`, `click`) mit demselben `card = e.target.closest(".immo-card")` Einstieg. Zeilen 2958–2960, 3132–3134, 3340–3342.

**Drei gleichartige `recompute*Card()`-Funktionen**: `recomputeImmoCard()`, `recomputeBetCard()`, `recomputePensCard()` haben identische Struktur (read → compute KPIs → set DOM-Elemente).

### Fehlende Fehlerbehandlung

| Stelle | Problem |
|---|---|
| `loadPens()` Zeile 3208 | `pensStand`-Fehler wird stumm zu `[]`, kein User-Feedback |
| `loadData()` Zeile 969 | `console.error` nur, kein UI-Hinweis |
| `loadPortfolio()` Zeile 1411 | wie oben |
| Alle `delete`-Klick-Handler | `confirm()` gibt kein Feedback bei Netzwerkfehler außer `alert()` |
| Speicher-Buttons (Immo/Bet/Pens) | Kein Deaktivieren während des async Requests – Doppelklick führt zu Doppel-Insert |
| CSV-Import | Kein Prüfen auf Duplikate; wiederholter Import erzeugt Duplikat-Zeilen |

### Unklare Stellen

**`typeof`-Guards als Symptom**: `if (typeof immoRows !== "undefined")` (Zeilen 2116, 2118, 2120) — `immoRows` ist immer definiert (`let immoRows = []`), aber beim ersten `renderDashboard()`-Aufruf nach `loadData()` noch leer. Das Guard zeigt, dass die Lade-Koordination fehlt, nicht dass die Variable undefiniert sein könnte.

**`currentUserName` als Eigentümer-Matching-Schlüssel** (Zeile 2066): `userShare()` matcht per `currentUserName.toLowerCase()` gegen `eigentuemer[].name`. `currentUserName` wird auf `session.user.email` gesetzt (Zeile 944). Wenn ein Eigentümer-Eintrag mit dem echten Namen statt der E-Mail angelegt wurde, schlägt der Match fehl, und der Nutzer-Anteil wird fälschlich als 100% gewertet.

**`renderDashboard()` ist ein ~160-Zeilen-Monolith** (Zeilen 2094–2250): Berechnet sequenziell liquide Mittel, Portfolio, Immobilien-EK, Beteiligungen, Pensionsfonds, Nettovermögen, Cashflow, latente Steuer, finanzielle Freiheit und triggert dann 7 Chart-/Render-Funktionen. Schwer testbar und zu pflegen.

---

## 5. UI/Design-Konsistenz

### CSS-Variablen: weitgehend konsistent, aber Lücken

CSS-Variablen (`var(--green)`, `var(--red)`, `var(--accent)` usw.) werden im Großen und Ganzen genutzt, aber an mehreren Stellen im JS werden Hex-Werte direkt gesetzt:

| Zeile | Code | Problem |
|---|---|---|
| 2137 | `style.color = "#2E7D32"` | sollte `var(--green)` sein |
| 2137 | `style.color = "#C62828"` | sollte `var(--red)` sein |
| 2220 | `style.color = "var(--text)"` | korrekt |
| 2450–2451 | SVG `fill="#C62828"`, `fill="#E0A800"` | SVG kann keine CSS-Vars direkt, aber Farb-Constants wären besser |

Die SVG-Charts verwenden grundsätzlich hardcodierte Hex-Werte (`#2F5DA8`, `#2E7D32`, `#C62828`), was nachvollziehbar ist (SVG-Kontext), aber eine zentrale JS-Konstanten-Liste (`COLORS.accent`, etc.) würde Konsistenz sichern.

### Semantik-Verwirrung: `.immo-card` für alle Karten

`betCardHTML()` (Zeile 3073) und `pensCardHTML()` (Zeile 3270) verwenden beide `class="immo-card"`. Funktioniert, aber zukünftige CSS-Änderungen an `.immo-card` würden alle drei Bereiche treffen.

### `.donut-legend` mit Inline-Style-Override

An mehreren Stellen wird `.donut-legend` mit inline `style="flex-direction:row;gap:16px;..."` überschrieben (Zeilen 2458, 2622, 2645). Die CSS-Klasse definiert `flex-direction: column; gap: 8px`. Das Überschreiben per Inline ist ein Stilbruch.

### Kein Button-Feedback bei async Operationen

Nur der Login-Button (Zeile 929) wird während des Requests deaktiviert. Alle anderen Speichern/Löschen-Buttons (Transaktionen, Portfolio, Immobilien, Beteiligungen, Pensionsfonds) bleiben aktiv. Das führt bei langsamem Netz zu möglichen Mehrfach-Submits.

### Fehlende `for`-Attribute bei `<label>`

In `immoFieldsHTML()`, `betFieldsHTML()`, `pensFieldsHTML()` sind `<label>`-Elemente ohne `for`-Attribut direkt vor Inputs platziert. Sie sind nicht programmatisch verknüpft (kein `id` auf dem Input). Accessibility-Problem – Screen-Reader-Nutzer können Labels nicht mit Inputs assoziieren.

---

## 6. Sicherheit

### RLS-Abdeckung

| Tabelle | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `transactions` | ✅ | ✅ | ✅ | ✅ |
| `banks` | ✅ | ✅ | ✅ | ✅ |
| `portfolio` | ✅ | ✅ | ✅ | ✅ |
| `immobilien` | ✅ | ✅ | ✅ | ✅ |
| `immo_schuld` | ✅ | ✅ | ✅ | ✅ |
| `beteiligungen` | ✅ | ✅ | ✅ | ✅ |
| `pensionsfonds` | ✅ | ✅ | ✅ | ✅ |
| `steuer_einstellungen` | ✅ | ✅ | ✅ | ✅ |
| `pension_stand` | ❌ **fehlt in Schema** | ❌ | ❌ | ❌ |

**`pension_stand` hat keine RLS** (da nicht im Schema). Wenn die Tabelle ohne RLS existiert, können alle authentifizierten Nutzer gegenseitig Pensionsfonds-Stände lesen und schreiben.

### JS-seitige Validierung

**CSV-Import**: CSV-Werte werden per PapaParse geparst und direkt in Supabase eingefügt. SQL-Injection ist kein Risiko (Supabase nutzt parametrisierte Queries). XSS ist kein Risiko, da alle Ausgaben per `esc()` gesichert werden. Jedoch:
- Kein Längenlimit auf `beschreibung`, `kategorie`
- Kein Prüfen ob `bank` aus importierter CSV mit einer bekannten Bank übereinstimmt
- Kein Duplikatcheck – doppelter Import erzeugt doppelte Zeilen ohne Warnung

**Doppelklick auf Speichern** kann mehrere Insert-Requests parallel auslösen (kein Request-Deduplication). Betrifft alle Formulare außer Login.

**`confirm()` für Löschen**: Native `confirm()`-Dialoge sind ausreichend für ein Ein-Nutzer-Tool, aber nicht barrierefreiheit-konform.

**Supabase Publishable Key** ist korrekt eingesetzt – RLS macht ihn sicher im Browser.

---

## 7. Skalierungsgrenzen

### O(n×m)-Komplexität in Chart-Berechnungen

`wealthSeries()` (Zeilen 2403–2422) iteriert für jeden Monat `M` über **alle Transaktionen** (`allRows.forEach(...)`), um den kumulativen Kontostand zu berechnen:

```js
months.map((M) => {
  banks.forEach((b) => {
    const txSum = allRows.filter((r) => r.buchungsdatum <= M).reduce(...)
    // ↑ O(n) pro Monat pro Bank
  });
});
```

Bei 5 Jahren Daten: ~60 Monate × ~3600 Transaktionen (3 Konten × 100 Buchungen/Monat) = **~216.000 Iterationen pro Render**. Bei 10 Jahren: ~860.000.

`netWorthSeries()` (dead code, Zeile 2300) hat dasselbe Muster.

### Alle Daten ohne LIMIT geladen

`loadData()` (Zeile 965):
```js
sb.from("transactions").select("*").order("buchungsdatum", { ascending: false })
```
Kein LIMIT, keine Pagination. Bei Tausenden Transaktionen wird das initiale Laden und der Browser-Memory-Verbrauch zum Problem.

### DOM-Performance bei großen Transaktionslisten

`render()` (Zeile 985) setzt `tbody.innerHTML = ""` und fügt dann per `appendChild()` jede Zeile einzeln ein. Bei 2000 sichtbaren Zeilen ist das eine spürbare Render-Verzögerung. Keine virtualisierte Liste, kein `requestAnimationFrame`.

### Synchrone Berechnungen im Main Thread

Alle Dashboard-Berechnungen, Chart-Rendering und Aggregationen laufen synchron. `renderDashboard()` kann bei großen Datenmengen kurz die UI einfrieren. Kein Web Worker.

### Keine Pagination in der Transaktionsliste

Die Sucheingabe filtert clientseitig, zeigt aber immer alle Ergebnisse. Bei 5000 Transaktionen im DOM ist die Seite schwer scrollbar.

### `loadBanks()` löst `renderDashboard()` aus

```
loadBanks() → renderBanks() → ... → renderDashboard()
```
Bei jedem Bank-CRUD wird das gesamte Dashboard neu berechnet, obwohl sich Transaktions- und Portfolio-Daten nicht geändert haben.

---

## 8. Verbesserungspotenzial nach Bereich

### A — Sofort umsetzbar (keine Abhängigkeiten)

1. **Konstante für Steuersatz** (`const KEST = 0.26`): Alle 6+ Stellen ersetzen. Zeilen 3014, 3015, 2171, 3461, 2418, 2199.

2. **`pension_stand` in `schema.sql` und Migration eintragen** mit vollständigen RLS-Policies (analog zu anderen Tabellen: `pension_id`-basiert, nicht `user_id`-basiert — FK zu `pensionsfonds`).

3. **`netWorthSeries()` löschen** (Zeilen 2276–2307): Dead Code, wird nie aufgerufen.

4. **`d.miete_brutto`-Zweig entfernen** (Zeile 2752): `miete_brutto` ist kein DB-Feld, der Zweig ist nie aktiv.

5. **`isoDate(d)` Hilfsfunktion** extrahieren (gibt ISO-String `"YYYY-MM-DD"` zurück), alle 5+ Inline-Formatierungen ersetzen.

6. **Inkonsistente Inline-Farben** auf CSS-Variablen umstellen (Zeile 2137: `"#2E7D32"` → `var(--green)`, `"#C62828"` → `var(--red)`).

7. **Dokumentation**: `schema.sql` um Kommentare ergänzen, die `pension_stand` und die impliziten Text-FK-Beziehungen erklären.

### B — Mittelfristig (bauen auf A auf)

8. **`latestPortfolioMap()` als gemeinsame Funktion** extrahieren: Die 5 identischen Implementierungen (§3) durch einen einzigen Aufruf ersetzen. Gibt `Map<"bank|bezeichnung", row>` zurück.

9. **`workIncomeYear()` in `renderIncomeOverview()` nutzen** statt des doppelten Blocks.

10. **Lade-Koordination mit `Promise.all`**:
    ```js
    await Promise.all([loadData(), loadPortfolio(), loadBanks(), loadImmo(), loadBet(), loadPens(), loadSteuer()]);
    renderDashboard();
    ```
    Eliminiert alle `typeof`-Guards und das sechsfache Neuberechnen des Dashboards.

11. **Button-Disable-Pattern** für alle Formulare (während async Request deaktivieren), nicht nur Login. Verhindert Doppel-Inserts.

12. **`renderImmoTx()` Datumsfilter** anwenden (Zeile 2718) — konsistent mit allen anderen Bereichen.

13. **`restschuld`-Sync beim Löschen eines Schuld-Stands**: Nach `immo_schuld`-Delete den letzten verbleibenden Stand automatisch auf `immobilien.restschuld` zurückschreiben (oder `immobilien.restschuld` ganz aus der Berechnungslogik entfernen und immer aus `immo_schuld` lesen).

### C — Größere Refactorings (bauen auf B auf)

14. **`renderDashboard()` aufteilen**: In separate, testbare Funktionen: `computeLiquid()`, `computePortfolioKPIs()`, `computeNetworth()`, `computeFinanzielleFreiheit()`, `renderDashKPIs()`, etc. Hängt von #10 ab (dann einmaliger Aufruf).

15. **Inkrementelle `wealthSeries()`-Berechnung**: Kontostand-Kumulation nicht per `allRows.filter().reduce()` je Monat, sondern eine einmalige chronologische Aggregation von Transaktionen in eine `Map<monat, delta>` vorab, dann kumulieren. Reduziert O(n×m) auf O(n + m).

16. **Virtuelle Transaktionsliste oder serverseitige Pagination**: `loadData()` auf die letzten 12 Monate beschränken, ältere Daten nur auf Anfrage laden. Benötigt angepasste Chart-Serien-Abfragen.

17. **`bank` als FK in `transactions` und `portfolio`**: Langfristig sollte `bank` eine UUID-Referenz auf `banks.id` sein, um Daten-Integrität bei Umbenennungen zu gewährleisten. Benötigt Datenmigration aller bestehender Datensätze.

### Abhängigkeitsgraph

```
A (1–7) ──────────────────────────────────────┐
          ↓                                    │
B (8–13) ─── bauen auf A auf ─────────────────┤
          ↓                                    │
C (14–17) ─── bauen auf B auf ──────────────── kein Blocker für A/B
```

Punkte A können sofort und unabhängig voneinander umgesetzt werden. Punkt B.10 (Promise.all) ist Voraussetzung für B.8 (Shared LatestMap) und C.14 (Dashboard-Aufspaltung) zu vereinfachen. C.16 (Pagination) und C.17 (FK-Migration) sind eigenständig, aber riskant ohne vollständige Testabdeckung.
