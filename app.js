// ======================================================================
//  Supabase-Client
// ======================================================================
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const loginView = document.getElementById("login-view");
const appView   = document.getElementById("app-view");
let allRows = [];        // Transaktionen (immer vollständig — niemals beschneiden)
let portfolioRows = [];  // Portfolio-Stände
let activeTxBank = null;  // null = Übersicht (alle Banken), sonst Bankname
let txKKFilter = "alle";  // alle | konto | kk
let activePfBank = null;  // ETF & Aktien: null = Übersicht, sonst Bankname
let txListLimit = 12;    // Monate für Listenanzeige; null = alles zeigen

// ---------- Hilfsfunktionen ----------
const KEST = 0.26;          // Kapitalertragsteuer IT (26 %)
const KEST_FAKTOR = 1 - KEST; // = 0.74, für Netto-Berechnungen
const isoDate  = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const isoMonth = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
const euro = (n) => (n == null ? "" : Number(n).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €");
// Zahl deutsch formatieren (für Eingabefelder), z. B. 41695.63 -> "41.695,63"
const fmtNum = (n, dec = 2) => (n == null || n === "" ? "" : Number(n).toLocaleString("de-DE", { minimumFractionDigits: 0, maximumFractionDigits: dec }));
// Deutsch eingetippte Zahl einlesen, z. B. "41.695,63" oder "41695,63" -> 41695.63
function numDE(v) {
  if (v == null) return null;
  v = String(v).trim();
  if (v === "") return null;
  const s = v.replace(/[€\s]/g, "").replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}
function showMsg(el, text, type) { el.innerHTML = text ? `<div class="msg ${type}">${text}</div>` : ""; }

// "19.06.26" -> "2026-06-19" ; akzeptiert auch ISO-Datum
function parseDate(v) {
  if (!v) return null;
  v = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const m = v.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (!m) return null;
  let [, d, mo, y] = m;
  if (y.length === 2) y = "20" + y;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}
// "-64,63 € " -> -64.63 ; "1.234,56" -> 1234.56 ; "0" -> 0
function parseAmount(v) {
  if (v == null || v === "") return null;
  let s = String(v).replace(/[€\s ]/g, "").replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

// ======================================================================
//  Auth
// ======================================================================
document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("login-btn");
  btn.disabled = true; btn.textContent = "Anmelden…";
  showMsg(document.getElementById("login-msg"), "", "");
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  const { error } = await sb.auth.signInWithPassword({ email, password });
  btn.disabled = false; btn.textContent = "Anmelden";
  if (error) showMsg(document.getElementById("login-msg"), "Anmeldung fehlgeschlagen: " + error.message, "error");
});

document.getElementById("logout-btn").addEventListener("click", async () => { await sb.auth.signOut(); });

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
      loadImmo(), loadBet(), loadPens(), loadSteuer(), loadVers(), loadSim(),
      loadKategorien(), loadVG(), loadEinkommen(), loadBudgets(),
    ]);
    renderDashboard();
  } else {
    appView.classList.add("hidden");
    loginView.classList.remove("hidden");
    document.getElementById("password").value = "";
  }
});

// ======================================================================
//  Daten laden + anzeigen
// ======================================================================
async function loadData() {
  const { data, error } = await sb.from("transactions")
    .select("*")
    .order("buchungsdatum", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) { console.error(error); return; }
  allRows = data || [];
  render();
}

// Datums-Zeitraumfilter (von–bis). Zeilen ohne Datum werden bei aktivem Filter ausgeblendet.
function dateInRange(value) {
  const von = document.getElementById("filter-von").value;
  const bis = document.getElementById("filter-bis").value;
  const d = value ? String(value).slice(0, 10) : null;
  if (von && (!d || d < von)) return false;
  if (bis && (!d || d > bis)) return false;
  return true;
}
function inRange(r) { return dateInRange(r.buchungsdatum); }

function render() {
  const viewRows = allRows.filter(inRange);   // global nach Zeitraum gefiltert (Dashboard nutzt das)
  let tableBase = activeTxBank ? viewRows.filter((r) => (r.bank || "") === activeTxBank) : viewRows;
  if (activeTxBank && txKKFilter === "konto") tableBase = tableBase.filter((r) => !r.kreditkarte);
  else if (activeTxBank && txKKFilter === "kk") tableBase = tableBase.filter((r) => r.kreditkarte);
  const q = document.getElementById("search").value.toLowerCase();
  const rows = tableBase.filter((r) =>
    !q || [r.beschreibung, r.kategorie, r.bank].some((x) => (x || "").toLowerCase().includes(q))
  );

  // Anzeigebegrenzung: nur letzte txListLimit Monate in der Liste (allRows bleibt voll)
  let listRows = rows;
  let hasHidden = false;
  if (txListLimit !== null) {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - txListLimit);
    const cutoffStr = isoDate(cutoff);
    const limited = rows.filter((r) => !r.buchungsdatum || r.buchungsdatum >= cutoffStr);
    hasHidden = limited.length < rows.length;
    listRows = limited;
  }

  const tbody = document.getElementById("tbody");
  tbody.innerHTML = "";
  const txGroups = {};
  listRows.forEach((r) => {
    const key = r.buchungsdatum ? String(r.buchungsdatum).slice(0, 7) : "0000-00";
    (txGroups[key] = txGroups[key] || []).push(r);
  });
  Object.keys(txGroups).sort().reverse().forEach((key) => {
    const label = key === "0000-00" ? "Ohne Datum"
      : new Date(key + "-01").toLocaleDateString("de-DE", { month: "long", year: "numeric" });
    let mSoll = 0, mHaben = 0;
    txGroups[key].forEach((r) => { mSoll += Number(r.soll) || 0; mHaben += Number(r.haben) || 0; });
    const htr = document.createElement("tr");
    htr.className = "group-row";
    htr.innerHTML = `<td colspan="4">${label}</td><td class="num neg">${mSoll ? euro(mSoll) : ""}</td><td class="num pos">${mHaben ? euro(mHaben) : ""}</td><td></td>`;
    tbody.appendChild(htr);
    txGroups[key].forEach((r) => {
      const tr = document.createElement("tr");
      const datum = r.buchungsdatum ? new Date(r.buchungsdatum).toLocaleDateString("de-DE") : "";
      tr.innerHTML = `
        <td>${datum}</td>
        <td>${esc(r.beschreibung)}${r.kreditkarte ? ' <span style="background:var(--primary-subtle);color:var(--accent);font-size:11px;padding:1px 5px;border-radius:4px">KK</span>' : ""}${r.umbuchung ? ' <span style="background:var(--panel2);color:var(--muted);font-size:11px;padding:1px 5px;border-radius:4px">Umbuchung</span>' : ""}</td>
        <td>${esc(r.kategorie)}</td>
        <td>${esc(r.bank)}</td>
        <td class="num neg">${r.soll != null ? euro(r.soll) : ""}</td>
        <td class="num pos">${r.haben != null ? euro(r.haben) : ""}</td>
        <td class="num">
          <button class="link" data-ub="${r.id}" title="Als Umbuchung markieren">${r.umbuchung ? "Umbuchung ✓" : "→ Umbuchung"}</button>
          <button class="link" data-edit="${r.id}">Bearbeiten</button>
          <button class="danger" data-del="${r.id}">Löschen</button>
        </td>`;
      tbody.appendChild(tr);
    });
  });

  // count zeigt angezeigte / gesamt wenn begrenzt
  const countEl = document.getElementById("count");
  if (countEl) countEl.textContent = hasHidden ? `${listRows.length} von ${rows.length}` : rows.length;
  document.getElementById("empty").classList.toggle("hidden", listRows.length > 0);

  // "Mehr laden" / "Weniger" Steuerung
  const lmDiv = document.getElementById("tx-load-more");
  const lmBtn = document.getElementById("tx-load-more-btn");
  const llBtn = document.getElementById("tx-load-less-btn");
  if (lmDiv) {
    if (hasHidden) {
      lmDiv.style.display = "";
      if (lmBtn) { lmBtn.style.display = ""; lmBtn.textContent = `Alle ${rows.length} Transaktionen anzeigen`; }
      if (llBtn) llBtn.style.display = "none";
    } else if (txListLimit === null && rows.length > 0) {
      lmDiv.style.display = "";
      if (lmBtn) lmBtn.style.display = "none";
      if (llBtn) llBtn.style.display = "";
    } else {
      lmDiv.style.display = "none";
    }
  }

  if (typeof renderBanks === "function") renderBanks();
  renderTxOverview(viewRows);
  applyTxMode();
  renderDashboard();
  if (typeof renderImmoTx === "function") renderImmoTx();
  if (typeof renderGaps === "function") renderGaps();
}

// Banken-Übersicht auf der Transaktionsseite (Zusammenfassung aller Banken)
function renderTxOverview(viewRows) {
  const body = document.getElementById("tx-overview-body");
  if (!body) return;
  const groups = {};
  viewRows.forEach((r) => {
    if (r.umbuchung) return;
    const k = (r.bank || "").trim() || "Ohne Bank";
    if (!groups[k]) groups[k] = { ein: 0, aus: 0, n: 0 };
    groups[k].ein += Number(r.haben) || 0;
    groups[k].aus += Number(r.soll) || 0;
    groups[k].n++;
  });
  const keys = Object.keys(groups).sort();
  body.innerHTML = "";
  if (keys.length === 0) { body.innerHTML = `<tr><td colspan="5" class="empty">Keine Transaktionen im Zeitraum.</td></tr>`; return; }
  let tEin = 0, tAus = 0, tN = 0;
  keys.forEach((k) => {
    const g = groups[k]; const saldo = g.ein + g.aus;
    tEin += g.ein; tAus += g.aus; tN += g.n;
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${esc(k)}</td><td class="num pos">${euro(g.ein)}</td><td class="num neg">${euro(g.aus)}</td><td class="num ${saldo >= 0 ? "pos" : "neg"}">${euro(saldo)}</td><td class="num">${g.n}</td>`;
    body.appendChild(tr);
  });
  const tot = document.createElement("tr");
  tot.className = "group-row";
  tot.innerHTML = `<td>Gesamt</td><td class="num pos">${euro(tEin)}</td><td class="num neg">${euro(tAus)}</td><td class="num ${(tEin + tAus) >= 0 ? "pos" : "neg"}">${euro(tEin + tAus)}</td><td class="num">${tN}</td>`;
  body.appendChild(tot);
}

// Sichtbarkeit Übersicht vs. Bank-Modus
function applyTxMode() {
  const overview = !activeTxBank;
  const ov = document.getElementById("tx-overview");
  const imp = document.getElementById("tx-import-panel");
  const ent = document.getElementById("tx-entry-panel");
  const ub = document.getElementById("tx-umbuchung");
  if (ub) ub.classList.toggle("hidden", !overview);
  if (ov) ov.classList.toggle("hidden", !overview);
  if (imp) imp.classList.toggle("hidden", overview);
  if (ent) ent.classList.toggle("hidden", overview);
  const lbl = document.getElementById("tx-mode-label");
  if (lbl) lbl.textContent = overview ? "Übersicht – alle Banken" : "Bank: " + activeTxBank;
  if (!overview) fillBankSelect(document.getElementById("f-bank"), activeTxBank);
  // Kreditkarte: Felder nur zeigen, wenn die aktive Bank eine Kreditkarte hat
  const bk = banks.find((x) => x.name === activeTxBank);
  const showKK = !overview && !!(bk && bk.hat_kreditkarte);
  const kkF = document.getElementById("f-kk-field"); if (kkF) kkF.style.display = showKK ? "" : "none";
  const csvF = document.getElementById("csv-kk-field"); if (csvF) csvF.style.display = showKK ? "inline-flex" : "none";
  const txF = document.getElementById("tx-kk-filter"); if (txF) txF.style.display = showKK ? "inline-flex" : "none";
  if (!showKK) txKKFilter = "alle";
  document.querySelectorAll("#tx-kk-filter button").forEach((b) => b.classList.toggle("active-kk", b.getAttribute("data-kk") === txKKFilter));
}
document.getElementById("tx-kk-filter").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-kk]"); if (!b) return;
  txKKFilter = b.getAttribute("data-kk");
  render();
});

// ---- Auswertung pro Bank / Kategorie (über den gewählten Zeitraum) ----
function aggregate(rows, key, fallback) {
  const m = {};
  rows.forEach((r) => {
    const k = (r[key] || "").trim() || fallback;
    if (!m[k]) m[k] = { name: k, ein: 0, aus: 0 };
    m[k].ein += Number(r.haben) || 0;
    m[k].aus += Number(r.soll) || 0; // i.d.R. negativ
  });
  const arr = Object.values(m).map((g) => ({ ...g, saldo: g.ein + g.aus }));
  arr.sort((a, b) => (b.ein + Math.abs(b.aus)) - (a.ein + Math.abs(a.aus)));
  return arr;
}
function fillGroupTable(id, arr) {
  const body = document.getElementById(id);
  body.innerHTML = "";
  if (arr.length === 0) { body.innerHTML = `<tr><td colspan="5" class="empty">Keine Daten</td></tr>`; return; }
  const max = Math.max(1, ...arr.map((g) => Math.max(g.ein, Math.abs(g.aus))));
  arr.forEach((g) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(g.name)}</td>
      <td class="num pos">${g.ein ? euro(g.ein) : ""}</td>
      <td class="num neg">${g.aus ? euro(g.aus) : ""}</td>
      <td class="num ${g.saldo >= 0 ? "pos" : "neg"}">${euro(g.saldo)}</td>
      <td class="barcell">
        <div class="bar"><div class="bar-in" style="width:${(g.ein / max * 100).toFixed(1)}%"></div></div>
        <div class="bar"><div class="bar-out" style="width:${(Math.abs(g.aus) / max * 100).toFixed(1)}%"></div></div>
      </td>`;
    body.appendChild(tr);
  });
}
function renderBreakdown(rows) {
  fillGroupTable("bank-body", aggregate(rows, "bank", "Ohne Bank"));
  fillGroupTable("kat-body", aggregate(rows, "kategorie", "Ohne Kategorie"));
}
function esc(s) { return (s == null ? "" : String(s)).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

// ---- Navigation (Seitenmenü) ----
const SECTION_PAGES = {
  finanzen: ["dashboard", "transaktionen", "portfolio", "banken", "immobilien", "beteiligungen", "pensionsfonds", "vermoegensgegenstaende", "einkommen", "budgets"],
  steuern: ["steuer-uebersicht", "steuer-einkommen", "steuer-miete", "steuer-kapital", "steuer-absetzbar", "steuer-einstellungen"],
  versicherung: ["versicherung-uebersicht"],
  simulator: ["sim-szenarien", "simulator-uebersicht", "sim-ziele"],
};
const PAGES = Object.values(SECTION_PAGES).flat();
let activeSection = "finanzen";
const SECTION_LABELS = { finanzen: "Finanzen", steuern: "Steuern", versicherung: "Versicherungen", simulator: "Investment-Simulator" };
function switchSection(section) {
  activeSection = section;
  document.querySelectorAll(".nav-group").forEach((g) => g.classList.toggle("hidden", g.getAttribute("data-section") !== section));
  document.querySelectorAll(".rail-item").forEach((b) => b.classList.toggle("active", b.getAttribute("data-section") === section));
  const titleEl = document.getElementById("section-title");
  if (titleEl) titleEl.textContent = SECTION_LABELS[section] || section;
  const first = SECTION_PAGES[section][0];
  const navItem = document.querySelector(`.nav-group[data-section="${section}"] .nav-item[data-page="${first}"]`);
  const label = navItem && navItem.childNodes[0] && navItem.childNodes[0].nodeValue ? navItem.childNodes[0].nodeValue.trim() : section;
  showPage(first, label);
  if (first === "transaktionen") { activeTxBank = null; renderTxSubmenu(); render(); }
  if (first === "portfolio") { activePfBank = null; renderPfSubmenu(); renderPortfolio(); }
  if (first === "immobilien") { activeImmo = null; renderImmoSubmenu(); renderImmo(); }
}
document.querySelectorAll(".rail-item").forEach((b) => {
  b.addEventListener("click", () => switchSection(b.getAttribute("data-section")));
});
function showPage(page, title) {
  document.querySelectorAll(".nav-item").forEach((n) => n.classList.toggle("active", n.getAttribute("data-page") === page));
  PAGES.forEach((p) => document.getElementById("page-" + p).classList.toggle("hidden", p !== page));
  document.getElementById("page-title").textContent = title || page;
  if (page === "sim-szenarien") renderSimSzenarien();
  if (page === "simulator-uebersicht") renderSim();
  if (page === "sim-ziele") renderSimZiele();
  if (page === "vermoegensgegenstaende") renderVG();
  if (page === "einkommen") renderEinkommen();
  if (page === "budgets") renderBudgets();
}
document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", (e) => {
    e.preventDefault();
    const chevEl = item.querySelector(".nav-chev");
    if (chevEl) {
      const sub = document.getElementById(chevEl.getAttribute("data-sub"));
      if (sub) sub.classList.toggle("collapsed");
      chevEl.classList.toggle("collapsed");
    }
    const page = item.getAttribute("data-page");
    const label = (item.childNodes[0] && item.childNodes[0].nodeValue ? item.childNodes[0].nodeValue : item.textContent).trim();
    showPage(page, label);
    if (page === "transaktionen") { activeTxBank = null; renderTxSubmenu(); render(); }
    if (page === "portfolio") { activePfBank = null; renderPfSubmenu(); renderPortfolio(); }
    if (page === "immobilien") { activeImmo = null; renderImmoSubmenu(); renderImmo(); }
  });
});

// Seitenleiste komplett ein-/ausklappen (Zustand wird gemerkt)
const appShell = document.querySelector(".app-shell");
document.getElementById("nav-toggle").addEventListener("click", () => {
  const collapsed = !appShell.classList.contains("sidebar-collapsed");
  appShell.classList.toggle("sidebar-collapsed", collapsed);
  try { localStorage.setItem("sidebarCollapsed", collapsed ? "1" : "0"); } catch (e) {}
});
try { if (localStorage.getItem("sidebarCollapsed") === "1") appShell.classList.add("sidebar-collapsed"); } catch (e) {}

// Untermenü pro Bank unter „ETF & Aktien" (nur Banken mit Portfolio)
function portfolioBankNames() { return banks.filter((b) => b.hat_portfolio).map((b) => b.name).filter(Boolean); }
function renderPfSubmenu() {
  const wrap = document.getElementById("pf-submenu");
  if (!wrap) return;
  const items = [{ key: "", label: "Übersicht" }].concat(portfolioBankNames().map((n) => ({ key: n, label: n })));
  wrap.innerHTML = items.map((it) =>
    `<a href="#" class="subnav-item ${(activePfBank || "") === it.key ? "active" : ""}" data-bank="${it.key.replace(/"/g, "&quot;")}">${esc(it.label)}</a>`
  ).join("");
}
document.getElementById("pf-submenu").addEventListener("click", (e) => {
  const a = e.target.closest(".subnav-item");
  if (!a) return;
  e.preventDefault();
  const b = a.getAttribute("data-bank");
  activePfBank = b || null;
  showPage("portfolio", activePfBank ? "ETF & Aktien – " + activePfBank : "ETF & Aktien");
  renderPfSubmenu();
  renderPortfolio();
});

// Portfolio-Übersicht je Bank (neuester Stand pro Position, alle Banken)
function renderPfOverview(dateRows) {
  const body = document.getElementById("pf-overview-body");
  if (!body) return;
  const latest = {};
  dateRows.forEach((r) => {
    const bank = (r.bank || "").trim() || "Ohne Bank";
    const key = bank + "|" + (r.bezeichnung || "");
    const st = (r.datum || "") + (r.created_at || "");
    if (!latest[key] || st >= latest[key].st) latest[key] = { ...r, _bank: bank, st };
  });
  const byBank = {};
  Object.values(latest).forEach((r) => {
    if (!byBank[r._bank]) byBank[r._bank] = { inv: 0, wert: 0 };
    byBank[r._bank].inv += Number(r.investiert) || 0;
    byBank[r._bank].wert += Number(r.wert) || 0;
  });
  const keys = Object.keys(byBank).sort();
  body.innerHTML = "";
  if (keys.length === 0) { body.innerHTML = `<tr><td colspan="5" class="empty">Keine Portfolio-Daten im Zeitraum.</td></tr>`; return; }
  let tInv = 0, tWert = 0;
  keys.forEach((k) => {
    const g = byBank[k]; const gew = g.wert - g.inv; const pct = g.inv ? gew / g.inv * 100 : 0;
    tInv += g.inv; tWert += g.wert;
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${esc(k)}</td><td class="num">${euro(g.inv)}</td><td class="num">${euro(g.wert)}</td><td class="num ${gew >= 0 ? "pos" : "neg"}">${euro(gew)}</td><td class="num ${gew >= 0 ? "pos" : "neg"}">${pct.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %</td>`;
    body.appendChild(tr);
  });
  const tgew = tWert - tInv; const tpct = tInv ? tgew / tInv * 100 : 0;
  const tot = document.createElement("tr");
  tot.className = "group-row";
  tot.innerHTML = `<td>Gesamt</td><td class="num">${euro(tInv)}</td><td class="num">${euro(tWert)}</td><td class="num ${tgew >= 0 ? "pos" : "neg"}">${euro(tgew)}</td><td class="num ${tgew >= 0 ? "pos" : "neg"}">${tpct.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %</td>`;
  body.appendChild(tot);
}

// Sichtbarkeit Übersicht vs. Bank-Modus (Portfolio)
function applyPfMode() {
  const overview = !activePfBank;
  const ov = document.getElementById("pf-overview");
  const bulk = document.getElementById("pf-bulk-panel");
  const ent = document.getElementById("pf-entry-panel");
  if (ov) ov.classList.toggle("hidden", !overview);
  if (bulk) bulk.classList.toggle("hidden", overview);
  if (ent) ent.classList.toggle("hidden", overview);
  const lbl = document.getElementById("pf-mode-label");
  if (lbl) lbl.textContent = overview ? "Übersicht – alle Portfolio-Banken" : "Bank: " + activePfBank;
  if (!overview) fillBankSelect(document.getElementById("pf-bank"), activePfBank);
}

// Untermenü pro Bank unter „Transaktionen"
function renderTxSubmenu() {
  const wrap = document.getElementById("tx-submenu");
  if (!wrap) return;
  const items = [{ key: "", label: "Übersicht" }].concat(bankNames().map((n) => ({ key: n, label: n })));
  wrap.innerHTML = items.map((it) =>
    `<a href="#" class="subnav-item ${(activeTxBank || "") === it.key ? "active" : ""}" data-bank="${it.key.replace(/"/g, "&quot;")}">${esc(it.label)}</a>`
  ).join("");
}
document.getElementById("tx-submenu").addEventListener("click", (e) => {
  const a = e.target.closest(".subnav-item");
  if (!a) return;
  e.preventDefault();
  const b = a.getAttribute("data-bank");
  activeTxBank = b || null;
  showPage("transaktionen", activeTxBank ? "Transaktionen – " + activeTxBank : "Transaktionen");
  renderTxSubmenu();
  render();
});

function applyFilters() { render(); renderPortfolio(); }
document.getElementById("search").addEventListener("input", render);
document.getElementById("tx-load-more-btn").addEventListener("click", () => { txListLimit = null; render(); });
document.getElementById("tx-load-less-btn").addEventListener("click", () => { txListLimit = 12; render(); });
document.getElementById("filter-von").addEventListener("change", applyFilters);
document.getElementById("filter-bis").addEventListener("change", applyFilters);
document.getElementById("filter-reset").addEventListener("click", () => {
  document.getElementById("filter-von").value = "";
  document.getElementById("filter-bis").value = "";
  applyFilters();
});

// Klicks in der Tabelle (Bearbeiten / Löschen)
// Auswahl der Gegenbuchung beim Markieren einer Umbuchung
function showUbPicker(cell, r) {
  if (!cell) return;
  const amt = (Number(r.soll) || 0) + (Number(r.haben) || 0);
  const candidates = allRows
    .filter((x) => x.id !== r.id && (x.bank || "") !== (r.bank || "") && !x.umbuchung)
    .sort((a, b) => Math.abs(((Number(a.soll) || 0) + (Number(a.haben) || 0)) + amt) - Math.abs(((Number(b.soll) || 0) + (Number(b.haben) || 0)) + amt));
  if (candidates.length === 0) { alert("Keine mögliche Gegenbuchung bei einer anderen Bank gefunden. Erfasse zuerst die Gegenseite (anderes Konto)."); return; }
  const opts = candidates.map((x) => `<option value="${x.id}">${x.buchungsdatum ? new Date(x.buchungsdatum).toLocaleDateString("de-DE") : ""} · ${esc(x.bank || "")} · ${euro((Number(x.soll) || 0) + (Number(x.haben) || 0))} · ${esc((x.beschreibung || "").slice(0, 30))}</option>`).join("");
  cell.innerHTML = `<select class="ub-partner" style="max-width:260px;margin-bottom:6px">${opts}</select><br><button class="link" data-ub-link="${r.id}">Verknüpfen</button> <button class="link" data-ub-cancel="1">Abbrechen</button>`;
}

document.getElementById("tbody").addEventListener("click", async (e) => {
  const delId = e.target.getAttribute("data-del");
  const editId = e.target.getAttribute("data-edit");
  const ubId = e.target.getAttribute("data-ub");
  if (ubId) {
    const r = allRows.find((x) => x.id === ubId);
    if (!r) return;
    if (r.umbuchung) {
      // entkoppeln (beide Seiten)
      const ups = [sb.from("transactions").update({ umbuchung: false, umbuchung_partner: null }).eq("id", r.id)];
      if (r.umbuchung_partner) ups.push(sb.from("transactions").update({ umbuchung: false, umbuchung_partner: null }).eq("id", r.umbuchung_partner));
      await Promise.all(ups);
      loadData();
    } else {
      showUbPicker(e.target.closest("td"), r);
    }
    return;
  }
  const linkId = e.target.getAttribute("data-ub-link");
  if (linkId) {
    const sel = e.target.closest("td").querySelector(".ub-partner");
    const partnerId = sel && sel.value;
    if (!partnerId) { alert("Bitte eine Gegenbuchung wählen."); return; }
    await Promise.all([
      sb.from("transactions").update({ umbuchung: true, umbuchung_partner: partnerId }).eq("id", linkId),
      sb.from("transactions").update({ umbuchung: true, umbuchung_partner: linkId }).eq("id", partnerId),
    ]);
    loadData();
    return;
  }
  if (e.target.getAttribute("data-ub-cancel") !== null) { render(); return; }
  if (delId) {
    if (!confirm("Diesen Eintrag wirklich löschen?")) return;
    const { error } = await sb.from("transactions").delete().eq("id", delId);
    if (error) alert("Fehler: " + error.message); else loadData();
  }
  if (editId) {
    const r = allRows.find((x) => x.id === editId);
    if (r) startEdit(r);
  }
});

// ======================================================================
//  Eintrag hinzufügen / bearbeiten
// ======================================================================
const entryForm = document.getElementById("entry-form");

function updateEinkommenBlock() {
  const haben = numDE(document.getElementById("f-haben").value) || 0;
  const block = document.getElementById("f-einkommen-block");
  if (!block) return;
  block.style.display = haben > 0 ? "" : "none";
  const istEink = document.getElementById("f-ist-einkommen").value === "ja";
  const detail = document.getElementById("f-einkommen-detail");
  if (detail) detail.style.display = istEink ? "flex" : "none";
  const affittoHint = document.getElementById("f-affitto-hint");
  if (affittoHint) {
    const einkommensart = document.getElementById("f-einkommensart").value;
    const immoId = document.getElementById("f-immo").value;
    affittoHint.style.display = (einkommensart === "affitto" && immoId) ? "" : "none";
  }
}

function startEdit(r) {
  document.getElementById("entry-id").value = r.id;
  document.getElementById("f-datum").value = r.buchungsdatum || "";
  document.getElementById("f-beschreibung").value = r.beschreibung || "";
  document.getElementById("f-soll").value = fmtNum(r.soll);
  document.getElementById("f-haben").value = fmtNum(r.haben);
  setTxKategorie(r.kategorie || "", r.kategorie_id || "");
  populateImmoSelect();
  document.getElementById("f-immo").value = r.immo_id || "";
  document.getElementById("f-kreditkarte").value = r.kreditkarte ? "kk" : "konto";
  fillBankSelect(document.getElementById("f-bank"), r.bank);
  // Einkommens-Felder
  document.getElementById("f-ist-einkommen").value = r.ist_einkommen ? "ja" : "nein";
  document.getElementById("f-einkommensart").value = r.einkommensart || "dipendente";
  document.getElementById("f-betrag-brutto").value = r.betrag_brutto ? "ja" : "nein";
  document.getElementById("f-ritenuta").value = r.ritenuta != null ? fmtNum(r.ritenuta) : "";
  updateEinkommenBlock();
  document.getElementById("form-title").textContent = "Eintrag bearbeiten";
  document.getElementById("entry-cancel").classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetForm() {
  entryForm.reset();
  document.getElementById("entry-id").value = "";
  document.getElementById("form-title").textContent = "Eintrag hinzufügen";
  document.getElementById("entry-cancel").classList.add("hidden");
  showMsg(document.getElementById("entry-msg"), "", "");
  updateEinkommenBlock();
}
document.getElementById("entry-cancel").addEventListener("click", resetForm);

entryForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.submitter; if (btn) { btn.disabled = true; }
  const id = document.getElementById("entry-id").value;
  const payload = {
    buchungsdatum: document.getElementById("f-datum").value || null,
    beschreibung: document.getElementById("f-beschreibung").value || null,
    soll: numDE(document.getElementById("f-soll").value),
    haben: numDE(document.getElementById("f-haben").value),
    kategorie: getTxKategorieText(),
    kategorie_id: document.getElementById("f-kategorie-id").value || null,
    bank: activeTxBank || document.getElementById("f-bank").value || null,
    bank_id: bankIdByName(activeTxBank || document.getElementById("f-bank").value || null),
    immo_id: document.getElementById("f-immo").value || null,
    kreditkarte: document.getElementById("f-kreditkarte").value === "kk",
    ist_einkommen: document.getElementById("f-ist-einkommen").value === "ja",
    einkommensart: document.getElementById("f-ist-einkommen").value === "ja" ? (document.getElementById("f-einkommensart").value || null) : null,
    betrag_brutto: document.getElementById("f-ist-einkommen").value === "ja" && document.getElementById("f-betrag-brutto").value === "ja",
    ritenuta: document.getElementById("f-ist-einkommen").value === "ja" ? (numDE(document.getElementById("f-ritenuta").value) || null) : null,
  };
  let error;
  if (id) ({ error } = await sb.from("transactions").update(payload).eq("id", id));
  else    ({ error } = await sb.from("transactions").insert([payload]));
  if (btn) btn.disabled = false;
  if (error) { showMsg(document.getElementById("entry-msg"), "Fehler: " + error.message, "error"); return; }
  resetForm();
  loadData();
});

// Einkommen-Block: Sichtbarkeit bei Änderungen steuern
document.getElementById("f-haben").addEventListener("input", updateEinkommenBlock);
document.getElementById("f-ist-einkommen").addEventListener("change", updateEinkommenBlock);
document.getElementById("f-einkommensart").addEventListener("change", updateEinkommenBlock);
document.getElementById("f-immo").addEventListener("change", updateEinkommenBlock);

// ======================================================================
//  Portfolio (Depot-Stände über die Zeit)
// ======================================================================
async function loadPortfolio() {
  const { data, error } = await sb.from("portfolio")
    .select("*")
    .order("datum", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) { console.error(error); return; }
  portfolioRows = data || [];
  renderPortfolio();
}

function renderPortfolio() {
  renderGaps();
  const dateRows = portfolioRows.filter((r) => dateInRange(r.datum));   // alle Banken, im Zeitraum
  const rows = activePfBank ? dateRows.filter((r) => (r.bank || "") === activePfBank) : dateRows;
  renderPfOverview(dateRows);
  applyPfMode();

  // Tabelle: nach Monat gruppiert, neueste zuerst
  const body = document.getElementById("pf-body");
  body.innerHTML = "";
  const groups = {};
  [...rows].reverse().forEach((r) => {
    const key = r.datum ? String(r.datum).slice(0, 7) : "0000-00";
    (groups[key] = groups[key] || []).push(r);
  });
  Object.keys(groups).sort().reverse().forEach((key) => {
    const label = key === "0000-00" ? "Ohne Datum"
      : new Date(key + "-01").toLocaleDateString("de-DE", { month: "long", year: "numeric" });
    const monthSum = groups[key].reduce((s, r) => s + (Number(r.wert) || 0), 0);
    const htr = document.createElement("tr");
    htr.className = "group-row";
    htr.innerHTML = `<td colspan="5">${label}</td><td class="num">${euro(monthSum)}</td><td colspan="3"></td>`;
    body.appendChild(htr);
    groups[key].forEach((r) => {
      const inv = Number(r.investiert) || 0;
      const wert = Number(r.wert) || 0;
      const gew = wert - inv;
      const pct = inv ? (gew / inv) * 100 : 0;
      const datum = r.datum ? new Date(r.datum).toLocaleDateString("de-DE") : "";
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${datum}</td>
        <td>${esc(r.bank)}</td>
        <td>${esc(r.bezeichnung)}</td>
        <td class="num">${r.anteile != null ? Number(r.anteile).toLocaleString("de-DE", { maximumFractionDigits: 6 }) : ""}</td>
        <td class="num">${euro(inv)}</td>
        <td class="num">${euro(wert)}</td>
        <td class="num ${gew >= 0 ? "pos" : "neg"}">${euro(gew)}</td>
        <td class="num ${gew >= 0 ? "pos" : "neg"}">${pct.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %</td>
        <td class="num">
          <button class="link" data-pedit="${r.id}">Bearbeiten</button>
          <button class="danger" data-pdel="${r.id}">Löschen</button>
        </td>`;
      body.appendChild(tr);
    });
  });
  document.getElementById("pf-count").textContent = rows.length;
  document.getElementById("pf-empty").classList.toggle("hidden", portfolioRows.length > 0);

  // Summen: jeweils neuester Stand pro Bank + Position
  const latest = latestPortfolioMap(rows);
  let inv = 0, wert = 0;
  Object.values(latest).forEach((r) => { inv += Number(r.investiert) || 0; wert += Number(r.wert) || 0; });
  const gew = wert - inv;
  const pct = inv ? (gew / inv) * 100 : 0;
  document.getElementById("pf-sum-invest").textContent = euro(inv);
  document.getElementById("pf-sum-wert").textContent = euro(wert);
  const gEl = document.getElementById("pf-sum-gewinn");
  gEl.textContent = euro(gew) + "  (" + pct.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " %)";
  gEl.className = "v " + (gew >= 0 ? "pos" : "neg");

  renderPositions(latest);
  renderBindung(latest, wert);

  // Verlauf: je Stichtag Summe von Investiert und Wert (Gewinn = Wert − Investiert)
  const byDate = {};
  rows.forEach((r) => {
    const d = r.datum ? String(r.datum).slice(0, 10) : null;
    if (!d) return;
    if (!byDate[d]) byDate[d] = { inv: 0, val: 0 };
    byDate[d].inv += Number(r.investiert) || 0;
    byDate[d].val += Number(r.wert) || 0;
  });
  const points = Object.keys(byDate).sort().map((d) => ({ date: d, inv: byDate[d].inv, val: byDate[d].val }));
  drawChart(document.getElementById("pf-chart"), points);
  if (typeof renderBanks === "function") renderBanks();
}

// Plausibilität: warnt, wenn eine Position in einem Monat fehlt, obwohl davor UND danach Werte da sind
function renderGaps() {
  const box = document.getElementById("pf-warnbox");
  const dd = document.getElementById("pf-warn-dropdown");
  const allMonths = [...new Set(portfolioRows.filter((r) => r.datum).map((r) => String(r.datum).slice(0, 7)))].sort();
  const pos = {};
  portfolioRows.forEach((r) => {
    if (!r.datum) return;
    const key = (r.bank || "") + "|" + (r.bezeichnung || "");
    if (!pos[key]) pos[key] = { bank: r.bank, bez: r.bezeichnung, months: new Set() };
    pos[key].months.add(String(r.datum).slice(0, 7));
  });
  const monthLabel = (m) => new Date(m + "-01").toLocaleDateString("de-DE", { month: "long", year: "numeric" });
  const warnings = [];
  Object.values(pos).forEach((p) => {
    const ms = [...p.months].sort();
    const first = ms[0], last = ms[ms.length - 1];
    const missing = allMonths.filter((m) => m > first && m < last && !p.months.has(m));
    if (missing.length) warnings.push({ p, missing });
  });
  const sections = [];
  let count = 0;
  if (warnings.length) {
    count += warnings.length;
    const items = warnings.map((w) =>
      `<li><b>${esc(w.p.bez || w.p.bank || "?")}</b>${w.p.bank ? " (" + esc(w.p.bank) + ")" : ""}: fehlt ${w.missing.map(monthLabel).join(", ")}</li>`
    ).join("");
    sections.push(`<h4>Mögliche fehlende Werte</h4><p style="color:var(--muted);margin:6px 0 8px">In diesen Monaten fehlt ein Stand, obwohl davor und danach Werte erfasst wurden:</p><ul style="margin:0;padding-left:18px">${items}</ul>`);
  }
  // Umbuchungen ohne (gültige) Gegenbuchung
  const ubBad = allRows.filter((r) => {
    if (!r.umbuchung) return false;
    const partner = r.umbuchung_partner ? allRows.find((x) => x.id === r.umbuchung_partner) : null;
    return !partner || (partner.bank || "") === (r.bank || "");
  });
  if (ubBad.length) {
    count += ubBad.length;
    const items2 = ubBad.map((r) => `<li>${r.buchungsdatum ? new Date(r.buchungsdatum).toLocaleDateString("de-DE") : ""} · ${esc(r.bank || "?")} · ${euro((Number(r.soll) || 0) + (Number(r.haben) || 0))}</li>`).join("");
    sections.push(`<h4 style="margin-top:${warnings.length ? 12 : 0}px">Umbuchungen ohne Gegenbuchung</h4><p style="color:var(--muted);margin:6px 0 8px">Bitte je Umbuchung die Gegenbuchung bei einer anderen Bank verknüpfen (Schalter in der Transaktionszeile).</p><ul style="margin:0;padding-left:18px">${items2}</ul>`);
  }
  if (count === 0) { box.style.display = "none"; dd.style.display = "none"; dd.innerHTML = ""; return; }
  box.style.display = "";
  document.getElementById("pf-warn-count").textContent = count;
  dd.innerHTML = sections.join("");
}

// Warndreieck im Header: Dropdown auf-/zuklappen
document.getElementById("pf-warnbtn").addEventListener("click", (e) => {
  e.stopPropagation();
  const dd = document.getElementById("pf-warn-dropdown");
  dd.style.display = dd.style.display === "none" ? "" : "none";
});
document.addEventListener("click", (e) => {
  const box = document.getElementById("pf-warnbox");
  if (!box.contains(e.target)) document.getElementById("pf-warn-dropdown").style.display = "none";
});

// Positionen-Übersicht: eine Zeile pro Position (neuester Stand im Filter); Bindung hier zentral setzen
let pfPositions = [];
function renderPositions(latestMap) {
  pfPositions = Object.values(latestMap).sort((a, b) =>
    (a.bank || "").localeCompare(b.bank || "") || (a.bezeichnung || "").localeCompare(b.bezeichnung || ""));
  const body = document.getElementById("pf-pos-body");
  body.innerHTML = "";
  document.getElementById("pf-pos-count").textContent = pfPositions.length;
  const TYP_LABEL = { etf: "ETF", aktie: "Aktie", anleihe: "Anleihe", sonstige: "Sonst." };
  if (pfPositions.length === 0) { body.innerHTML = `<tr><td colspan="10" class="empty">Noch keine Positionen erfasst.</td></tr>`; return; }
  pfPositions.forEach((r, i) => {
    const inv = Number(r.investiert) || 0, wert = Number(r.wert) || 0;
    const gew = wert - inv, pct = inv ? (gew / inv) * 100 : 0;
    const stand = r.datum ? new Date(r.datum).toLocaleDateString("de-DE") : "";
    const typLbl = TYP_LABEL[r.wertpapier_typ] || "ETF";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(r.bank)}</td>
      <td>${esc(r.bezeichnung)}</td>
      <td><span style="font-size:12px;color:var(--muted)">${typLbl}</span></td>
      <td><select class="pos-bind" data-idx="${i}" style="max-width:150px">${bindOptions(r.bindung)}</select></td>
      <td class="num">${r.anteile != null ? Number(r.anteile).toLocaleString("de-DE", { maximumFractionDigits: 6 }) : ""}</td>
      <td class="num">${euro(inv)}</td>
      <td class="num">${euro(wert)}</td>
      <td class="num ${gew >= 0 ? "pos" : "neg"}">${euro(gew)}</td>
      <td class="num ${gew >= 0 ? "pos" : "neg"}">${pct.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %</td>
      <td>${stand}</td>`;
    body.appendChild(tr);
  });
}

// Bindung ändern: gilt für ALLE Stände dieser Position (Bank + Position)
document.getElementById("pf-pos-body").addEventListener("change", async (e) => {
  if (!e.target.classList.contains("pos-bind")) return;
  const r = pfPositions[+e.target.getAttribute("data-idx")];
  const value = e.target.value || null;
  let q = sb.from("portfolio").update({ bindung: value });
  q = r.bank ? q.eq("bank", r.bank) : q.is("bank", null);
  q = r.bezeichnung ? q.eq("bezeichnung", r.bezeichnung) : q.is("bezeichnung", null);
  const { error } = await q;
  if (error) { alert("Fehler beim Speichern der Bindung: " + error.message); return; }
  loadPortfolio();
});

// Kapitalbindung: aktueller Wert je Horizont (kurz/mittel/langfristig), neuester Stand pro Position
function renderBindung(latestMap, total) {
  const order = ["kurzfristig", "mittelfristig", "langfristig", "Nicht zugeordnet"];
  const sums = {};
  Object.values(latestMap).forEach((r) => {
    const k = r.bindung || "Nicht zugeordnet";
    sums[k] = (sums[k] || 0) + (Number(r.wert) || 0);
  });
  const body = document.getElementById("pf-bindung-body");
  body.innerHTML = "";
  const keys = order.filter((k) => sums[k] != null);
  if (keys.length === 0) { body.innerHTML = `<tr><td colspan="4" class="empty">Noch keine Positionen erfasst.</td></tr>`; return; }
  const max = Math.max(1, ...keys.map((k) => sums[k]));
  keys.forEach((k) => {
    const v = sums[k];
    const pct = total ? (v / total) * 100 : 0;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${k}</td>
      <td class="num">${euro(v)}</td>
      <td class="num">${pct.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %</td>
      <td class="barcell"><div class="bar"><div class="bar-in" style="width:${(v / max * 100).toFixed(1)}%;background:#2F5DA8"></div></div></td>`;
    body.appendChild(tr);
  });
}

function drawChart(el, points) {
  if (points.length < 2) {
    el.innerHTML = `<div class="empty">Mindestens zwei Stichtage nötig, um einen Verlauf anzuzeigen.</div>`;
    return;
  }
  const W = 820, H = 260, padL = 60, padR = 16, padT = 22, padB = 46;
  const xs = points.map((p) => +new Date(p.date));
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const maxY = Math.max(...points.map((p) => Math.max(p.inv, p.val)), 1);
  const sx = (x) => padL + (maxX === minX ? 0.5 : (x - minX) / (maxX - minX)) * (W - padL - padR);
  const sy = (y) => H - padB - (y / maxY) * (H - padT - padB);
  const X = (i) => sx(+new Date(points[i].date));
  const base = H - padB;

  const invPts = points.map((p, i) => `${X(i).toFixed(1)},${sy(p.inv).toFixed(1)}`);
  const valPts = points.map((p, i) => `${X(i).toFixed(1)},${sy(p.val).toFixed(1)}`);
  const invArea = `${X(0).toFixed(1)},${base} ${invPts.join(" ")} ${X(points.length - 1).toFixed(1)},${base}`;
  const gewBand = [...valPts, ...invPts.slice().reverse()].join(" ");

  const fmtY = (v) => Math.round(v).toLocaleString("de-DE") + " €";
  const fmtD = (s) => new Date(s).toLocaleDateString("de-DE");

  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
      <polygon points="${invArea}" fill="rgba(47,93,168,0.22)"/>
      <polygon points="${gewBand}" fill="rgba(46,125,50,0.22)"/>
      <polyline points="${invPts.join(" ")}" fill="none" stroke="#2F5DA8" stroke-width="2" stroke-dasharray="4 3"/>
      <polyline points="${valPts.join(" ")}" fill="none" stroke="#1A1A1A" stroke-width="2.5" stroke-linejoin="round"/>
      <line id="pf-guide" x1="0" x2="0" y1="${padT}" y2="${base}" stroke="#C4C4C4" stroke-width="1" style="display:none"/>
      <circle id="pf-dot-inv" r="4" fill="#2F5DA8" stroke="#FFFFFF" stroke-width="1.5" style="display:none"/>
      <circle id="pf-dot-val" r="4" fill="#1A1A1A" stroke="#FFFFFF" stroke-width="1.5" style="display:none"/>
      <text x="${padL}" y="${padT - 6}" fill="#6B6B6B" font-size="12">${fmtY(maxY)}</text>
      <text x="${padL}" y="${H - padB + 18}" fill="#6B6B6B" font-size="12">${fmtD(points[0].date)}</text>
      <text x="${W - padR}" y="${H - padB + 18}" fill="#6B6B6B" font-size="12" text-anchor="end">${fmtD(points[points.length - 1].date)}</text>
    </svg>
    <div class="legend">
      <span><i style="background:#2F5DA8"></i>Investiert</span>
      <span><i style="background:#2E7D32"></i>Gewinn</span>
      <span><i style="background:#1A1A1A"></i>Gesamtwert</span>
    </div>
    <div id="pf-tip" class="chart-tip" style="display:none"></div>`;

  // ---- Interaktivität: Tooltip beim Drüberfahren ----
  const svg = el.querySelector("svg");
  const guide = el.querySelector("#pf-guide");
  const dotInv = el.querySelector("#pf-dot-inv");
  const dotVal = el.querySelector("#pf-dot-val");
  const tip = el.querySelector("#pf-tip");

  function showAt(idx) {
    const p = points[idx];
    const gx = X(idx);
    guide.setAttribute("x1", gx); guide.setAttribute("x2", gx); guide.style.display = "";
    dotInv.setAttribute("cx", gx); dotInv.setAttribute("cy", sy(p.inv)); dotInv.style.display = "";
    dotVal.setAttribute("cx", gx); dotVal.setAttribute("cy", sy(p.val)); dotVal.style.display = "";
    const rect = svg.getBoundingClientRect();
    const gew = p.val - p.inv;
    const pct = p.inv ? (gew / p.inv) * 100 : 0;
    const gewColor = gew >= 0 ? "var(--green)" : "var(--red)";
    tip.innerHTML = `<b>${fmtD(p.date)}</b><br>Gesamtwert: <b>${euro(p.val)}</b><br>Investiert: ${euro(p.inv)}<br>Gewinn: <span style="color:${gewColor}">${euro(gew)} (${pct.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %)</span>`;
    let left = (gx / W) * rect.width;
    left = Math.max(70, Math.min(rect.width - 70, left));
    tip.style.left = left + "px";
    tip.style.top = ((sy(p.val) / H) * rect.height) + "px";
    tip.style.display = "";
  }
  function hide() { [guide, dotInv, dotVal, tip].forEach((n) => (n.style.display = "none")); }

  svg.addEventListener("mousemove", (e) => {
    const rect = svg.getBoundingClientRect();
    const svgX = (e.clientX - rect.left) / rect.width * W;
    let best = 0, bd = Infinity;
    points.forEach((p, i) => { const d = Math.abs(X(i) - svgX); if (d < bd) { bd = d; best = i; } });
    showAt(best);
  });
  svg.addEventListener("mouseleave", hide);
}

// Gibt Map zurück: "bank|bezeichnung" → neuester Eintrag aus rows.
// bankFilterFn(bank) optionaler Filter (z.B. bankSelected).
function latestPortfolioMap(rows, bankFilterFn) {
  const latest = {};
  rows.forEach((r) => {
    const bank = r.bank || "";
    if (bankFilterFn && !bankFilterFn(bank)) return;
    const key = bank + "|" + (r.bezeichnung || "");
    const st = (r.datum || "") + (r.created_at || "");
    if (!latest[key] || st >= latest[key].st) latest[key] = { ...r, st, bank };
  });
  return latest;
}

// ---- Portfolio-Formular ----
const pfForm = document.getElementById("pf-form");
function pfStartEdit(r) {
  document.getElementById("pf-id").value = r.id;
  document.getElementById("pf-datum").value = r.datum || "";
  fillBankSelect(document.getElementById("pf-bank"), r.bank);
  document.getElementById("pf-bezeichnung").value = r.bezeichnung || "";
  document.getElementById("pf-wertpapier-typ").value = r.wertpapier_typ || "etf";
  document.getElementById("pf-anteile").value = fmtNum(r.anteile, 6);
  document.getElementById("pf-investiert").value = fmtNum(r.investiert);
  document.getElementById("pf-wert").value = fmtNum(r.wert);
  document.getElementById("pf-form-title").textContent = "Stand bearbeiten";
  document.getElementById("pf-cancel").classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function pfReset() {
  pfForm.reset();
  document.getElementById("pf-id").value = "";
  document.getElementById("pf-form-title").textContent = "Stand hinzufügen";
  document.getElementById("pf-cancel").classList.add("hidden");
  showMsg(document.getElementById("pf-msg"), "", "");
}
document.getElementById("pf-cancel").addEventListener("click", pfReset);

pfForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.submitter; if (btn) btn.disabled = true;
  const id = document.getElementById("pf-id").value;
  const payload = {
    datum: document.getElementById("pf-datum").value || null,
    bank: activePfBank || document.getElementById("pf-bank").value || null,
    bank_id: bankIdByName(activePfBank || document.getElementById("pf-bank").value || null),
    bezeichnung: document.getElementById("pf-bezeichnung").value || null,
    wertpapier_typ: document.getElementById("pf-wertpapier-typ").value || "etf",
    anteile: numDE(document.getElementById("pf-anteile").value),
    investiert: numDE(document.getElementById("pf-investiert").value),
    wert: numDE(document.getElementById("pf-wert").value),
  };
  let error;
  if (id) ({ error } = await sb.from("portfolio").update(payload).eq("id", id));
  else    ({ error } = await sb.from("portfolio").insert([payload]));
  if (btn) btn.disabled = false;
  if (error) { showMsg(document.getElementById("pf-msg"), "Fehler: " + error.message, "error"); return; }
  pfReset();
  loadPortfolio();
});

document.getElementById("pf-body").addEventListener("click", async (e) => {
  const del = e.target.getAttribute("data-pdel");
  const edit = e.target.getAttribute("data-pedit");
  if (del) {
    if (!confirm("Diesen Portfolio-Eintrag wirklich löschen?")) return;
    const { error } = await sb.from("portfolio").delete().eq("id", del);
    if (error) alert("Fehler: " + error.message); else loadPortfolio();
  }
  if (edit) {
    const r = portfolioRows.find((x) => x.id === edit);
    if (r) pfStartEdit(r);
  }
});

// ---- Monatsstand: alle Positionen vom letzten Stand mit einem Klick übernehmen ----
let pfBulkItems = [];
const BINDUNGEN = ["kurzfristig", "mittelfristig", "langfristig"];
function bindOptions(sel) {
  return `<option value="">—</option>` +
    BINDUNGEN.map((o) => `<option value="${o}" ${o === (sel || "") ? "selected" : ""}>${o}</option>`).join("");
}
function pfLatestPositions() {
  const latest = {};
  portfolioRows.forEach((r) => {
    if (activePfBank && (r.bank || "") !== activePfBank) return;
    const k = (r.bank || "") + "|" + (r.bezeichnung || "");
    const s = (r.datum || "") + (r.created_at || "");
    if (!latest[k] || s >= latest[k].stamp) latest[k] = { ...r, stamp: s };
  });
  return Object.values(latest);
}
function pfBuildBulk() {
  const area = document.getElementById("pf-bulk-area");
  pfBulkItems = pfLatestPositions();
  if (pfBulkItems.length === 0) {
    area.innerHTML = `<div class="empty">Noch keine Positionen vorhanden. Lege unten einzelne Positionen an – danach kannst du sie hier monatlich mit einem Klick übernehmen.</div>`;
    return;
  }
  const rows = pfBulkItems.map((r, i) => `
    <tr data-idx="${i}">
      <td>${esc(r.bank)}</td>
      <td>${esc(r.bezeichnung)}</td>
      <td class="num"><input type="text" inputmode="decimal" class="bulk-anteile" value="${fmtNum(r.anteile, 6)}" style="max-width:120px" /></td>
      <td class="num"><input type="text" inputmode="decimal" class="bulk-invest" value="${fmtNum(r.investiert)}" style="max-width:120px" /></td>
      <td class="num"><input type="text" inputmode="decimal" class="bulk-wert" value="${fmtNum(r.wert)}" style="max-width:120px" /></td>
    </tr>`).join("");
  area.innerHTML = `
    <p style="color:var(--muted);font-size:13px;margin:0 0 12px">Werte vom letzten Stand übernommen – passe nur den aktuellen <b>Wert</b> an (Anteile/Investiert nur bei Zukäufen). Oben das Datum wählen, dann speichern.</p>
    <div style="overflow-x:auto"><table>
      <thead><tr><th>Bank</th><th>Position</th><th style="text-align:right">Anteile</th><th style="text-align:right">Investiert €</th><th style="text-align:right">Wert €</th></tr></thead>
      <tbody id="pf-bulk-rows">${rows}</tbody>
    </table></div>
    <button id="pf-bulk-save" style="margin-top:14px">Als neuen Stand speichern</button>`;
  document.getElementById("pf-bulk-save").addEventListener("click", pfBulkSave);
}
async function pfBulkSave() {
  const datum = document.getElementById("pf-bulk-datum").value;
  const msg = document.getElementById("pf-msg");
  if (!datum) { showMsg(msg, "Bitte oben ein Datum für den neuen Stand wählen.", "error"); return; }
  const payload = [...document.querySelectorAll("#pf-bulk-rows tr")].map((tr) => {
    const base = pfBulkItems[+tr.getAttribute("data-idx")];
    return {
      datum,
      bank: base.bank || null,
      bezeichnung: base.bezeichnung || null,
      anteile: numDE(tr.querySelector(".bulk-anteile").value),
      investiert: numDE(tr.querySelector(".bulk-invest").value),
      wert: numDE(tr.querySelector(".bulk-wert").value),
      bindung: base.bindung || null,
    };
  });
  const { error } = await sb.from("portfolio").insert(payload);
  if (error) { showMsg(msg, "Fehler: " + error.message, "error"); return; }
  showMsg(msg, `${payload.length} Positionen für ${new Date(datum).toLocaleDateString("de-DE")} gespeichert.`, "ok");
  document.getElementById("pf-bulk-area").innerHTML = "";
  loadPortfolio();
}
document.getElementById("pf-bulk-load").addEventListener("click", pfBuildBulk);
(function () {
  document.getElementById("pf-bulk-datum").value = isoDate(new Date());
})();

// ======================================================================
//  Banken
// ======================================================================
let banks = [];
let currentUserName = "";

function bankNames() { return banks.map((b) => b.name).filter(Boolean); }
function bankById(id) { return banks.find((b) => b.id === id) || null; }
function bankNameById(id) { const b = bankById(id); return b ? b.name : ""; }
function bankIdByName(name) { if (!name) return null; const b = banks.find((b) => b.name === name); return b ? b.id : null; }
function fillBankSelect(sel, current) {
  if (!sel) return;
  const cur = current != null ? current : sel.value;
  const all = [...new Set([...(cur ? [cur] : []), ...bankNames()])];
  sel.innerHTML = `<option value="">— Bank wählen —</option>` +
    all.map((n) => `<option value="${n.replace(/"/g, "&quot;")}" ${n === cur ? "selected" : ""}>${esc(n)}</option>`).join("");
}
function populateBankSelects() {
  fillBankSelect(document.getElementById("f-bank"));
  fillBankSelect(document.getElementById("pf-bank"));
  fillBankSelect(document.getElementById("ub-von"));
  fillBankSelect(document.getElementById("ub-auf"));
}
(function () {
  const el = document.getElementById("ub-datum");
  if (el) { el.value = isoDate(new Date()); }
})();
document.getElementById("ub-save").addEventListener("click", async (e) => {
  const datum = document.getElementById("ub-datum").value || null;
  const von = document.getElementById("ub-von").value;
  const auf = document.getElementById("ub-auf").value;
  const betrag = numDE(document.getElementById("ub-betrag").value);
  const text = document.getElementById("ub-text").value.trim();
  const msg = document.getElementById("ub-msg");
  if (!von || !auf || betrag == null || betrag <= 0) { msg.textContent = "Bitte Von-Konto, Auf-Konto und einen positiven Betrag angeben."; msg.style.color = "var(--red)"; return; }
  if (von === auf) { msg.textContent = "Von- und Auf-Konto müssen verschieden sein."; msg.style.color = "var(--red)"; return; }
  e.target.disabled = true;
  const b = Math.abs(betrag);
  const rows = [
    { buchungsdatum: datum, beschreibung: text || ("Umbuchung an " + auf), soll: -b, haben: 0, kategorie: "Umbuchung", bank: von, bank_id: bankIdByName(von), umbuchung: true },
    { buchungsdatum: datum, beschreibung: text || ("Umbuchung von " + von), soll: 0, haben: b, kategorie: "Umbuchung", bank: auf, bank_id: bankIdByName(auf), umbuchung: true },
  ];
  const { data, error } = await sb.from("transactions").insert(rows).select();
  e.target.disabled = false;
  if (error) { msg.textContent = "Fehler: " + error.message; msg.style.color = "var(--red)"; return; }
  if (data && data.length === 2) {
    await Promise.all([
      sb.from("transactions").update({ umbuchung_partner: data[1].id }).eq("id", data[0].id),
      sb.from("transactions").update({ umbuchung_partner: data[0].id }).eq("id", data[1].id),
    ]);
  }
  msg.textContent = "Umbuchung gespeichert."; msg.style.color = "var(--green)";
  document.getElementById("ub-betrag").value = ""; document.getElementById("ub-text").value = "";
  loadData();
});

async function loadBanks() {
  const { data, error } = await sb.from("banks").select("*").order("name", { ascending: true });
  if (error) { console.error(error); return; }
  banks = data || [];
  renderBanks();
  populateBankSelects();
  renderTxSubmenu();
  renderPfSubmenu();
  renderDashBankFilter();
  renderDashboard();
}

function renderBanks() {
  const body = document.getElementById("banks-body");
  if (!body) return;
  body.innerHTML = "";
  document.getElementById("bank-count").textContent = banks.length;
  if (banks.length === 0) { body.innerHTML = `<tr><td colspan="8" class="empty">Noch keine Banken angelegt.</td></tr>`; return; }
  banks.forEach((b) => {
    const tx = allRows.filter((r) => (r.bank || "") === b.name);
    const txSum = tx.reduce((s, r) => s + (Number(r.soll) || 0) + (Number(r.haben) || 0), 0);
    const saldoStart = Number(b.saldo_start) || 0;
    const computed = saldoStart + txSum;
    const lastDate = tx.reduce((m, r) => (r.buchungsdatum && r.buchungsdatum > m ? r.buchungsdatum : m), "");
    let pfCell = "—";
    if (b.hat_portfolio) {
      const latest = latestPortfolioMap(portfolioRows, (bank) => bank === b.name);
      let inv = 0, wert = 0;
      Object.values(latest).forEach((r) => { inv += Number(r.investiert) || 0; wert += Number(r.wert) || 0; });
      const gew = wert - inv;
      pfCell = `${euro(wert)}<br><span style="color:var(--muted);font-size:12px">Inv. ${euro(inv)} · <span class="${gew >= 0 ? "pos" : "neg"}">${euro(gew)}</span></span>`;
    }
    const ow = Array.isArray(b.eigentuemer) ? b.eigentuemer : [];
    const owners = ow.length === 0
      ? `${esc(currentUserName)} 100 %`
      : ow.map((o) => `${esc(o.name || "")}${o.anteil != null && o.anteil !== "" ? " " + o.anteil + "%" : ""}`).join(" · ");
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(b.name)}${b.hat_portfolio ? ' <span style="color:var(--muted);font-size:12px">(Portfolio)</span>' : ""}</td>
      <td>${b.vertragsstart ? new Date(b.vertragsstart).toLocaleDateString("de-DE") : ""}</td>
      <td class="num">${euro(saldoStart)}</td>
      <td class="num ${computed >= 0 ? "pos" : "neg"}">${euro(computed)}</td>
      <td>${lastDate ? new Date(lastDate).toLocaleDateString("de-DE") : "—"}</td>
      <td>${pfCell}</td>
      <td>${owners}</td>
      <td class="num">
        <button class="link" data-bedit="${b.id}">Bearbeiten</button>
        <button class="danger" data-bdel="${b.id}">Löschen</button>
      </td>`;
    body.appendChild(tr);
  });
}

// ---- Eigentümer-Editor ----
function addOwnerRow(name = "", anteil = "") {
  const div = document.createElement("div");
  div.className = "owner-row";
  div.style = "display:flex;gap:8px;margin-bottom:8px";
  div.innerHTML = `
    <input type="text" class="owner-name" placeholder="Name" value="${String(name).replace(/"/g, "&quot;")}" />
    <input type="text" inputmode="decimal" class="owner-pct" placeholder="Anteil %" value="${anteil == null ? "" : anteil}" style="max-width:120px" />
    <button type="button" class="secondary owner-del">Entfernen</button>`;
  document.getElementById("bank-owners").appendChild(div);
  updateOwnerSum();
}
function readOwners() {
  return [...document.querySelectorAll("#bank-owners .owner-row")].map((row) => ({
    name: row.querySelector(".owner-name").value.trim(),
    anteil: numDE(row.querySelector(".owner-pct").value),
  })).filter((o) => o.name || o.anteil != null);
}
function updateOwnerSum() {
  const sum = readOwners().reduce((s, o) => s + (Number(o.anteil) || 0), 0);
  const el = document.getElementById("bank-owner-sum");
  el.textContent = "Summe Anteile: " + sum.toLocaleString("de-DE", { maximumFractionDigits: 2 }) + " %";
  el.style.color = (sum === 100 || sum === 0) ? "var(--muted)" : "#8a6d00";
}
document.getElementById("bank-add-owner").addEventListener("click", () => addOwnerRow());
document.getElementById("bank-owners").addEventListener("click", (e) => {
  if (e.target.classList.contains("owner-del")) { e.target.closest(".owner-row").remove(); updateOwnerSum(); }
});
document.getElementById("bank-owners").addEventListener("input", updateOwnerSum);

// Standard = du 100 %. Editor nur bei "Weitere Eigentümer festlegen".
function bankOwnersShowEditor(show) {
  document.getElementById("bank-owner-editor").classList.toggle("hidden", !show);
  document.getElementById("bank-owner-default").classList.toggle("hidden", show);
  document.getElementById("bank-owner-toggle").textContent = show ? "Zurück zu Standard (du 100 %)" : "Weitere Eigentümer festlegen";
}
document.getElementById("bank-owner-toggle").addEventListener("click", () => {
  const hidden = document.getElementById("bank-owner-editor").classList.contains("hidden");
  if (hidden) {
    if (document.querySelectorAll("#bank-owners .owner-row").length === 0) {
      addOwnerRow(currentUserName, 100);
      addOwnerRow("", "");
    }
    bankOwnersShowEditor(true);
  } else {
    document.getElementById("bank-owners").innerHTML = "";
    updateOwnerSum();
    bankOwnersShowEditor(false);
  }
});

// ---- Bank-Formular ----
const bankForm = document.getElementById("bank-form");
function bankReset() {
  bankForm.reset();
  document.getElementById("bank-id").value = "";
  document.getElementById("bank-owners").innerHTML = "";
  bankOwnersShowEditor(false);
  document.getElementById("bank-form-title").textContent = "Bank hinzufügen";
  document.getElementById("bank-cancel").classList.add("hidden");
  showMsg(document.getElementById("bank-msg"), "", "");
  updateOwnerSum();
}
document.getElementById("bank-cancel").addEventListener("click", bankReset);

function bankStartEdit(b) {
  document.getElementById("bank-id").value = b.id;
  document.getElementById("bank-name").value = b.name || "";
  document.getElementById("bank-start").value = b.vertragsstart || "";
  document.getElementById("bank-saldo").value = fmtNum(b.saldo_start);
  document.getElementById("bank-portfolio").value = b.hat_portfolio ? "ja" : "nein";
  document.getElementById("bank-kreditkarte").value = b.hat_kreditkarte ? "ja" : "nein";
  document.getElementById("bank-im-ausland").value = b.im_ausland ? "ja" : "nein";
  document.getElementById("bank-anteil-user").value = b.anteil_user != null && b.anteil_user !== 100 ? fmtNum(b.anteil_user) : "";
  document.getElementById("bank-owners").innerHTML = "";
  const ow = Array.isArray(b.eigentuemer) ? b.eigentuemer : [];
  if (ow.length > 0) { ow.forEach((o) => addOwnerRow(o.name, o.anteil)); bankOwnersShowEditor(true); }
  else { bankOwnersShowEditor(false); }
  updateOwnerSum();
  document.getElementById("bank-form-title").textContent = "Bank bearbeiten";
  document.getElementById("bank-cancel").classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

bankForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.submitter; if (btn) btn.disabled = true;
  const id = document.getElementById("bank-id").value;
  const name = document.getElementById("bank-name").value.trim();
  if (!name) { if (btn) btn.disabled = false; showMsg(document.getElementById("bank-msg"), "Bitte einen Banknamen eingeben.", "error"); return; }
  const oldBank = id ? banks.find((b) => b.id === id) : null;
  const oldName = oldBank ? oldBank.name : null;
  const payload = {
    name,
    vertragsstart: document.getElementById("bank-start").value || null,
    saldo_start: numDE(document.getElementById("bank-saldo").value),
    hat_portfolio: document.getElementById("bank-portfolio").value === "ja",
    hat_kreditkarte: document.getElementById("bank-kreditkarte").value === "ja",
    im_ausland: document.getElementById("bank-im-ausland").value === "ja",
    anteil_user: numDE(document.getElementById("bank-anteil-user").value) || 100,
    eigentuemer: document.getElementById("bank-owner-editor").classList.contains("hidden") ? [] : readOwners(),
  };
  let error;
  if (id) ({ error } = await sb.from("banks").update(payload).eq("id", id));
  else    ({ error } = await sb.from("banks").insert([payload]));
  if (btn) btn.disabled = false;
  if (error) { showMsg(document.getElementById("bank-msg"), "Fehler: " + error.message, "error"); return; }
  // Rename-Kaskade: bank-Textspalte in transactions + portfolio synchron halten
  if (id && oldName && oldName !== name) {
    await Promise.all([
      sb.from("transactions").update({ bank: name }).eq("bank", oldName),
      sb.from("portfolio").update({ bank: name }).eq("bank", oldName),
    ]);
    if (activeTxBank === oldName) activeTxBank = name;
    if (activePfBank === oldName) activePfBank = name;
    await Promise.all([loadData(), loadPortfolio()]);
  }
  bankReset();
  loadBanks();
});

document.getElementById("banks-body").addEventListener("click", async (e) => {
  const del = e.target.getAttribute("data-bdel");
  const edit = e.target.getAttribute("data-bedit");
  if (del) {
    if (!confirm("Diese Bank wirklich löschen?")) return;
    const { error } = await sb.from("banks").delete().eq("id", del);
    if (error) alert("Fehler: " + error.message); else loadBanks();
  }
  if (edit) {
    const b = banks.find((x) => x.id === edit);
    if (b) bankStartEdit(b);
  }
});

// ======================================================================
//  Dashboard-Cockpit (nur Sicht des angemeldeten Nutzers)
// ======================================================================
let dashBankFilter = new Set();   // leer = alle Banken
function bankSelected(name) { return dashBankFilter.size === 0 || dashBankFilter.has(name || ""); }

// Nutzer-Anteil je Bank: 100% − Summe der Miteigentümer-Anteile (alle außer dem Nutzer)
function userShare(bankName) {
  const b = banks.find((x) => x.name === bankName);
  if (!b) return 1;
  // Explizites anteil_user-Feld hat Vorrang (einfacher, direkt gesetzt)
  if (b.anteil_user != null) return Math.max(0, Math.min(100, Number(b.anteil_user))) / 100;
  // Fallback: aus eigentuemer-JSONB berechnen
  const owners = Array.isArray(b.eigentuemer) ? b.eigentuemer : [];
  if (owners.length === 0) return 1;
  const u = (currentUserName || "").trim().toLowerCase();
  const others = owners.filter((o) => (o.name || "").trim().toLowerCase() !== u)
    .reduce((s, o) => s + (Number(o.anteil) || 0), 0);
  return Math.max(0, Math.min(100, 100 - others)) / 100;
}

function monthRange(minM, maxM) {
  const out = [];
  let [y, m] = minM.split("-").map(Number);
  const [ey, em] = maxM.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}
const fmtMonthLong = (m) => new Date(m + "-01").toLocaleDateString("de-DE", { month: "long", year: "numeric" });
const fmtMonthShort = (m) => { const [y, mo] = m.split("-"); return mo + "/" + y.slice(2); };

function renderDashBankFilter() {
  const wrap = document.getElementById("dash-bank-filter");
  if (!wrap) return;
  const names = bankNames();
  wrap.innerHTML = names.length === 0
    ? `<span style="color:var(--muted);font-size:13px">Noch keine Banken angelegt – lege im Bereich „Banken" welche an.</span>`
    : names.map((n) => `<label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer"><input type="checkbox" class="dash-bank-cb" value="${n.replace(/"/g, "&quot;")}" ${bankSelected(n) ? "checked" : ""} style="width:auto"> ${esc(n)}</label>`).join("");
}

// Aktuelles Vermögens-Snapshot (gewichtet mit Nutzer-Anteil)
function computeWealthSnapshot() {
  let liquid = 0;
  banks.forEach((b) => {
    if (!bankSelected(b.name)) return;
    const start = Number(b.saldo_start) || 0;
    const txSum = allRows.filter((r) => (r.bank || "") === b.name).reduce((s, r) => s + (Number(r.soll) || 0) + (Number(r.haben) || 0), 0);
    liquid += (start + txSum) * userShare(b.name);
  });
  let pInv = 0, pWert = 0;
  const latest = latestPortfolioMap(portfolioRows, bankSelected);
  Object.values(latest).forEach((r) => { const sh = userShare(r.bank); pInv += (Number(r.investiert) || 0) * sh; pWert += (Number(r.wert) || 0) * sh; });
  const pGain = pWert - pInv, pPct = pInv ? pGain / pInv * 100 : 0;
  let immoEk = 0;
  immoRows.forEach((d) => { immoEk += immoKPIs(d).ekWert * ((Number(d.anteil_user) || 100) / 100); });
  let betVerm = 0;
  betRows.forEach((d) => { betVerm += betKPIs(d).vermoegen; });
  let pensWert = 0;
  pensRows.forEach((d) => { pensWert += pensCurrentWert(d.id); });
  let versKapital = 0;
  versRows.filter((d) => d.art === "kapital").forEach((d) => { versKapital += versCurrentWert(d.id); });
  let vgWert = 0;
  vgRows.forEach((d) => { vgWert += (Number(d.marktwert) || 0) * ((Number(d.anteil_user) || 100) / 100); });
  const networth = liquid + pWert + immoEk + betVerm + pensWert + versKapital + vgWert;
  let etfGain = 0;
  Object.values(latest).forEach((r) => { const g = (Number(r.wert) || 0) - (Number(r.investiert) || 0); if (g > 0) etfGain += g * userShare(r.bank); });
  let betGain = 0;
  betRows.forEach((d) => { const g = (Number(d.marktwert) || 0) - (Number(d.invest_hist) || 0); if (g > 0) betGain += g; });
  const latSteuer = KEST * (etfGain + betGain);
  return { liquid, latest, pInv, pWert, pGain, pPct, immoEk, betVerm, pensWert, versKapital, vgWert, networth, latSteuer };
}

// Cashflow im aktuellen Datumsfilter + Ausgaben letzten Monat
function computeCashflow() {
  let cfEin = 0, cfAus = 0;
  allRows.forEach((r) => {
    if (r.umbuchung || !dateInRange(r.buchungsdatum) || !bankSelected(r.bank || "")) return;
    const sh = userShare(r.bank || "");
    cfEin += (Number(r.haben) || 0) * sh;
    cfAus += (Number(r.soll) || 0) * sh;
  });
  const lmKey = isoMonth(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1));
  let ausLM = 0;
  allRows.forEach((r) => {
    if (r.umbuchung || !r.buchungsdatum || !bankSelected(r.bank || "")) return;
    if (String(r.buchungsdatum).slice(0, 7) !== lmKey) return;
    ausLM += (Number(r.soll) || 0) * userShare(r.bank || "");
  });
  return { cfEin, cfAus, cfNet: cfEin + cfAus, ausLM };
}

// Finanzielle Freiheit: Ausgaben (12 Mon.) und verfügbares Vermögen
function computeFFKPIs(liquid, latest, passivM) {
  const now = new Date();
  const cmKey = isoMonth(now);
  const sKey = isoMonth(new Date(now.getFullYear(), now.getMonth() - 12, 1));
  let aus12 = 0;
  allRows.forEach((r) => {
    if (r.umbuchung || !r.buchungsdatum || !bankSelected(r.bank || "")) return;
    const m = String(r.buchungsdatum).slice(0, 7);
    if (m < sKey || m >= cmKey) return;
    aus12 += (Number(r.soll) || 0) * userShare(r.bank || "");
  });
  const avgAus = Math.abs(aus12) / 12;
  let avail = liquid;
  Object.values(latest).forEach((r) => {
    if ((r.bindung || "") === "langfristig") return;
    const sh = userShare(r.bank);
    const wert = (Number(r.wert) || 0) * sh;
    const gain = ((Number(r.wert) || 0) - (Number(r.investiert) || 0)) * sh;
    avail += wert - KEST * Math.max(0, gain);
  });
  immoRows.forEach((d) => { if ((d.bindung || "") === "langfristig") return; avail += immoKPIs(d).ekWert * ((Number(d.anteil_user) || 100) / 100); });
  betRows.forEach((d) => { if ((d.bindung || "") === "langfristig") return; const v = betKPIs(d).vermoegen; const g = (Number(d.marktwert) || 0) - (Number(d.invest_hist) || 0); avail += v - KEST * Math.max(0, g); });
  pensRows.forEach((d) => { if ((d.bindung || "") === "langfristig") return; avail += pensCurrentWert(d.id); });
  versRows.filter((d) => d.art === "kapital").forEach((d) => { if ((d.bindung || "") === "langfristig") return; avail += versCurrentWert(d.id); });
  return { avgAus, avail, luecke: avgAus - passivM };
}

function renderDashboard() {
  if (!document.getElementById("kpi-networth")) return;

  const { liquid, latest, pWert, pGain, pPct, immoEk, betVerm, pensWert, versKapital, vgWert, networth, latSteuer } = computeWealthSnapshot();
  const { cfEin, cfAus, cfNet, ausLM } = computeCashflow();
  const passivM = currentPassiveIncome();
  const { avgAus, avail, luecke } = computeFFKPIs(liquid, latest, passivM);

  // Vermögens-KPIs
  document.getElementById("kpi-networth").textContent = euro(networth);
  document.getElementById("kpi-liquid").textContent = euro(liquid);
  const heroLiq = document.getElementById("hero-liquid"); if (heroLiq) heroLiq.textContent = euro(liquid);
  document.getElementById("kpi-portfolio").textContent = euro(pWert);
  const gainEl = document.getElementById("kpi-portfolio-gain");
  gainEl.textContent = pWert ? `Gewinn ${euro(pGain)} (${pPct.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %)` : "";
  gainEl.style.color = pGain >= 0 ? "var(--green)" : "var(--red)";
  document.getElementById("kpi-lat-steuer").textContent = euro(latSteuer);
  const nwNet = networth - latSteuer;
  const nwNetEl = document.getElementById("kpi-networth-net");
  nwNetEl.textContent = euro(nwNet);
  nwNetEl.className = "v " + (nwNet >= 0 ? "pos" : "neg");
  const heroNw = document.getElementById("hero-networth"); if (heroNw) heroNw.textContent = euro(nwNet);

  // Cashflow-KPIs
  const einEl = document.getElementById("kpi-ein");
  if (einEl) einEl.textContent = euro(cfEin);
  const cfEl = document.getElementById("kpi-cashflow");
  cfEl.textContent = euro(cfNet);
  cfEl.className = "v " + (cfNet >= 0 ? "pos" : "neg");
  const heroCf = document.getElementById("hero-cashflow");
  if (heroCf) { heroCf.textContent = euro(cfNet); heroCf.style.color = cfNet >= 0 ? "var(--green)" : "var(--red)"; }
  document.getElementById("kpi-ausgaben").textContent = euro(Math.abs(cfAus));
  document.getElementById("kpi-ausgaben-lm").textContent = euro(Math.abs(ausLM));
  renderIncomeOverview();

  // Passives Einkommen
  document.getElementById("kpi-passiv").textContent = euro(passivM);
  document.getElementById("kpi-passiv-jahr").textContent = euro(passivM * 12);

  // Finanzielle Freiheit
  document.getElementById("ff-ausgaben").textContent = euro(avgAus);
  document.getElementById("ff-passiv").textContent = euro(passivM);
  const lEl = document.getElementById("ff-luecke");
  lEl.textContent = euro(luecke); lEl.className = "v " + (luecke > 0 ? "neg" : "pos");
  document.getElementById("ff-verfuegbar").textContent = euro(Math.max(0, avail));
  const res = document.getElementById("ff-result");
  const heroFr = document.getElementById("hero-freiheit");
  if (luecke <= 0) {
    res.textContent = "unbegrenzt – passives Einkommen deckt die Ausgaben";
    res.style.color = "var(--green)";
    if (heroFr) { heroFr.textContent = "unbegrenzt"; heroFr.style.color = "var(--green)"; }
  } else {
    const monate = avail / luecke, jahre = monate / 12;
    res.textContent = `${monate.toLocaleString("de-DE", { maximumFractionDigits: 0 })} Monate (${jahre.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} Jahre)`;
    res.style.color = "var(--text)";
    if (heroFr) { heroFr.textContent = `${jahre.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} Jahre`; heroFr.style.color = "var(--text)"; }
  }

  // Schulden-KPI
  let schuldenAktuell = 0;
  immoRows.forEach((d) => { schuldenAktuell += (Number(d.restschuld) || 0) * ((Number(d.anteil_user) || 100) / 100); });
  const schEl = document.getElementById("kpi-schulden"); if (schEl) schEl.textContent = euro(schuldenAktuell);
  const debtPts = schuldenSeries();
  const delEl = document.getElementById("kpi-schulden-delta");
  if (delEl) {
    if (debtPts.length >= 2) {
      const delta = debtPts[debtPts.length - 1].v - debtPts[0].v;
      delEl.textContent = (delta > 0 ? "+" : "") + euro(delta);
      delEl.className = "v " + (delta <= 0 ? "pos" : "neg");
    } else { delEl.textContent = "–"; delEl.className = "v"; }
  }

  // Charts
  drawWealthChart(document.getElementById("dash-networth-chart"), wealthSeries());
  drawCashflowChart(document.getElementById("dash-cashflow-chart"), cashflowSeries());
  drawInvestmentChart(document.getElementById("dash-invest"), investmentSeries());
  drawDebtChart(document.getElementById("dash-debt-chart"), debtPts);
  renderDashCat();
  drawDonut(document.getElementById("dash-alloc"), [
    { label: "Liquide Mittel", value: Math.max(0, liquid), color: "#2F5DA8" },
    { label: "Investiert (Portfolio)", value: Math.max(0, pWert), color: "#2E7D32" },
    { label: "Immobilien (EK)", value: Math.max(0, immoEk), color: "#E0A800" },
    { label: "Beteiligungen", value: Math.max(0, betVerm), color: "#6B6B6B" },
    { label: "Pensionsfonds", value: Math.max(0, pensWert), color: "#5B86C9" },
    { label: "Versicherungen (Kapital)", value: Math.max(0, versKapital), color: "#8E44AD" },
    { label: "Vermögensgegenstände", value: Math.max(0, vgWert), color: "#D35400" },
  ]);
  renderDashBindung(latest);
  if (typeof renderSteuern === "function") renderSteuern();
}

// Kapitalbindung über alle Anlageklassen (gewichtet mit Nutzer-Anteil)
function renderDashBindung(portfolioLatest) {
  const body = document.getElementById("dash-bindung-body");
  if (!body) return;
  const bind = {};
  const add = (key, val) => { const k = (key || "").trim() || "Nicht zugeordnet"; bind[k] = (bind[k] || 0) + val; };
  Object.values(portfolioLatest || {}).forEach((r) => add(r.bindung, (Number(r.wert) || 0) * userShare(r.bank)));
  immoRows.forEach((d) => add(d.bindung, immoKPIs(d).ekWert * ((Number(d.anteil_user) || 100) / 100)));
  betRows.forEach((d) => add(d.bindung, betKPIs(d).vermoegen));
  pensRows.forEach((d) => add(d.bindung, pensCurrentWert(d.id)));
  versRows.filter((d) => d.art === "kapital").forEach((d) => add(d.bindung, versCurrentWert(d.id)));
  const order = ["kurzfristig", "mittelfristig", "langfristig", "Nicht zugeordnet"];
  const keys = order.filter((k) => bind[k] != null);
  body.innerHTML = "";
  if (keys.length === 0) { body.innerHTML = `<tr><td colspan="4" class="empty">Keine Daten.</td></tr>`; return; }
  const total = keys.reduce((s, k) => s + bind[k], 0);
  const max = Math.max(1, ...keys.map((k) => Math.abs(bind[k])));
  keys.forEach((k) => {
    const v = bind[k]; const pct = total ? v / total * 100 : 0;
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${k}</td><td class="num">${euro(v)}</td><td class="num">${pct.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %</td><td class="barcell"><div class="bar"><div class="bar-in" style="width:${Math.max(0, v / max * 100).toFixed(1)}%;background:#2F5DA8"></div></div></td>`;
    body.appendChild(tr);
  });
}


function cashflowSeries() {
  const map = {};
  allRows.forEach((r) => {
    if (r.umbuchung || !r.buchungsdatum || !bankSelected(r.bank || "")) return;
    const M = r.buchungsdatum.slice(0, 7);
    if (!map[M]) map[M] = { ein: 0, aus: 0 };
    const sh = userShare(r.bank || "");
    map[M].ein += (Number(r.haben) || 0) * sh;
    map[M].aus += (Number(r.soll) || 0) * sh;
  });
  let months = Object.keys(map).sort();
  const von = document.getElementById("filter-von").value, bis = document.getElementById("filter-bis").value;
  if (von) months = months.filter((m) => m >= von.slice(0, 7));
  if (bis) months = months.filter((m) => m <= bis.slice(0, 7));
  return months.map((m) => ({ m, ein: map[m].ein, aus: map[m].aus }));
}

function renderDashCat() {
  const el = document.getElementById("dash-cat");
  if (!el) return;
  const map = {};
  allRows.forEach((r) => {
    if (r.umbuchung || !dateInRange(r.buchungsdatum) || !bankSelected(r.bank || "")) return;
    const soll = Number(r.soll) || 0;
    if (soll >= 0) return;
    const k = (r.kategorie || "").trim() || "Ohne Kategorie";
    map[k] = (map[k] || 0) + Math.abs(soll) * userShare(r.bank || "");
  });
  const arr = Object.entries(map).map(([name, val]) => ({ name, val })).sort((a, b) => b.val - a.val).slice(0, 10);
  if (arr.length === 0) { el.innerHTML = `<div class="empty">Keine Ausgaben im Zeitraum.</div>`; return; }
  const max = Math.max(...arr.map((a) => a.val));
  el.innerHTML = arr.map((a) => `<div class="hbar"><span class="hbar-label" title="${esc(a.name)}">${esc(a.name)}</span><span class="hbar-track"><span class="hbar-fill" style="width:${(a.val / max * 100).toFixed(1)}%"></span></span><span class="hbar-val neg">${euro(a.val)}</span></div>`).join("");
}

// Einkommensübersicht: aktives Einkommen (Arbeit) vs. passives Einkommen je Quelle (pro Jahr)
function renderIncomeOverview() {
  const el = document.getElementById("dash-income");
  if (!el) return;
  const aktivJahr = workIncomeYear();
  let passivImmo = 0;
  immoRows.forEach((d) => { const k = immoKPIs(d); if (k.verm) passivImmo += (k.mieteNetto || 0) * ((Number(d.anteil_user) || 100) / 100) * 12; });
  let passivBet = 0;
  betRows.forEach((d) => { passivBet += betKPIs(d).jahresertrag; });
  drawDonut(el, [
    { label: "Arbeit (12 Mon.)", value: Math.max(0, aktivJahr), color: "#2F5DA8" },
    { label: "Immobilien (Miete/Jahr)", value: Math.max(0, passivImmo), color: "#E0A800" },
    { label: "Beteiligungen (Ertrag/Jahr)", value: Math.max(0, passivBet), color: "#6B6B6B" },
  ]);
}

// Passives Einkommen / Monat (aktuell): Netto-Miete + Netto-Beteiligungsertrag
function currentPassiveIncome() {
  let p = 0;
  immoRows.forEach((d) => { const k = immoKPIs(d); if (k.verm) p += (k.mieteNetto || 0) * ((Number(d.anteil_user) || 100) / 100); });
  betRows.forEach((d) => { p += betKPIs(d).jahresertrag / 12; });
  return p;
}
function monthMinus(M, k) {
  let [y, m] = M.split("-").map(Number);
  m -= k; while (m <= 0) { m += 12; y--; }
  return `${y}-${String(m).padStart(2, "0")}`;
}

// Datenreihe für das Vermögens-Stapeldiagramm: Cash + Investiert + Portfoliogewinn + Freiheit (Monate)
function wealthSeries() {
  const md = [];
  allRows.forEach((r) => { if (r.buchungsdatum) md.push(r.buchungsdatum.slice(0, 7)); });
  portfolioRows.forEach((r) => { if (r.datum) md.push(r.datum.slice(0, 7)); });
  banks.forEach((b) => { if (b.vertragsstart) md.push(b.vertragsstart.slice(0, 7)); });
  if (md.length === 0) return [];
  let months = monthRange(md.reduce((a, b) => a < b ? a : b), md.reduce((a, b) => a > b ? a : b));
  const von = document.getElementById("filter-von").value, bis = document.getElementById("filter-bis").value;
  if (von) months = months.filter((m) => m >= von.slice(0, 7));
  if (bis) months = months.filter((m) => m <= bis.slice(0, 7));

  // Portfolio-Snapshots nach Position sortiert (unverändert)
  const posSnaps = {};
  portfolioRows.forEach((r) => {
    if (!r.datum) return;
    const bank = r.bank || "";
    if (!bankSelected(bank)) return;
    const key = bank + "|" + (r.bezeichnung || "");
    (posSnaps[key] = posSnaps[key] || []).push({ m: r.datum.slice(0, 7), wert: Number(r.wert) || 0, inv: Number(r.investiert) || 0, bank });
  });
  Object.values(posSnaps).forEach((a) => a.sort((x, y) => x.m < y.m ? -1 : 1));

  // Pre-Aggregation: TX-Deltas pro Bank+Monat (vermeidet allRows-Scan im Inner Loop)
  const txByBankMonth = {};
  allRows.forEach((r) => {
    if (!r.buchungsdatum || !bankSelected(r.bank || "")) return;
    const bank = r.bank || "";
    const month = r.buchungsdatum.slice(0, 7);
    if (!txByBankMonth[bank]) txByBankMonth[bank] = {};
    txByBankMonth[bank][month] = (txByBankMonth[bank][month] || 0) + (Number(r.soll) || 0) + (Number(r.haben) || 0);
  });
  const txBankSorted = {};
  Object.entries(txByBankMonth).forEach(([bank, deltas]) => { txBankSorted[bank] = Object.keys(deltas).sort(); });

  // Pre-Aggregation: Soll-Summe pro Monat für 12-Monats-Ausgabenberechnung
  const sollByMonth = {};
  allRows.forEach((r) => {
    if (r.umbuchung || !r.buchungsdatum || !bankSelected(r.bank || "")) return;
    const m = r.buchungsdatum.slice(0, 7);
    sollByMonth[m] = (sollByMonth[m] || 0) + (Number(r.soll) || 0) * userShare(r.bank || "");
  });

  const passiv = currentPassiveIncome();
  return months.map((M) => {
    let cash = 0;
    banks.forEach((b) => {
      if (!bankSelected(b.name)) return;
      const start = Number(b.saldo_start) || 0;
      let txSum = 0;
      (txBankSorted[b.name] || []).forEach((m) => { if (m <= M) txSum += txByBankMonth[b.name][m]; });
      cash += (start + txSum) * userShare(b.name);
    });
    let inv = 0, val = 0;
    Object.values(posSnaps).forEach((arr) => { let last = null; for (const s of arr) { if (s.m <= M) last = s; else break; } if (last) { const sh = userShare(last.bank); inv += last.inv * sh; val += last.wert * sh; } });
    const gain = val - inv;
    const startKey = monthMinus(M, 11);
    let aus = 0;
    Object.entries(sollByMonth).forEach(([m, v]) => { if (m >= startKey && m <= M) aus += v; });
    const avgAus = Math.abs(aus) / 12;
    const avail = cash + (val - KEST * Math.max(0, gain));
    const luecke = avgAus - passiv;
    const freiheit = luecke > 0 ? avail / luecke : 0;
    return { m: M, cash, invested: inv, gain, value: val, freiheit };
  });
}

function drawWealthChart(el, points) {
  if (!el) return;
  if (points.length < 2) { el.innerHTML = `<div class="empty">Zu wenig Daten für einen Verlauf.</div>`; return; }
  const W = 880, H = 300, padL = 74, padR = 58, padT = 20, padB = 48, n = points.length;
  const maxEuro = Math.max(1, ...points.map((p) => p.cash + Math.max(0, p.value)));
  const maxFrei = Math.max(12, ...points.map((p) => p.freiheit));
  const X = (i) => padL + (n === 1 ? 0.5 : i / (n - 1)) * (W - padL - padR);
  const Ye = (v) => H - padB - (v / maxEuro) * (H - padT - padB);
  const Yf = (v) => H - padB - (Math.min(v, maxFrei) / maxFrei) * (H - padT - padB);
  const t0 = points.map(() => 0);
  const t1 = points.map((p) => p.cash);
  const t2 = points.map((p) => p.cash + Math.min(p.invested, Math.max(0, p.value)));
  const t3 = points.map((p) => p.cash + Math.max(0, p.value));
  const band = (lo, hi) => {
    const up = hi.map((v, i) => `${X(i).toFixed(1)},${Ye(v).toFixed(1)}`);
    const dn = lo.map((v, i) => `${X(i).toFixed(1)},${Ye(v).toFixed(1)}`).reverse();
    return [...up, ...dn].join(" ");
  };
  const freiLine = points.map((p, i) => `${X(i).toFixed(1)},${Yf(p.freiheit).toFixed(1)}`).join(" ");
  const every = n <= 12 ? 1 : Math.ceil(n / 12);
  let xlab = "";
  points.forEach((p, i) => { if (i % every === 0 || i === n - 1) xlab += `<text x="${X(i).toFixed(1)}" y="${H - padB + 16}" fill="#6B6B6B" font-size="11" text-anchor="middle">${fmtMonthShort(p.m)}</text>`; });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    <polygon points="${band(t0, t1)}" fill="#2F5DA8" fill-opacity="0.85"/>
    <polygon points="${band(t1, t2)}" fill="#C62828" fill-opacity="0.85"/>
    <polygon points="${band(t2, t3)}" fill="#E0A800" fill-opacity="0.9"/>
    <polyline points="${freiLine}" fill="none" stroke="#2E7D32" stroke-width="2.5"/>
    <text x="6" y="${padT}" fill="#6B6B6B" font-size="11">${Math.round(maxEuro).toLocaleString("de-DE")} €</text>
    <text x="6" y="${H - padB}" fill="#6B6B6B" font-size="11">0 €</text>
    <text x="${W - padR + 6}" y="${padT}" fill="#2E7D32" font-size="11">${Math.round(maxFrei)}</text>
    <text x="${W - padR + 6}" y="${H - padB}" fill="#2E7D32" font-size="11">0</text>
    ${xlab}
  </svg>
  <div class="donut-legend" style="flex-direction:row;gap:16px;margin-top:8px;flex-wrap:wrap">
    <span><i style="background:#2F5DA8"></i>Cash</span>
    <span><i style="background:#C62828"></i>Investiert</span>
    <span><i style="background:#E0A800"></i>Portfoliogewinn €</span>
    <span><i style="background:#2E7D32"></i>Freiheit in Monaten (rechte Achse)</span>
  </div>`;
  const svg = el.querySelector("svg");
  let tip = el.querySelector(".chart-tip");
  if (!tip) { tip = document.createElement("div"); tip.className = "chart-tip"; el.appendChild(tip); }
  svg.addEventListener("mousemove", (e) => {
    const rect = svg.getBoundingClientRect();
    const sx = (e.clientX - rect.left) / rect.width * W;
    let best = 0, bd = Infinity;
    points.forEach((p, i) => { const d = Math.abs(X(i) - sx); if (d < bd) { bd = d; best = i; } });
    const p = points[best];
    tip.innerHTML = `<b>${fmtMonthLong(p.m)}</b><br>Cash: ${euro(p.cash)}<br>Investiert: ${euro(p.invested)}<br>Portfoliogewinn: ${euro(p.gain)}<br>Gesamt: ${euro(p.cash + Math.max(0, p.value))}<br>Freiheit: ${p.freiheit.toLocaleString("de-DE", { maximumFractionDigits: 0 })} Monate`;
    tip.style.left = Math.max(80, Math.min(rect.width - 80, (X(best) / W) * rect.width)) + "px";
    tip.style.top = ((Ye(p.cash + Math.max(0, p.value)) / H) * rect.height) + "px";
    tip.style.display = "";
  });
  svg.addEventListener("mouseleave", () => { tip.style.display = "none"; });
}

// ---- Diagramm-Helfer ----
function drawAreaChart(el, points) {
  if (!el) return;
  if (points.length < 2) { el.innerHTML = `<div class="empty">Zu wenig Daten für einen Verlauf.</div>`; return; }
  const W = 820, H = 240, padL = 64, padR = 16, padT = 20, padB = 42, n = points.length;
  const maxV = Math.max(...points.map((p) => p.v), 1), minV = Math.min(...points.map((p) => p.v), 0);
  const X = (i) => padL + (n === 1 ? 0.5 : i / (n - 1)) * (W - padL - padR);
  const Y = (v) => H - padB - (maxV === minV ? 0.5 : (v - minV) / (maxV - minV)) * (H - padT - padB);
  const line = points.map((p, i) => `${X(i).toFixed(1)},${Y(p.v).toFixed(1)}`).join(" ");
  const area = `${X(0).toFixed(1)},${H - padB} ${line} ${X(n - 1).toFixed(1)},${H - padB}`;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    <polygon points="${area}" fill="rgba(47,93,168,0.15)"/>
    <polyline points="${line}" fill="none" stroke="#2F5DA8" stroke-width="2.5"/>
    <line id="da-guide" y1="${padT}" y2="${H - padB}" stroke="#C4C4C4" stroke-width="1" style="display:none"/>
    <circle id="da-dot" r="4" fill="#2F5DA8" stroke="#FFFFFF" stroke-width="1.5" style="display:none"/>
    <text x="${padL}" y="${padT - 6}" fill="#6B6B6B" font-size="12">${Math.round(maxV).toLocaleString("de-DE")} €</text>
    <text x="${padL}" y="${H - padB + 16}" fill="#6B6B6B" font-size="12">${fmtMonthShort(points[0].m)}</text>
    <text x="${W - padR}" y="${H - padB + 16}" fill="#6B6B6B" font-size="12" text-anchor="end">${fmtMonthShort(points[n - 1].m)}</text>
  </svg><div id="da-tip" class="chart-tip" style="display:none"></div>`;
  const svg = el.querySelector("svg"), guide = el.querySelector("#da-guide"), dot = el.querySelector("#da-dot"), tip = el.querySelector("#da-tip");
  svg.addEventListener("mousemove", (e) => {
    const rect = svg.getBoundingClientRect();
    const sx = (e.clientX - rect.left) / rect.width * W;
    let best = 0, bd = Infinity;
    points.forEach((p, i) => { const d = Math.abs(X(i) - sx); if (d < bd) { bd = d; best = i; } });
    const p = points[best], gx = X(best), gy = Y(p.v);
    guide.setAttribute("x1", gx); guide.setAttribute("x2", gx); guide.style.display = "";
    dot.setAttribute("cx", gx); dot.setAttribute("cy", gy); dot.style.display = "";
    tip.innerHTML = `<b>${fmtMonthLong(p.m)}</b><br>Vermögen: <b>${euro(p.v)}</b>`;
    tip.style.left = Math.max(70, Math.min(rect.width - 70, (gx / W) * rect.width)) + "px";
    tip.style.top = ((gy / H) * rect.height) + "px"; tip.style.display = "";
  });
  svg.addEventListener("mouseleave", () => { guide.style.display = "none"; dot.style.display = "none"; tip.style.display = "none"; });
}

// Schuldenentwicklung: Gesamt-Restschuld (Immobilien) je Monat, anteilig gewichtet
function schuldenSeries() {
  const md = [];
  (typeof immoSchuld !== "undefined" ? immoSchuld : []).forEach((s) => { if (s.datum) md.push(s.datum.slice(0, 7)); });
  if (md.length === 0) return [];
  const months = monthRange(md.reduce((a, b) => a < b ? a : b), md.reduce((a, b) => a > b ? a : b));
  const byImmo = {};
  immoSchuld.forEach((s) => { (byImmo[s.immo_id] = byImmo[s.immo_id] || []).push({ m: s.datum.slice(0, 7), wert: Number(s.restschuld) || 0 }); });
  Object.values(byImmo).forEach((a) => a.sort((x, y) => x.m < y.m ? -1 : 1));
  const anteil = (id) => { const d = immoRows.find((x) => x.id === id); return d ? (Number(d.anteil_user) || 100) / 100 : 1; };
  let out = months.map((M) => {
    let total = 0;
    Object.keys(byImmo).forEach((id) => { let last = null; for (const s of byImmo[id]) { if (s.m <= M) last = s; else break; } if (last) total += last.wert * anteil(id); });
    return { m: M, v: total };
  });
  const von = document.getElementById("filter-von").value, bis = document.getElementById("filter-bis").value;
  if (von) out = out.filter((p) => p.m >= von.slice(0, 7));
  if (bis) out = out.filter((p) => p.m <= bis.slice(0, 7));
  return out;
}

function drawDebtChart(el, points) {
  if (!el) return;
  if (points.length < 2) { el.innerHTML = `<div class="empty">Mindestens zwei Stände nötig für einen Verlauf.</div>`; return; }
  const W = 820, H = 240, padL = 64, padR = 16, padT = 20, padB = 42, n = points.length;
  const maxV = Math.max(...points.map((p) => p.v), 1);
  const X = (i) => padL + (n === 1 ? 0.5 : i / (n - 1)) * (W - padL - padR);
  const Y = (v) => H - padB - (v / maxV) * (H - padT - padB);
  const line = points.map((p, i) => `${X(i).toFixed(1)},${Y(p.v).toFixed(1)}`).join(" ");
  const area = `${X(0).toFixed(1)},${H - padB} ${line} ${X(n - 1).toFixed(1)},${H - padB}`;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    <polygon points="${area}" fill="rgba(198,40,40,0.15)"/>
    <polyline points="${line}" fill="none" stroke="#C62828" stroke-width="2.5"/>
    <line id="dd-guide" y1="${padT}" y2="${H - padB}" stroke="#C4C4C4" stroke-width="1" style="display:none"/>
    <circle id="dd-dot" r="4" fill="#C62828" stroke="#FFFFFF" stroke-width="1.5" style="display:none"/>
    <text x="${padL}" y="${padT - 6}" fill="#6B6B6B" font-size="12">${Math.round(maxV).toLocaleString("de-DE")} €</text>
    <text x="${padL}" y="${H - padB + 16}" fill="#6B6B6B" font-size="12">${fmtMonthShort(points[0].m)}</text>
    <text x="${W - padR}" y="${H - padB + 16}" fill="#6B6B6B" font-size="12" text-anchor="end">${fmtMonthShort(points[n - 1].m)}</text>
  </svg><div id="dd-tip" class="chart-tip" style="display:none"></div>`;
  const svg = el.querySelector("svg"), guide = el.querySelector("#dd-guide"), dot = el.querySelector("#dd-dot"), tip = el.querySelector("#dd-tip");
  svg.addEventListener("mousemove", (e) => {
    const rect = svg.getBoundingClientRect();
    const sx = (e.clientX - rect.left) / rect.width * W;
    let best = 0, bd = Infinity;
    points.forEach((p, i) => { const d = Math.abs(X(i) - sx); if (d < bd) { bd = d; best = i; } });
    const p = points[best], gx = X(best), gy = Y(p.v);
    guide.setAttribute("x1", gx); guide.setAttribute("x2", gx); guide.style.display = "";
    dot.setAttribute("cx", gx); dot.setAttribute("cy", gy); dot.style.display = "";
    tip.innerHTML = `<b>${fmtMonthLong(p.m)}</b><br>Schulden: <b>${euro(p.v)}</b>`;
    tip.style.left = Math.max(70, Math.min(rect.width - 70, (gx / W) * rect.width)) + "px";
    tip.style.top = ((gy / H) * rect.height) + "px"; tip.style.display = "";
  });
  svg.addEventListener("mouseleave", () => { guide.style.display = "none"; dot.style.display = "none"; tip.style.display = "none"; });
}

// Netto-Investitionen je Monat (Δ investiertes Kapital im ETF & Aktien)
function investmentSeries() {
  const md = [];
  portfolioRows.forEach((r) => { if (r.datum) md.push(r.datum.slice(0, 7)); });
  if (md.length === 0) return [];
  const months = monthRange(md.reduce((a, b) => a < b ? a : b), md.reduce((a, b) => a > b ? a : b));
  const posSnaps = {};
  portfolioRows.forEach((r) => {
    if (!r.datum) return;
    const bank = r.bank || "";
    if (!bankSelected(bank)) return;
    const key = bank + "|" + (r.bezeichnung || "");
    (posSnaps[key] = posSnaps[key] || []).push({ m: r.datum.slice(0, 7), inv: Number(r.investiert) || 0, bank });
  });
  Object.values(posSnaps).forEach((a) => a.sort((x, y) => x.m < y.m ? -1 : 1));
  const totals = months.map((M) => {
    let inv = 0;
    Object.values(posSnaps).forEach((arr) => { let last = null; for (const s of arr) { if (s.m <= M) last = s; else break; } if (last) inv += last.inv * userShare(last.bank); });
    return inv;
  });
  let out = months.map((m, i) => ({ m, delta: i === 0 ? totals[0] : totals[i] - totals[i - 1] }));
  const von = document.getElementById("filter-von").value, bis = document.getElementById("filter-bis").value;
  if (von) out = out.filter((p) => p.m >= von.slice(0, 7));
  if (bis) out = out.filter((p) => p.m <= bis.slice(0, 7));
  return out;
}

function drawInvestmentChart(el, points) {
  if (!el) return;
  if (points.length === 0) { el.innerHTML = `<div class="empty">Keine Portfolio-Daten.</div>`; return; }
  const W = 820, H = 240, padL = 70, padR = 16, padT = 20, padB = 42, n = points.length;
  const maxAbs = Math.max(1, ...points.map((p) => Math.abs(p.delta)));
  const half = (H - padT - padB) / 2;
  const Y0 = padT + half;
  const slot = (W - padL - padR) / n, bw = Math.min(20, slot * 0.6);
  let bars = "", labels = "";
  const every = n <= 12 ? 1 : Math.ceil(n / 12);
  points.forEach((p, i) => {
    const cx = padL + slot * i + slot / 2;
    const h = (Math.abs(p.delta) / maxAbs) * half;
    const y = p.delta >= 0 ? Y0 - h : Y0;
    const color = p.delta >= 0 ? "#2E7D32" : "#C62828";
    bars += `<rect x="${(cx - bw / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" fill="${color}"/>`;
    if (i % every === 0 || i === n - 1) labels += `<text x="${cx.toFixed(1)}" y="${H - padB + 16}" fill="#6B6B6B" font-size="11" text-anchor="middle">${fmtMonthShort(p.m)}</text>`;
  });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    <line x1="${padL}" y1="${Y0}" x2="${W - padR}" y2="${Y0}" stroke="#E0E0E0"/>
    ${bars}${labels}
    <text x="6" y="${padT}" fill="#6B6B6B" font-size="11">+${Math.round(maxAbs).toLocaleString("de-DE")} €</text>
    <text x="6" y="${H - padB}" fill="#6B6B6B" font-size="11">−${Math.round(maxAbs).toLocaleString("de-DE")} €</text>
  </svg>
  <div class="donut-legend" style="flex-direction:row;gap:18px;margin-top:8px"><span><i style="background:#2E7D32"></i>Zukauf</span><span><i style="background:#C62828"></i>Verkauf</span></div>`;
}

function drawCashflowChart(el, points) {
  if (!el) return;
  if (points.length === 0) { el.innerHTML = `<div class="empty">Keine Buchungen im Zeitraum.</div>`; return; }
  const W = 820, H = 240, padL = 64, padR = 16, padT = 20, padB = 42, n = points.length;
  const maxV = Math.max(1, ...points.map((p) => Math.max(p.ein, Math.abs(p.aus))));
  const slot = (W - padL - padR) / n, bw = Math.min(16, slot / 2 - 2);
  let bars = "", labels = "";
  const every = n <= 12 ? 1 : Math.ceil(n / 12);
  points.forEach((p, i) => {
    const cx = padL + slot * i + slot / 2;
    const einH = (p.ein / maxV) * (H - padT - padB), ausH = (Math.abs(p.aus) / maxV) * (H - padT - padB);
    bars += `<rect x="${(cx - bw - 1).toFixed(1)}" y="${(H - padB - einH).toFixed(1)}" width="${bw}" height="${einH.toFixed(1)}" fill="#2E7D32"/>`;
    bars += `<rect x="${(cx + 1).toFixed(1)}" y="${(H - padB - ausH).toFixed(1)}" width="${bw}" height="${ausH.toFixed(1)}" fill="#C62828"/>`;
    if (i % every === 0) labels += `<text x="${cx.toFixed(1)}" y="${H - padB + 16}" fill="#6B6B6B" font-size="11" text-anchor="middle">${fmtMonthShort(p.m)}</text>`;
  });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    <line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" stroke="#E0E0E0"/>
    ${bars}${labels}
    <text x="${padL}" y="${padT - 6}" fill="#6B6B6B" font-size="12">${Math.round(maxV).toLocaleString("de-DE")} €</text>
  </svg>
  <div class="donut-legend" style="flex-direction:row;gap:18px;margin-top:8px"><span><i style="background:#2E7D32"></i>Einnahmen</span><span><i style="background:#C62828"></i>Ausgaben</span></div>`;
}

function drawDonut(el, segs) {
  if (!el) return;
  const total = segs.reduce((s, x) => s + x.value, 0);
  if (total <= 0) { el.innerHTML = `<div class="empty">Keine Daten.</div>`; return; }
  const r = 60, c = 2 * Math.PI * r, cx = 80, cy = 80, sw = 24;
  let off = 0, circles = "";
  segs.forEach((s) => {
    const len = (s.value / total) * c;
    circles += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${sw}" stroke-dasharray="${len.toFixed(2)} ${(c - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>`;
    off += len;
  });
  const legend = segs.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.label)} – ${euro(s.value)} (${(s.value / total * 100).toLocaleString("de-DE", { maximumFractionDigits: 0 })} %)</span>`).join("");
  el.innerHTML = `<div class="donut-wrap"><svg width="160" height="160" viewBox="0 0 160 160">${circles}</svg><div class="donut-legend">${legend}</div></div>`;
}

// ---- Dashboard-Filter ----
document.querySelectorAll("[data-period]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const p = btn.getAttribute("data-period"), now = new Date();
    const pad = (x) => String(x).padStart(2, "0");
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const von = document.getElementById("filter-von"), bis = document.getElementById("filter-bis");
    if (p === "all") { von.value = ""; bis.value = ""; }
    else if (p === "month") { von.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`; bis.value = today; }
    else if (p === "year") { von.value = `${now.getFullYear()}-01-01`; bis.value = today; }
    applyFilters();
  });
});
document.getElementById("dash-bank-filter").addEventListener("change", (e) => {
  if (!e.target.classList.contains("dash-bank-cb")) return;
  const checked = [...document.querySelectorAll(".dash-bank-cb:checked")].map((c) => c.value);
  dashBankFilter = (checked.length === bankNames().length) ? new Set() : new Set(checked);
  renderDashboard();
});

// ======================================================================
//  Immobilien
// ======================================================================
let immoRows = [];
let activeImmo = null;  // null = Übersicht, sonst Immobilien-id

function renderImmoSubmenu() {
  const wrap = document.getElementById("immo-submenu");
  if (!wrap) return;
  const items = [{ key: "", label: "Übersicht" }].concat(immoRows.map((d) => ({ key: d.id, label: d.bezeichnung || "(ohne Name)" })));
  wrap.innerHTML = items.map((it) =>
    `<a href="#" class="subnav-item ${(activeImmo || "") === it.key ? "active" : ""}" data-immo="${it.key}">${esc(it.label)}</a>`
  ).join("");
}
function immoName(id) { const d = immoRows.find((x) => x.id === id); return d ? (d.bezeichnung || "(ohne Name)") : ""; }
document.getElementById("immo-submenu").addEventListener("click", (e) => {
  const a = e.target.closest(".subnav-item"); if (!a) return;
  e.preventDefault();
  const id = a.getAttribute("data-immo");
  activeImmo = id || null;
  showPage("immobilien", activeImmo ? "Immobilien – " + immoName(activeImmo) : "Immobilien");
  renderImmoSubmenu();
  renderImmo();
});

function applyImmoMode() {
  const overview = !activeImmo;
  document.getElementById("immo-cards").classList.toggle("hidden", !overview);
  document.getElementById("immo-addbar").classList.toggle("hidden", !overview);
  document.getElementById("immo-tx").classList.toggle("hidden", overview);
  const lbl = document.getElementById("immo-mode-label");
  if (lbl) lbl.textContent = overview ? "Übersicht – alle Immobilien" : "Immobilie: " + immoName(activeImmo);
}

function renderImmoTx() {
  if (!activeImmo) return;
  const rows = allRows.filter((r) => r.immo_id === activeImmo && inRange(r));
  let ein = 0, aus = 0;
  rows.forEach((r) => { ein += Number(r.haben) || 0; aus += Number(r.soll) || 0; });
  document.getElementById("immo-tx-ein").textContent = euro(ein);
  document.getElementById("immo-tx-aus").textContent = euro(aus);
  const sEl = document.getElementById("immo-tx-saldo");
  sEl.textContent = euro(ein + aus); sEl.className = "v " + ((ein + aus) >= 0 ? "pos" : "neg");
  const body = document.getElementById("immo-tx-body");
  if (rows.length === 0) { body.innerHTML = `<tr><td colspan="6" class="empty">Noch keine Transaktionen zugeordnet. Im Bereich „Transaktionen" eine Buchung bearbeiten und dort die Immobilie wählen.</td></tr>`; return; }
  body.innerHTML = [...rows].sort((a, b) => (a.buchungsdatum < b.buchungsdatum ? 1 : -1)).map((r) =>
    `<tr><td>${r.buchungsdatum ? new Date(r.buchungsdatum).toLocaleDateString("de-DE") : ""}</td><td>${esc(r.beschreibung)}</td><td>${esc(r.kategorie)}</td><td>${esc(r.bank)}</td><td class="num neg">${r.soll != null ? euro(r.soll) : ""}</td><td class="num pos">${r.haben != null ? euro(r.haben) : ""}</td></tr>`
  ).join("");
}

function populateImmoSelect() {
  const el = document.getElementById("f-immo");
  if (!el) return;
  const cur = el.value;
  el.innerHTML = `<option value="">—</option>` + immoRows.map((d) => `<option value="${d.id}" ${d.id === cur ? "selected" : ""}>${esc(d.bezeichnung || "(ohne Name)")}</option>`).join("");
}
const pctDE = (v) => (v == null || isNaN(v) ? "–" : Number(v).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " %");
const num1 = (v) => Number(v || 0).toLocaleString("de-DE", { maximumFractionDigits: 1 });

function immoKPIs(d) {
  const n = (v) => Number(v) || 0;
  const marktwert = n(d.marktwert), restschuld = n(d.restschuld);
  const ekWert = marktwert - restschuld;
  const ltv = marktwert > 0 ? restschuld / marktwert * 100 : 0;
  const verm = d.typ === "vermietung";
  const leer = Math.min(100, Math.max(0, n(d.leerstand)));
  const effMiete = verm ? n(d.bruttomiete) * (1 - leer / 100) : 0;
  const neben = n(d.condominio) + n(d.versicherung) + n(d.instandhaltung);
  const imuM = d.imu_faellig ? n(d.imu_jahr) / 12 : 0;
  let steuerM = 0;
  if (verm) {
    if (d.steuermodell === "cedolare") steuerM = effMiete * 0.21;
    else if (d.steuermodell === "cedolare_concordato") steuerM = effMiete * 0.10;
    else if (d.steuermodell === "irpef") steuerM = Math.max(0, effMiete - neben) * (n(d.grenzsteuersatz) / 100);
  }
  const mieteNetto = verm ? (effMiete - neben - imuM - steuerM) : 0;
  const nettorendite = marktwert > 0 ? (mieteNetto * 12) / marktwert * 100 : 0;
  const jahreszins = restschuld * n(d.zinssatz) / 100;
  const roe = ekWert !== 0 ? ((mieteNetto * 12) - jahreszins) / ekWert * 100 : 0;
  const cashflowSchuld = mieteNetto - n(d.rate_monat);
  const gesamtrendite = verm ? (nettorendite + n(d.wertsteigerung)) : n(d.wertsteigerung);
  return { ekWert, ltv, mieteNetto, nettorendite, roe, cashflowSchuld, gesamtrendite, verm, steuerM, imuM };
}

let immoSchuld = [];
function immoSchuldHistory(id) { return immoSchuld.filter((s) => s.immo_id === id).slice().sort((a, b) => (a.datum < b.datum ? -1 : 1)); }

let immoShares = [];

async function loadImmo() {
  const [im, sc, sh] = await Promise.all([
    sb.from("immobilien").select("*").order("created_at", { ascending: true }),
    sb.from("immo_schuld").select("*").order("datum", { ascending: true }),
    sb.from("immo_shares").select("*"),
  ]);
  if (im.error) { console.error(im.error); return; }
  immoRows = im.data || [];
  immoSchuld = sc.error ? [] : (sc.data || []);
  immoShares = sh.error ? [] : (sh.data || []);
  renderImmoSubmenu();
  populateImmoSelect();
  renderImmo();
  renderDashboard();
}

function selOpts(field, val, opts) {
  return opts.map(([v, l]) => `<option value="${v}" ${(val || "") === v ? "selected" : ""}>${l}</option>`).join("");
}
// Tilgungsplan aus Darlehensdaten (Annuität) berechnen und als Tabelle rendern
function immoTilgungsplanHTML(d) {
  const n = (v) => Number(v) || 0;
  const start = n(d.darlehen_start), zins = n(d.zinssatz) / 100 / 12, rate = n(d.rate_monat);
  if (start <= 0 || rate <= 0) return `<div class="empty">Unvollständige Daten für Tilgungsplan.</div>`;
  let restschuld = start;
  const startDate = d.tilgung_start ? new Date(d.tilgung_start + "T00:00:00") : new Date();
  const rows = [];
  let totalZins = 0, monat = 0, maxMonat = 600;
  while (restschuld > 0.01 && monat < maxMonat) {
    const zinsAnteil = restschuld * zins;
    const tilgAnteil = Math.min(rate - zinsAnteil, restschuld);
    if (tilgAnteil <= 0) break;
    restschuld -= tilgAnteil;
    totalZins += zinsAnteil;
    const d2 = new Date(startDate); d2.setMonth(d2.getMonth() + monat);
    if (monat < 24 || monat % 12 === 11) rows.push({ datum: d2, zins: zinsAnteil, tilg: tilgAnteil, rest: Math.max(0, restschuld) });
    monat++;
  }
  const getilgt = start - Math.max(0, restschuld);
  const pct = start > 0 ? (getilgt / start * 100).toFixed(1) : 0;
  return `<div style="margin-bottom:10px">
    <div style="background:var(--panel2);border-radius:4px;height:10px;overflow:hidden;margin-bottom:6px">
      <div style="width:${pct}%;height:10px;background:var(--accent);border-radius:4px"></div>
    </div>
    <div style="font-size:12px;color:var(--muted)">Getilgt: ${euro(getilgt)} von ${euro(start)} (${pct} %) · Gesamtzinsen: ~${euro(totalZins)} · Laufzeit: ~${Math.round(monat / 12)} Jahre</div>
  </div>
  <table>
    <thead><tr><th>Datum</th><th style="text-align:right">Zinsanteil</th><th style="text-align:right">Tilgung</th><th style="text-align:right">Restschuld</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td>${r.datum.toLocaleDateString("de-DE", { month: "2-digit", year: "numeric" })}</td><td class="num">${euro(r.zins)}</td><td class="num">${euro(r.tilg)}</td><td class="num">${euro(r.rest)}</td></tr>`).join("")}</tbody>
  </table>`;
}

function immoFieldsHTML(d) {
  const v = (f) => fmtNum(d[f]);
  return `
    <div class="immo-section">
      <h4>Grunddaten</h4>
      <div class="immo-grid">
        <div><label>Bezeichnung</label><input type="text" data-f="bezeichnung" value="${esc(d.bezeichnung || "")}" /></div>
        <div><label>Typ</label><select data-f="typ">${selOpts("typ", d.typ, [["vermietung", "Vermietung"], ["eigennutzung", "Eigennutzung"]])}</select></div>
        <div><label>Kaufjahr</label><input type="text" inputmode="numeric" data-f="kaufjahr" value="${d.kaufjahr || ""}" /></div>
        <div><label>Kaufpreis (€)</label><input type="text" inputmode="decimal" data-f="kaufpreis" value="${v("kaufpreis")}" /></div>
        <div><label>Kaufnebenkosten (€)</label><input type="text" inputmode="decimal" data-f="kaufnebenkosten" value="${v("kaufnebenkosten")}" /></div>
        <div><label>Bindung</label><select data-f="bindung">${bindOptions(d.bindung)}</select></div>
      </div>
    </div>
    <div class="immo-section">
      <h4>Wert &amp; Finanzierung</h4>
      <div class="immo-grid">
        <div><label>Marktwert (€)</label><input type="text" inputmode="decimal" data-f="marktwert" value="${v("marktwert")}" /></div>
        <div><label>Restschuld (€) <span style="font-size:11px;color:var(--muted)">(oder aus Tilgungsplan)</span></label><input type="text" inputmode="decimal" data-f="restschuld" value="${v("restschuld")}" /></div>
        <div><label>Ursprünglicher Darlehensbetrag (€)</label><input type="text" inputmode="decimal" data-f="darlehen_start" value="${v("darlehen_start")}" /></div>
        <div><label>Tilgungsbeginn</label><input type="date" data-f="tilgung_start" value="${d.tilgung_start || ""}" /></div>
        <div><label>Monatliche Rate (€)</label><input type="text" inputmode="decimal" data-f="rate_monat" value="${v("rate_monat")}" /></div>
        <div data-fin><label>Zinssatz (%)</label><input type="text" inputmode="decimal" data-f="zinssatz" value="${v("zinssatz")}" /></div>
        <div data-fin><label>Restlaufzeit (Jahre)</label><input type="text" inputmode="decimal" data-f="restlaufzeit" value="${v("restlaufzeit")}" /></div>
        <div><label>Wertsteigerung p.a. (%)</label><input type="text" inputmode="decimal" data-f="wertsteigerung" value="${v("wertsteigerung")}" /></div>
        <div><label>Dein Anteil (%)</label><input type="text" inputmode="decimal" data-f="anteil_user" value="${d.anteil_user != null ? fmtNum(d.anteil_user) : "100"}" /></div>
      </div>
    </div>
    <div class="immo-section">
      <h4>Schuldenverlauf</h4>
      <div class="toolbar" style="margin-bottom:10px">
        <input type="date" data-immo-schuld-datum style="max-width:170px" />
        <input type="text" inputmode="decimal" data-immo-schuld-wert placeholder="Restschuld (€)" style="max-width:170px" value="${v("restschuld")}" />
        <button class="secondary" data-immo-schuld-add>Stand erfassen</button>
      </div>
      <div style="overflow-x:auto">
        <table>
          <thead><tr><th>Datum</th><th style="text-align:right">Restschuld</th><th></th></tr></thead>
          <tbody data-immo-schuld-body></tbody>
        </table>
      </div>
    </div>
    ${d.darlehen_start && d.zinssatz && d.rate_monat ? `<div class="immo-section">
      <h4 style="cursor:pointer;user-select:none" data-tilgplan-toggle>Tilgungsplan <span style="font-size:12px;font-weight:400;color:var(--muted)">(klicken zum Öffnen)</span></h4>
      <div data-tilgplan-body class="hidden" style="overflow-x:auto">${immoTilgungsplanHTML(d)}</div>
    </div>` : ""}
    <div class="immo-section" data-miet>
      <h4>Mieteinnahmen &amp; Kosten</h4>
      <div class="immo-grid">
        <div data-vermiet><label>Bruttomiete/Monat (€)</label><input type="text" inputmode="decimal" data-f="bruttomiete" value="${v("bruttomiete")}" /></div>
        <div data-vermiet><label>Leerstandsquote (%)</label><input type="text" inputmode="decimal" data-f="leerstand" value="${v("leerstand")}" /></div>
        <div><label>Condominio/Monat (€)</label><input type="text" inputmode="decimal" data-f="condominio" value="${v("condominio")}" /></div>
        <div><label>Versicherung/Monat (€)</label><input type="text" inputmode="decimal" data-f="versicherung" value="${v("versicherung")}" /></div>
        <div><label>Instandhaltung/Monat (€)</label><input type="text" inputmode="decimal" data-f="instandhaltung" value="${v("instandhaltung")}" /></div>
        <div data-vermiet><label>Steuermodell</label><select data-f="steuermodell">${selOpts("steuermodell", d.steuermodell, [["cedolare", "Cedolare Secca 21 %"], ["cedolare_concordato", "Cedolare concordato 10 %"], ["irpef", "Ordentlich (IRPEF)"], ["keine", "Keine"]])}</select></div>
        <div data-irpef><label>Grenzsteuersatz (%)</label><input type="text" inputmode="decimal" data-f="grenzsteuersatz" value="${d.grenzsteuersatz != null ? fmtNum(d.grenzsteuersatz) : "23"}" /></div>
        <div><label>Erstwohnsitz (IMU-befreit)</label><select data-f="erstwohnsitz"><option value="nein" ${!d.erstwohnsitz ? "selected" : ""}>Nein</option><option value="ja" ${d.erstwohnsitz ? "selected" : ""}>Ja</option></select></div>
        <div><label>Immobilie im Ausland (IVIE)</label><select data-f="im_ausland_immo"><option value="nein" ${!d.im_ausland ? "selected" : ""}>Nein</option><option value="ja" ${d.im_ausland ? "selected" : ""}>Ja</option></select></div>
        <div><label>IMU fällig</label><select data-f="imu_faellig"><option value="nein" ${!d.imu_faellig ? "selected" : ""}>Nein</option><option value="ja" ${d.imu_faellig ? "selected" : ""}>Ja</option></select></div>
        <div data-imu><label>IMU/Jahr (€)</label><input type="text" inputmode="decimal" data-f="imu_jahr" value="${v("imu_jahr")}" /></div>
      </div>
    </div>
    <div class="immo-section">
      <h4>Kennzahlen</h4>
      <div class="kpi-grid">
        <div class="kpibox" data-miet><div class="kpi-k">Nettomietrendite n. St.</div><div class="kpi-v" data-k="nettorendite">–</div></div>
        <div class="kpibox" data-miet><div class="kpi-k">Eigenkapitalrendite (ROE)</div><div class="kpi-v" data-k="roe">–</div></div>
        <div class="kpibox" data-miet><div class="kpi-k">Mieteinnahmen netto/Monat</div><div class="kpi-v" data-k="mieteNetto">–</div></div>
      </div>
      <div class="kpi-grid" style="grid-template-columns:repeat(2,1fr)">
        <div class="kpibox" data-miet><div class="kpi-k">Cashflow n. Schuldendienst/Monat</div><div class="kpi-v" data-k="cashflowSchuld">–</div></div>
        <div class="kpibox"><div class="kpi-k">Gesamtrendite p.a.</div><div class="kpi-v" data-k="gesamtrendite">–</div></div>
      </div>
      <div class="kpi-grid" style="grid-template-columns:repeat(2,1fr);margin-bottom:0">
        <div class="kpibox"><div class="kpi-k">LTV</div><div class="kpi-v" data-k="ltv">–</div></div>
        <div class="kpibox"><div class="kpi-k">EK-Wert</div><div class="kpi-v" data-k="ekWert">–</div></div>
      </div>
    </div>
    ${immoSharesHTML(d.id)}
    <div class="immo-actions">
      <button data-immo-save>Speichern</button>
      <span data-immo-msg style="font-size:13px"></span>
    </div>`;
}

function immoSharesHTML(immoId) {
  const shares = immoShares.filter((s) => s.immo_id === immoId);
  const shareList = shares.map((s) => `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border)">
    <span style="flex:1;font-size:13px">${esc(s.shared_with)}</span>
    ${s.anteil != null ? `<span style="font-size:12px;color:var(--muted)">${fmtNum(s.anteil)} %</span>` : ""}
    <span style="font-size:11px;color:var(--muted)">${s.rolle || "viewer"}</span>
    <button class="danger" style="font-size:11px;padding:2px 8px" data-share-del="${s.id}">✕</button>
  </div>`).join("");
  return `<div class="immo-section">
    <h4>Teilen mit anderen Nutzern</h4>
    <div id="shares-${immoId}">${shareList || `<div style="font-size:13px;color:var(--muted);padding:4px 0">Noch nicht geteilt.</div>`}</div>
    <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
      <input type="email" placeholder="E-Mail des Nutzers" data-share-email style="flex:2;min-width:140px;font-size:12px;padding:5px 8px" />
      <input type="text" inputmode="decimal" placeholder="Anteil %" data-share-anteil style="max-width:90px;font-size:12px;padding:5px 8px" />
      <select data-share-rolle style="font-size:12px;padding:5px 8px"><option value="viewer">Nur Ansicht</option><option value="editor">Bearbeiten</option></select>
      <button class="secondary" data-share-add data-immo-id="${immoId}" style="font-size:12px;padding:5px 10px">Teilen</button>
    </div>
  </div>`;
}

function immoCardHTML(d) {
  const k = immoKPIs(d);
  return `<div class="immo-card collapsed" data-id="${d.id}">
    <div class="immo-head" data-immo-toggle>
      <span class="chev">▾</span>
      <div class="titlewrap">
        <div class="immo-title">${esc(d.bezeichnung || "Neue Immobilie")}</div>
        <div class="immo-sub">${euro(Number(d.marktwert) || 0)} | EK: ${euro(k.ekWert)} | LTV: ${num1(k.ltv)} %</div>
      </div>
      <button class="iconbtn" data-immo-del title="Löschen"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
    </div>
    <div class="immo-body">${immoFieldsHTML(d)}</div>
  </div>`;
}

function readImmoCard(card) {
  const g = (f) => { const el = card.querySelector(`[data-f="${f}"]`); return el ? el.value : ""; };
  return {
    id: card.getAttribute("data-id") || null,
    bezeichnung: g("bezeichnung") || null,
    typ: g("typ") || "vermietung",
    kaufjahr: g("kaufjahr") ? (parseInt(String(g("kaufjahr")).replace(/\D/g, "")) || null) : null,
    kaufpreis: numDE(g("kaufpreis")), kaufnebenkosten: numDE(g("kaufnebenkosten")), marktwert: numDE(g("marktwert")), restschuld: numDE(g("restschuld")),
    darlehen_start: numDE(g("darlehen_start")), tilgung_start: g("tilgung_start") || null,
    rate_monat: numDE(g("rate_monat")), zinssatz: numDE(g("zinssatz")), restlaufzeit: numDE(g("restlaufzeit")),
    wertsteigerung: numDE(g("wertsteigerung")), bruttomiete: numDE(g("bruttomiete")), leerstand: numDE(g("leerstand")),
    condominio: numDE(g("condominio")), versicherung: numDE(g("versicherung")), instandhaltung: numDE(g("instandhaltung")),
    steuermodell: g("steuermodell") || "cedolare", grenzsteuersatz: numDE(g("grenzsteuersatz")),
    imu_faellig: g("imu_faellig") === "ja", imu_jahr: numDE(g("imu_jahr")), anteil_user: numDE(g("anteil_user")),
    bindung: g("bindung") || null,
    erstwohnsitz: g("erstwohnsitz") === "ja",
    im_ausland: g("im_ausland_immo") === "ja",
  };
}

function recomputeImmoCard(card) {
  const d = readImmoCard(card);
  const k = immoKPIs(d);
  const verm = d.typ === "vermietung";
  const schuldenfrei = (Number(d.restschuld) || 0) <= 0;
  card.querySelectorAll("[data-vermiet]").forEach((e) => e.style.display = verm ? "" : "none");
  card.querySelectorAll("[data-miet]").forEach((e) => e.style.display = verm ? "" : "none");
  card.querySelectorAll("[data-irpef]").forEach((e) => e.style.display = (verm && d.steuermodell === "irpef") ? "" : "none");
  card.querySelectorAll("[data-imu]").forEach((e) => e.style.display = d.imu_faellig ? "" : "none");
  card.querySelectorAll("[data-fin]").forEach((e) => e.style.opacity = schuldenfrei ? "0.5" : "1");
  const set = (key, val) => { const el = card.querySelector(`[data-k="${key}"]`); if (el) el.innerHTML = val; };
  set("nettorendite", pctDE(k.nettorendite));
  set("roe", schuldenfrei ? pctDE(k.nettorendite) : pctDE(k.roe));
  set("mieteNetto", euro(k.mieteNetto));
  const cfEl = card.querySelector('[data-k="cashflowSchuld"]');
  if (cfEl) { cfEl.textContent = euro(k.cashflowSchuld); cfEl.style.color = k.cashflowSchuld >= 0 ? "var(--green)" : "var(--red)"; }
  set("gesamtrendite", pctDE(k.gesamtrendite));
  const ltvColor = k.ltv < 60 ? "var(--green)" : k.ltv <= 80 ? "var(--warning)" : "var(--red)";
  set("ltv", `<span class="dot" style="background:${ltvColor}"></span>${num1(k.ltv)} %`);
  set("ekWert", euro(k.ekWert));
  const sub = card.querySelector(".immo-sub");
  if (sub) sub.textContent = `${euro(Number(d.marktwert) || 0)} | EK: ${euro(k.ekWert)} | LTV: ${num1(k.ltv)} %`;
  const title = card.querySelector(".immo-title");
  if (title) title.textContent = d.bezeichnung || "Neue Immobilie";
  // Schuldenverlauf-Historie
  const sbody = card.querySelector("[data-immo-schuld-body]");
  if (sbody) {
    const hist = immoSchuldHistory(card.getAttribute("data-id"));
    sbody.innerHTML = hist.length === 0
      ? `<tr><td colspan="3" class="empty">Noch keine Stände erfasst.</td></tr>`
      : [...hist].reverse().map((s) => `<tr><td>${s.datum ? new Date(s.datum).toLocaleDateString("de-DE") : ""}</td><td class="num">${euro(Number(s.restschuld) || 0)}</td><td class="num"><button class="danger" data-immo-schuld-del="${s.id}">Löschen</button></td></tr>`).join("");
  }
}

function renderImmoSummary() {
  let ek = 0, cf = 0, rSum = 0, rCount = 0;
  immoRows.forEach((d) => {
    const k = immoKPIs(d);
    const share = (Number(d.anteil_user) || 100) / 100;
    ek += k.ekWert * share;
    if (k.verm) { cf += k.cashflowSchuld * share; rSum += k.nettorendite; rCount++; }
  });
  document.getElementById("immo-sum-ek").textContent = euro(ek);
  const cfEl = document.getElementById("immo-sum-cf");
  cfEl.textContent = euro(cf); cfEl.className = "v " + (cf >= 0 ? "pos" : "neg");
  document.getElementById("immo-sum-rendite").textContent = rCount ? pctDE(rSum / rCount) : "–";
}

function renderImmo() {
  const list = document.getElementById("immo-list");
  if (!list) return;
  const rows = activeImmo ? immoRows.filter((d) => d.id === activeImmo) : immoRows;
  list.innerHTML = rows.map(immoCardHTML).join("");
  document.getElementById("immo-empty").classList.toggle("hidden", immoRows.length > 0 || activeImmo);
  list.querySelectorAll(".immo-card").forEach((card) => recomputeImmoCard(card));
  const iso = isoDate(new Date());
  list.querySelectorAll("[data-immo-schuld-datum]").forEach((el) => { el.value = iso; });
  renderImmoSummary();
  applyImmoMode();
  renderImmoTx();
}

const immoListEl = document.getElementById("immo-list");
immoListEl.addEventListener("input", (e) => { const c = e.target.closest(".immo-card"); if (c) { recomputeImmoCard(c); renderImmoSummary(); } });
immoListEl.addEventListener("change", (e) => { const c = e.target.closest(".immo-card"); if (c) { recomputeImmoCard(c); renderImmoSummary(); } });
immoListEl.addEventListener("click", async (e) => {
  const card = e.target.closest(".immo-card"); if (!card) return;
  if (e.target.closest("[data-immo-del]")) {
    e.stopPropagation();
    if (!confirm("Diese Immobilie wirklich löschen?")) return;
    const { error } = await sb.from("immobilien").delete().eq("id", card.getAttribute("data-id"));
    if (error) alert("Fehler: " + error.message); else loadImmo();
    return;
  }
  if (e.target.closest("[data-immo-schuld-add]")) {
    const id = card.getAttribute("data-id");
    const datum = card.querySelector("[data-immo-schuld-datum]").value;
    const wert = numDE(card.querySelector("[data-immo-schuld-wert]").value);
    if (!datum || wert == null) { alert("Bitte Datum und Restschuld eingeben."); return; }
    const { error } = await sb.from("immo_schuld").insert([{ immo_id: id, datum, restschuld: wert }]);
    if (error) { alert("Fehler: " + error.message); return; }
    await sb.from("immobilien").update({ restschuld: wert }).eq("id", id);  // aktuelle Restschuld = letzter Stand
    loadImmo();
    return;
  }
  const schuldDel = e.target.closest("[data-immo-schuld-del]");
  if (schuldDel) {
    const delId = schuldDel.getAttribute("data-immo-schuld-del");
    const immoId = card.getAttribute("data-id");
    const { error } = await sb.from("immo_schuld").delete().eq("id", delId);
    if (error) { alert("Fehler: " + error.message); return; }
    const remaining = immoSchuldHistory(immoId).filter((s) => s.id !== delId);
    const newRestschuld = remaining.length > 0 ? Number(remaining[remaining.length - 1].restschuld) : null;
    await sb.from("immobilien").update({ restschuld: newRestschuld }).eq("id", immoId);
    loadImmo();
    return;
  }
  const immoSaveBtn = e.target.closest("[data-immo-save]");
  if (immoSaveBtn) {
    immoSaveBtn.disabled = true;
    const d = readImmoCard(card); const id = d.id; delete d.id;
    const msg = card.querySelector("[data-immo-msg]");
    let error;
    if (id) ({ error } = await sb.from("immobilien").update(d).eq("id", id));
    else ({ error } = await sb.from("immobilien").insert([d]));
    immoSaveBtn.disabled = false;
    if (error) { msg.textContent = "Fehler: " + error.message; msg.style.color = "var(--red)"; return; }
    msg.textContent = "Gespeichert."; msg.style.color = "var(--green)";
    loadImmo();
    return;
  }
  if (e.target.closest("[data-immo-toggle]")) card.classList.toggle("collapsed");
  if (e.target.closest("[data-tilgplan-toggle]")) {
    const body = card.querySelector("[data-tilgplan-body]");
    if (body) body.classList.toggle("hidden");
    return;
  }
  const shareAdd = e.target.closest("[data-share-add]");
  if (shareAdd) {
    const wrap = shareAdd.closest(".immo-section");
    const email = wrap.querySelector("[data-share-email]").value.trim();
    const anteil = numDE(wrap.querySelector("[data-share-anteil]").value);
    const rolle = wrap.querySelector("[data-share-rolle]").value;
    const immoId = shareAdd.getAttribute("data-immo-id");
    if (!email) { alert("Bitte E-Mail des Nutzers eingeben."); return; }
    // Nutzer-UUID aus E-Mail ermitteln (nur wenn der Nutzer bereits registriert ist)
    const { data: users } = await sb.rpc("lookup_user_by_email", { email }).catch(() => ({ data: null }));
    const sharedWith = users && users[0] ? users[0].id : email; // Fallback: E-Mail als Placeholder
    const payload = { immo_id: immoId, shared_with: sharedWith, anteil: anteil || null, rolle };
    const { error } = await sb.from("immo_shares").insert([payload]);
    if (error) alert("Fehler: " + error.message); else loadImmo();
    return;
  }
  const shareDel = e.target.closest("[data-share-del]");
  if (shareDel) {
    const { error } = await sb.from("immo_shares").delete().eq("id", shareDel.getAttribute("data-share-del"));
    if (error) alert("Fehler: " + error.message); else loadImmo();
    return;
  }
});
document.getElementById("immo-add").addEventListener("click", async () => {
  const { error } = await sb.from("immobilien").insert([{ bezeichnung: "Neue Immobilie", typ: "vermietung", anteil_user: 100, steuermodell: "cedolare", imu_faellig: false }]);
  if (error) { alert("Fehler beim Anlegen: " + error.message); return; }
  loadImmo();
});

// ======================================================================
//  Unternehmensbeteiligungen
// ======================================================================
let betRows = [];

function betKPIs(d) {
  const n = (v) => Number(v) || 0;
  const zinsBrutto = n(d.darlehen) * n(d.zins) / 100;
  const zinsNetto = zinsBrutto * KEST_FAKTOR;
  const divNetto = d.dividende_netto ? n(d.dividende_jahr) : n(d.dividende_jahr) * KEST_FAKTOR;
  const vermoegen = n(d.marktwert) + n(d.darlehen);
  const ausschuettend = (d.zins_modus || "ausschuettend") === "ausschuettend";
  const jahresertrag = divNetto + (ausschuettend ? zinsNetto : 0);
  const basis = n(d.invest_hist) + n(d.darlehen);
  const renditeKapital = basis > 0 ? jahresertrag / basis * 100 : null;
  return { zinsNetto, zinsNettoM: zinsNetto / 12, divNetto, vermoegen, jahresertrag, monat: jahresertrag / 12, basis, renditeKapital, ausschuettend };
}

async function loadBet() {
  const { data, error } = await sb.from("beteiligungen").select("*").order("created_at", { ascending: true });
  if (error) { console.error(error); return; }
  betRows = data || [];
  renderBet();
  renderDashboard();
}

function betFieldsHTML(d) {
  const v = (f) => fmtNum(d[f]);
  return `
    <div class="immo-section">
      <h4>Beteiligung (Eigenkapital)</h4>
      <div class="immo-grid">
        <div><label>Unternehmensname</label><input type="text" data-f="name" value="${esc(d.name || "")}" /></div>
        <div><label>Beteiligungsquote (%)</label><input type="text" inputmode="decimal" data-f="quote" value="${v("quote")}" /></div>
        <div><label>Investiertes Kapital, histor. (€)</label><input type="text" inputmode="decimal" data-f="invest_hist" value="${v("invest_hist")}" /></div>
        <div><label>Geschätzter Marktwert der Quote (€)</label><input type="text" inputmode="decimal" data-f="marktwert" value="${v("marktwert")}" /></div>
        <div><label>Erw. Dividende/Jahr (€)</label><input type="text" inputmode="decimal" data-f="dividende_jahr" value="${v("dividende_jahr")}" /></div>
        <div><label>Dividende bereits netto?</label><select data-f="dividende_netto"><option value="nein" ${!d.dividende_netto ? "selected" : ""}>Nein</option><option value="ja" ${d.dividende_netto ? "selected" : ""}>Ja</option></select></div>
        <div><label>Bindung</label><select data-f="bindung">${bindOptions(d.bindung)}</select></div>
      </div>
    </div>
    <div class="immo-section">
      <h4>Gesellschafterdarlehen</h4>
      <div class="immo-grid">
        <div><label>Darlehensbetrag (€)</label><input type="text" inputmode="decimal" data-f="darlehen" value="${v("darlehen")}" /></div>
        <div data-zinsfeld><label>Verzinsung p.a. (%)</label><input type="text" inputmode="decimal" data-f="zins" value="${v("zins")}" /></div>
        <div data-zinsfeld><label>Zinsen-Modus</label><select data-f="zins_modus"><option value="ausschuettend" ${(d.zins_modus || "ausschuettend") === "ausschuettend" ? "selected" : ""}>Ausschüttend (Cash)</option><option value="thesaurierend" ${d.zins_modus === "thesaurierend" ? "selected" : ""}>Thesaurierend</option></select></div>
        <div class="kpibox" style="align-self:end"><div class="kpi-k">Zinserträge netto (n. 26 %)</div><div class="kpi-v" data-k="zinsNetto" style="font-size:15px">–</div></div>
      </div>
    </div>
    <div class="immo-section">
      <h4>Kennzahlen</h4>
      <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">
        <div class="kpibox"><div class="kpi-k">Vermögenswert gesamt</div><div class="kpi-v" data-k="vermoegen">–</div></div>
        <div class="kpibox"><div class="kpi-k">Jahresertrag netto</div><div class="kpi-v" data-k="jahresertrag">–</div></div>
        <div class="kpibox"><div class="kpi-k">Rendite auf Kapital</div><div class="kpi-v" data-k="rendite">–</div></div>
        <div class="kpibox"><div class="kpi-k">Monatlicher Nettoertrag</div><div class="kpi-v" data-k="monat">–</div></div>
      </div>
    </div>
    <div class="immo-actions">
      <button data-bet-save>Speichern</button>
      <span data-bet-msg style="font-size:13px"></span>
    </div>`;
}

function betCardHTML(d) {
  const k = betKPIs(d);
  return `<div class="immo-card collapsed" data-id="${d.id}">
    <div class="immo-head" data-bet-toggle>
      <span class="chev">▾</span>
      <div class="titlewrap">
        <div class="immo-title">${esc(d.name || "Neue Beteiligung")}</div>
        <div class="immo-sub">${num1(Number(d.quote) || 0)} % | Schätzwert: ${euro(Number(d.marktwert) || 0)} | Jahresertrag netto: ${euro(k.jahresertrag)}</div>
      </div>
      <button class="iconbtn" data-bet-del title="Löschen"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
    </div>
    <div class="immo-body">${betFieldsHTML(d)}</div>
  </div>`;
}

function readBetCard(card) {
  const g = (f) => { const el = card.querySelector(`[data-f="${f}"]`); return el ? el.value : ""; };
  return {
    id: card.getAttribute("data-id") || null,
    name: g("name") || null,
    quote: numDE(g("quote")), invest_hist: numDE(g("invest_hist")), marktwert: numDE(g("marktwert")),
    dividende_jahr: numDE(g("dividende_jahr")), dividende_netto: g("dividende_netto") === "ja",
    darlehen: numDE(g("darlehen")), zins: numDE(g("zins")), zins_modus: g("zins_modus") || "ausschuettend",
    bindung: g("bindung") || null,
  };
}

function recomputeBetCard(card) {
  const d = readBetCard(card);
  const k = betKPIs(d);
  const hatDarlehen = (Number(d.darlehen) || 0) > 0;
  card.querySelectorAll("[data-zinsfeld]").forEach((e) => e.style.opacity = hatDarlehen ? "1" : "0.5");
  const set = (key, val) => { const el = card.querySelector(`[data-k="${key}"]`); if (el) el.textContent = val; };
  set("zinsNetto", euro(k.zinsNetto) + " /J · " + euro(k.zinsNettoM) + " /M");
  set("vermoegen", euro(k.vermoegen));
  set("jahresertrag", euro(k.jahresertrag));
  set("rendite", k.renditeKapital == null ? "–" : pctDE(k.renditeKapital));
  set("monat", euro(k.monat));
  const sub = card.querySelector(".immo-sub");
  if (sub) sub.textContent = `${num1(Number(d.quote) || 0)} % | Schätzwert: ${euro(Number(d.marktwert) || 0)} | Jahresertrag netto: ${euro(k.jahresertrag)}`;
  const title = card.querySelector(".immo-title");
  if (title) title.textContent = d.name || "Neue Beteiligung";
}

function renderBetSummary() {
  let verm = 0, ertrag = 0;
  betRows.forEach((d) => { const k = betKPIs(d); verm += k.vermoegen; ertrag += k.jahresertrag; });
  document.getElementById("bet-sum-verm").textContent = euro(verm);
  document.getElementById("bet-sum-ertrag").textContent = euro(ertrag);
  document.getElementById("bet-sum-monat").textContent = euro(ertrag / 12);
}

function renderBet() {
  const list = document.getElementById("bet-list");
  if (!list) return;
  list.innerHTML = betRows.map(betCardHTML).join("");
  document.getElementById("bet-empty").classList.toggle("hidden", betRows.length > 0);
  list.querySelectorAll(".immo-card").forEach((card) => recomputeBetCard(card));
  renderBetSummary();
}

const betListEl = document.getElementById("bet-list");
betListEl.addEventListener("input", (e) => { const c = e.target.closest(".immo-card"); if (c) { recomputeBetCard(c); renderBetSummary(); } });
betListEl.addEventListener("change", (e) => { const c = e.target.closest(".immo-card"); if (c) { recomputeBetCard(c); renderBetSummary(); } });
betListEl.addEventListener("click", async (e) => {
  const card = e.target.closest(".immo-card"); if (!card) return;
  if (e.target.closest("[data-bet-del]")) {
    e.stopPropagation();
    if (!confirm("Diese Beteiligung wirklich löschen?")) return;
    const { error } = await sb.from("beteiligungen").delete().eq("id", card.getAttribute("data-id"));
    if (error) alert("Fehler: " + error.message); else loadBet();
    return;
  }
  const betSaveBtn = e.target.closest("[data-bet-save]");
  if (betSaveBtn) {
    betSaveBtn.disabled = true;
    const d = readBetCard(card); const id = d.id; delete d.id;
    const msg = card.querySelector("[data-bet-msg]");
    let error;
    if (id) ({ error } = await sb.from("beteiligungen").update(d).eq("id", id));
    else ({ error } = await sb.from("beteiligungen").insert([d]));
    betSaveBtn.disabled = false;
    if (error) { msg.textContent = "Fehler: " + error.message; msg.style.color = "var(--red)"; return; }
    msg.textContent = "Gespeichert."; msg.style.color = "var(--green)";
    loadBet();
    return;
  }
  if (e.target.closest("[data-bet-toggle]")) card.classList.toggle("collapsed");
});
document.getElementById("bet-add").addEventListener("click", async () => {
  const { error } = await sb.from("beteiligungen").insert([{ name: "Neue Beteiligung", dividende_netto: false, zins_modus: "ausschuettend" }]);
  if (error) { alert("Fehler beim Anlegen: " + error.message); return; }
  loadBet();
});

// ======================================================================
//  Pensionsfonds
// ======================================================================
let pensRows = [];
let pensStand = [];
const STEUER_MAX_PENSION = 5164.57;

// ======================================================================
//  Kategorien (zweistufig)
// ======================================================================
let katRows = [];

async function loadKategorien() {
  const { data } = await sb.from("kategorien").select("*").order("name");
  katRows = data || [];
  fillKatDropdowns();
}

function katOberRows() { return katRows.filter((k) => !k.parent_id); }
function katUnterRows(oberId) { return katRows.filter((k) => k.parent_id === oberId); }

function fillKatDropdowns() {
  const ober = document.getElementById("f-kat-ober");
  if (!ober) return;
  const sel = ober.value;
  ober.innerHTML = `<option value="">– Oberkategorie –</option>` +
    katOberRows().map((k) => `<option value="${k.id}">${esc(k.name)}</option>`).join("") +
    `<option value="__text__">Freitext …</option>`;
  if (sel) ober.value = sel;
  fillKatUnterDropdown(ober.value);
}

function fillKatUnterDropdown(oberId) {
  const unter = document.getElementById("f-kat-unter");
  if (!unter) return;
  const subs = katUnterRows(oberId);
  unter.innerHTML = subs.length ? `<option value="">– Unterkategorie –</option>` + subs.map((k) => `<option value="${k.id}">${esc(k.name)}</option>`).join("") : `<option value="">–</option>`;
  unter.disabled = subs.length === 0;
  syncKatId();
}

function syncKatId() {
  const ober = document.getElementById("f-kat-ober");
  const unter = document.getElementById("f-kat-unter");
  const idEl = document.getElementById("f-kategorie-id");
  const txtEl = document.getElementById("f-kategorie");
  const freeText = ober && ober.value === "__text__";
  if (txtEl) txtEl.style.display = freeText ? "" : "none";
  if (!ober || freeText) { if (idEl) idEl.value = ""; return; }
  const chosen = unter && unter.value ? unter.value : ober.value;
  if (idEl) idEl.value = chosen || "";
}

function setTxKategorie(textVal, uuidVal) {
  const ober = document.getElementById("f-kat-ober");
  const unter = document.getElementById("f-kat-unter");
  const idEl = document.getElementById("f-kategorie-id");
  const txtEl = document.getElementById("f-kategorie");
  if (idEl) idEl.value = uuidVal || "";
  if (!uuidVal) {
    // Fallback: freitext
    if (ober) ober.value = "__text__";
    fillKatUnterDropdown("__text__");
    if (txtEl) { txtEl.style.display = ""; txtEl.value = textVal; }
    return;
  }
  const row = katRows.find((k) => k.id === uuidVal);
  if (row && row.parent_id) {
    if (ober) ober.value = row.parent_id;
    fillKatUnterDropdown(row.parent_id);
    if (unter) unter.value = uuidVal;
  } else if (row) {
    if (ober) ober.value = uuidVal;
    fillKatUnterDropdown(uuidVal);
  }
  syncKatId();
}

function getTxKategorieText() {
  const idEl = document.getElementById("f-kategorie-id");
  if (idEl && idEl.value) {
    const row = katRows.find((k) => k.id === idEl.value);
    if (row) {
      const parent = row.parent_id ? katRows.find((k) => k.id === row.parent_id) : null;
      return parent ? parent.name + " / " + row.name : row.name;
    }
  }
  const txtEl = document.getElementById("f-kategorie");
  return txtEl ? (txtEl.value || null) : null;
}

// Live-Aktualisierung der Unter-Dropdown beim Ober-Wechsel
document.getElementById("f-kat-ober").addEventListener("change", (e) => {
  fillKatUnterDropdown(e.target.value); syncKatId();
});
document.getElementById("f-kat-unter").addEventListener("change", syncKatId);
document.getElementById("kat-manage-btn").addEventListener("click", openKatManager);

// Kategorien-Verwaltung: als Overlay-Modal
function openKatManager() {
  let modal = document.getElementById("kat-modal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "kat-modal";
    modal.style = "position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:999;display:flex;align-items:center;justify-content:center";
    modal.innerHTML = `<div style="background:var(--panel);border-radius:12px;padding:24px;width:480px;max-width:96vw;max-height:80vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,0.3)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h3 style="margin:0">Kategorien verwalten</h3>
        <button class="secondary" id="kat-modal-close">✕</button>
      </div>
      <div id="kat-list"></div>
      <hr style="margin:16px 0">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <select id="kat-new-parent" style="flex:1;min-width:120px"><option value="">Neue Oberkategorie</option></select>
        <input type="text" id="kat-new-name" placeholder="Name" style="flex:2;min-width:120px" />
        <select id="kat-new-typ"><option value="ausgabe">Ausgabe</option><option value="einnahme">Einnahme</option></select>
        <button id="kat-new-save">Anlegen</button>
      </div>
      <div id="kat-msg" style="margin-top:8px"></div>
    </div>`;
    document.body.appendChild(modal);
    document.getElementById("kat-modal-close").addEventListener("click", () => modal.remove());
    modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
    document.getElementById("kat-new-save").addEventListener("click", async () => {
      const name = document.getElementById("kat-new-name").value.trim();
      if (!name) return;
      const parent_id = document.getElementById("kat-new-parent").value || null;
      const typ = document.getElementById("kat-new-typ").value;
      const { error } = await sb.from("kategorien").insert([{ name, parent_id, typ }]);
      if (error) { document.getElementById("kat-msg").textContent = "Fehler: " + error.message; return; }
      document.getElementById("kat-new-name").value = "";
      await loadKategorien();
      renderKatModal();
    });
  }
  renderKatModal();
}
function renderKatModal() {
  const listEl = document.getElementById("kat-list"); if (!listEl) return;
  const parentSel = document.getElementById("kat-new-parent");
  if (parentSel) parentSel.innerHTML = `<option value="">Neue Oberkategorie</option>` + katOberRows().map((k) => `<option value="${k.id}">${esc(k.name)}</option>`).join("");
  const obers = katOberRows();
  if (obers.length === 0) { listEl.innerHTML = `<div class="empty">Noch keine Kategorien.</div>`; return; }
  listEl.innerHTML = obers.map((ob) => {
    const subs = katUnterRows(ob.id);
    const subHtml = subs.map((s) => `<div style="display:flex;align-items:center;gap:6px;padding:4px 0 4px 20px;border-bottom:1px solid var(--border)">
      <span style="flex:1;font-size:13px">↳ ${esc(s.name)}</span>
      <button class="danger" style="font-size:11px;padding:2px 8px" data-kat-del="${s.id}">✕</button></div>`).join("");
    return `<div style="border:1px solid var(--border);border-radius:8px;margin-bottom:8px;overflow:hidden">
      <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--panel2)">
        <b style="flex:1;font-size:13px">${esc(ob.name)}</b>
        <span style="font-size:11px;color:var(--muted)">${ob.typ}</span>
        <button class="danger" style="font-size:11px;padding:2px 8px" data-kat-del="${ob.id}">✕</button>
      </div>${subHtml}</div>`;
  }).join("");
  listEl.querySelectorAll("[data-kat-del]").forEach((btn) => btn.addEventListener("click", async (e) => {
    const id = e.target.getAttribute("data-kat-del");
    if (!confirm("Kategorie löschen?")) return;
    const { error } = await sb.from("kategorien").delete().eq("id", id);
    if (error) alert(error.message); else { await loadKategorien(); renderKatModal(); }
  }));
}

// ======================================================================
//  Vermögensgegenstände
// ======================================================================
let vgRows = [];
const VG_ART_LABEL = { gold: "Gold", edelmetall: "Edelmetall", fahrzeug: "Fahrzeug", kunst: "Kunst/Kunst", sammlung: "Sammlung", krypto: "Krypto", bargeld: "Bargeld", sonstige: "Sonstige" };

async function loadVG() {
  const { data } = await sb.from("vermoegensgegenstaende").select("*").order("bezeichnung");
  vgRows = data || [];
  renderVG();
}

function vgArtOpts(sel) {
  return Object.entries(VG_ART_LABEL).map(([v, l]) => `<option value="${v}"${sel === v ? " selected" : ""}>${l}</option>`).join("");
}

function vgCardHTML(d) {
  const sh = (Number(d.anteil_user) || 100) / 100;
  const wert = (Number(d.marktwert) || 0) * sh;
  const kauf = (Number(d.kaufpreis) || 0) * sh;
  const delta = d.marktwert != null && d.kaufpreis != null ? wert - kauf : null;
  const mengeStr = d.menge != null ? `${fmtNum(d.menge, 3)} ${d.einheit || ""}` : "";
  return `<div class="immo-card" data-vg-id="${d.id}">
    <div class="immo-head" data-vg-toggle>
      <div>
        <div class="immo-title">${esc(d.bezeichnung)}</div>
        <div class="immo-sub">${VG_ART_LABEL[d.art] || d.art}${mengeStr ? " · " + mengeStr : ""}${d.anteil_user != null && d.anteil_user !== 100 ? " · Anteil " + fmtNum(d.anteil_user) + " %" : ""}</div>
      </div>
      <div style="text-align:right">
        <div style="font-weight:700;font-size:17px">${d.marktwert != null ? euro(wert) : "–"}</div>
        ${delta != null ? `<div style="font-size:12px;color:${delta >= 0 ? "var(--pos)" : "var(--neg)"}">${delta >= 0 ? "+" : ""}${euro(delta)}</div>` : ""}
      </div>
    </div>
    <div class="immo-body hidden">
      <div class="row">
        <div><label>Bezeichnung</label><input type="text" data-f="bezeichnung" value="${esc(d.bezeichnung)}" /></div>
        <div><label>Art</label><select data-f="art">${vgArtOpts(d.art)}</select></div>
        <div><label>Menge</label><input type="text" inputmode="decimal" data-f="menge" value="${d.menge != null ? fmtNum(d.menge, 3) : ""}" /></div>
        <div><label>Einheit (g/oz/Stk …)</label><input type="text" data-f="einheit" value="${esc(d.einheit || "")}" /></div>
        <div><label>Kaufdatum</label><input type="date" data-f="kaufdatum" value="${d.kaufdatum || ""}" /></div>
        <div><label>Kaufpreis €</label><input type="text" inputmode="decimal" data-f="kaufpreis" value="${d.kaufpreis != null ? fmtNum(d.kaufpreis) : ""}" /></div>
        <div><label>Aktueller Marktwert €</label><input type="text" inputmode="decimal" data-f="marktwert" value="${d.marktwert != null ? fmtNum(d.marktwert) : ""}" /></div>
        <div><label>Dein Anteil (%)</label><input type="text" inputmode="decimal" data-f="anteil_user" value="${d.anteil_user != null ? fmtNum(d.anteil_user) : "100"}" /></div>
        <div><label>Bindung</label><select data-f="bindung"><option value="">Nicht zugeordnet</option><option value="kurzfristig"${d.bindung === "kurzfristig" ? " selected" : ""}>Kurzfristig</option><option value="mittelfristig"${d.bindung === "mittelfristig" ? " selected" : ""}>Mittelfristig</option><option value="langfristig"${d.bindung === "langfristig" ? " selected" : ""}>Langfristig</option></select></div>
        <div style="grid-column:1/-1"><label>Notiz</label><input type="text" data-f="notiz" value="${esc(d.notiz || "")}" /></div>
      </div>
      <div class="actions">
        <button class="danger" data-vg-del="${d.id}">Löschen</button>
        <button data-vg-save="${d.id}">Speichern</button>
      </div>
    </div>
  </div>`;
}

function renderVG() {
  const listEl = document.getElementById("vg-list"); if (!listEl) return;
  const emptyEl = document.getElementById("vg-empty");
  document.getElementById("vg-count").textContent = vgRows.length;
  if (vgRows.length === 0) { listEl.innerHTML = ""; if (emptyEl) emptyEl.classList.remove("hidden"); return; }
  if (emptyEl) emptyEl.classList.add("hidden");
  const sh = (d) => (Number(d.anteil_user) || 100) / 100;
  const totalWert = vgRows.reduce((s, d) => s + (Number(d.marktwert) || 0) * sh(d), 0);
  const totalKauf = vgRows.reduce((s, d) => s + (Number(d.kaufpreis) || 0) * sh(d), 0);
  setText("vg-sum-wert", euro(totalWert));
  setText("vg-sum-kaufpreis", euro(totalKauf));
  const zwEl = document.getElementById("vg-sum-zuwachs");
  if (zwEl) { const z = totalWert - totalKauf; zwEl.textContent = (z >= 0 ? "+" : "") + euro(z); zwEl.className = "v " + (z >= 0 ? "pos" : "neg"); }
  listEl.innerHTML = vgRows.map((d) => vgCardHTML(d)).join("");
}

document.getElementById("vg-list").addEventListener("click", async (e) => {
  if (e.target.closest("[data-vg-toggle]")) { e.target.closest(".immo-card").querySelector(".immo-body").classList.toggle("hidden"); return; }
  const saveBtn = e.target.closest("[data-vg-save]");
  if (saveBtn) {
    const card = saveBtn.closest(".immo-card");
    const g = (f) => card.querySelector(`[data-f="${f}"]`)?.value;
    const payload = { bezeichnung: g("bezeichnung"), art: g("art") || "sonstige", menge: numDE(g("menge")), einheit: g("einheit") || null, kaufdatum: g("kaufdatum") || null, kaufpreis: numDE(g("kaufpreis")), marktwert: numDE(g("marktwert")), anteil_user: numDE(g("anteil_user")) || 100, bindung: g("bindung") || null, notiz: g("notiz") || null };
    const { error } = await sb.from("vermoegensgegenstaende").update(payload).eq("id", saveBtn.getAttribute("data-vg-save"));
    if (error) alert("Fehler: " + error.message); else loadVG(); return;
  }
  const delBtn = e.target.closest("[data-vg-del]");
  if (delBtn) { if (!confirm("Vermögensgegenstand löschen?")) return; const { error } = await sb.from("vermoegensgegenstaende").delete().eq("id", delBtn.getAttribute("data-vg-del")); if (error) alert("Fehler: " + error.message); else loadVG(); }
});

document.getElementById("vg-add").addEventListener("click", async () => {
  const { error } = await sb.from("vermoegensgegenstaende").insert([{ bezeichnung: "Neues Objekt", art: "sonstige", anteil_user: 100 }]);
  if (error) alert("Fehler: " + error.message); else loadVG();
});

// ======================================================================
//  Einkommen
// ======================================================================
let ekRows = [];
const EK_ART_LABEL = { arbeit: "Angestellt (dipendente)", immobilie: "Mieteinnahme", beteiligung: "Beteiligung/Dividende", arbeitslosengeld: "Arbeitslosengeld (NASpI)", autonomo: "Selbständig (autonomo)", rente: "Rente/Pension", sonstige: "Sonstige" };
const EK_STEUERMODELL_LABEL = { irpef: "IRPEF", cedolare: "Cedolare Secca", kapitalertrag: "KESt 26 %", befreit: "Steuerfrei" };

async function loadEinkommen() {
  const { data } = await sb.from("einkommen").select("*").order("bezeichnung");
  ekRows = data || [];
  renderEinkommen();
}

// Geschätzte Jahressteuer je Einkommensquelle (grobe Schätzung ohne Gesamtberechnung)
function ekEstimatedTax(d, bruttoJahr) {
  if (d.steuerstatus === "netto" || d.steuerstatus === "steuerfrei") return 0;
  if (d.steuersatz) return bruttoJahr * d.steuersatz / 100;
  if (d.steuermodell === "kapitalertrag") return bruttoJahr * 26 / 100;
  if (d.steuermodell === "cedolare") return bruttoJahr * 21 / 100;
  // IRPEF: grobe Schätzung mit Grenzsteuersatz
  const gs = Number((steuerSettings || {}).grenzsteuersatz) || 33;
  return bruttoJahr * gs / 100;
}

// Jahresbrutto je Quelle aus verknüpften Transaktionen der letzten 12 Monate
function ekBruttoAusTransaktionen(ekId) {
  const now = new Date(), cutoff = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  return allRows.filter((r) => r.einkommen_id === ekId && !r.umbuchung && r.buchungsdatum >= cutoff.toISOString().slice(0, 10))
    .reduce((s, r) => s + (Number(r.haben) || 0), 0);
}

function ekCardHTML(d) {
  const bruttoJahr = ekBruttoAusTransaktionen(d.id);
  const steuer = ekEstimatedTax(d, bruttoJahr);
  const netto = bruttoJahr - steuer;
  return `<div class="immo-card" data-ek-id="${d.id}">
    <div class="immo-head" data-ek-toggle>
      <div>
        <div class="immo-title">${esc(d.bezeichnung)}</div>
        <div class="immo-sub">${EK_ART_LABEL[d.art] || d.art}${d.steuermodell ? " · " + (EK_STEUERMODELL_LABEL[d.steuermodell] || d.steuermodell) : ""}</div>
      </div>
      <div style="text-align:right">
        <div style="font-weight:700;font-size:16px">${euro(bruttoJahr)} <span style="font-weight:400;font-size:12px;color:var(--muted)">/ Jahr</span></div>
        <div style="font-size:12px;color:var(--neg)">~Steuer: ${euro(steuer)}</div>
      </div>
    </div>
    <div class="immo-body hidden">
      <div class="row">
        <div><label>Bezeichnung</label><input type="text" data-f="bezeichnung" value="${esc(d.bezeichnung)}" /></div>
        <div><label>Art</label><select data-f="art">${Object.entries(EK_ART_LABEL).map(([v, l]) => `<option value="${v}"${d.art === v ? " selected" : ""}>${l}</option>`).join("")}</select></div>
        <div><label>Steuerstatus (Standard)</label><select data-f="steuerstatus"><option value="brutto"${d.steuerstatus === "brutto" ? " selected" : ""}>Brutto</option><option value="netto"${d.steuerstatus === "netto" ? " selected" : ""}>Netto</option><option value="vorsteuer"${d.steuerstatus === "vorsteuer" ? " selected" : ""}>Vorsteuer</option><option value="steuerfrei"${d.steuerstatus === "steuerfrei" ? " selected" : ""}>Steuerfrei</option></select></div>
        <div><label>Steuermodell</label><select data-f="steuermodell"><option value="">–</option>${Object.entries(EK_STEUERMODELL_LABEL).map(([v, l]) => `<option value="${v}"${d.steuermodell === v ? " selected" : ""}>${l}</option>`).join("")}</select></div>
        <div><label>Pauschalsatz % (opt.)</label><input type="text" inputmode="decimal" data-f="steuersatz" value="${d.steuersatz != null ? fmtNum(d.steuersatz) : ""}" /></div>
        <div style="grid-column:1/-1"><label>Notiz</label><input type="text" data-f="notiz" value="${esc(d.notiz || "")}" /></div>
      </div>
      <div style="font-size:12px;color:var(--muted);padding:6px 0">Jahresbrutto (letzte 12 Monate, verknüpfte Transaktionen): ${euro(bruttoJahr)}<br>Netto geschätzt: ${euro(netto)}</div>
      <div class="actions">
        <button class="danger" data-ek-del="${d.id}">Löschen</button>
        <button data-ek-save="${d.id}">Speichern</button>
      </div>
    </div>
  </div>`;
}

function renderEinkommen() {
  const listEl = document.getElementById("ek-list"); if (!listEl) return;
  const emptyEl = document.getElementById("ek-empty");
  document.getElementById("ek-count").textContent = ekRows.length;
  if (ekRows.length === 0) { listEl.innerHTML = ""; if (emptyEl) emptyEl.classList.remove("hidden"); return; }
  if (emptyEl) emptyEl.classList.add("hidden");
  let bruttoGes = 0, steuerGes = 0;
  ekRows.forEach((d) => { const b = ekBruttoAusTransaktionen(d.id); bruttoGes += b; steuerGes += ekEstimatedTax(d, b); });
  setText("ek-sum-brutto", euro(bruttoGes));
  setText("ek-sum-netto", euro(bruttoGes - steuerGes));
  setText("ek-sum-steuer", euro(steuerGes));
  listEl.innerHTML = ekRows.map((d) => ekCardHTML(d)).join("");
}

document.getElementById("ek-list").addEventListener("click", async (e) => {
  if (e.target.closest("[data-ek-toggle]")) { e.target.closest(".immo-card").querySelector(".immo-body").classList.toggle("hidden"); return; }
  const saveBtn = e.target.closest("[data-ek-save]");
  if (saveBtn) {
    const card = saveBtn.closest(".immo-card");
    const g = (f) => card.querySelector(`[data-f="${f}"]`)?.value;
    const payload = { bezeichnung: g("bezeichnung"), art: g("art"), steuerstatus: g("steuerstatus") || "brutto", steuermodell: g("steuermodell") || null, steuersatz: numDE(g("steuersatz")), notiz: g("notiz") || null };
    const { error } = await sb.from("einkommen").update(payload).eq("id", saveBtn.getAttribute("data-ek-save"));
    if (error) alert("Fehler: " + error.message); else loadEinkommen(); return;
  }
  const delBtn = e.target.closest("[data-ek-del]");
  if (delBtn) { if (!confirm("Einkommensquelle löschen?")) return; const { error } = await sb.from("einkommen").delete().eq("id", delBtn.getAttribute("data-ek-del")); if (error) alert("Fehler: " + error.message); else loadEinkommen(); }
});

document.getElementById("ek-add").addEventListener("click", async () => {
  const { error } = await sb.from("einkommen").insert([{ bezeichnung: "Neue Einkommensquelle", art: "arbeit", steuerstatus: "netto" }]);
  if (error) alert("Fehler: " + error.message); else loadEinkommen();
});

// ======================================================================
//  Budgets
// ======================================================================
let budgetRows = [];

async function loadBudgets() {
  const { data } = await sb.from("budgets").select("*").order("betrag", { ascending: false });
  budgetRows = data || [];
  renderBudgets();
}

// Ist-Ausgaben je Kategorie-ID im gewählten Monat (YYYY-MM)
function budIstByKategorie(monat) {
  const [y, m] = monat.split("-").map(Number);
  const from = `${String(y).padStart(4,"0")}-${String(m).padStart(2,"0")}-01`;
  const toDate = new Date(y, m, 0); // letzter Tag des Monats
  const to = toDate.toISOString().slice(0, 10);
  const map = {};
  allRows.filter((r) => !r.umbuchung && r.buchungsdatum >= from && r.buchungsdatum <= to && r.soll && r.soll < 0)
    .forEach((r) => {
      if (!r.kategorie_id) return;
      const sh = userShare(r.bank || "");
      map[r.kategorie_id] = (map[r.kategorie_id] || 0) + Math.abs(Number(r.soll)) * sh;
    });
  return map;
}

function renderBudgets() {
  const listEl = document.getElementById("bud-list"); if (!listEl) return;
  const emptyEl = document.getElementById("bud-empty");
  const monatEl = document.getElementById("bud-monat");
  const now = new Date();
  const defaultMonat = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  if (monatEl && !monatEl.value) monatEl.value = defaultMonat;
  const monat = monatEl ? monatEl.value || defaultMonat : defaultMonat;

  if (budgetRows.length === 0) { listEl.innerHTML = ""; if (emptyEl) emptyEl.classList.remove("hidden"); return; }
  if (emptyEl) emptyEl.classList.add("hidden");

  const istMap = budIstByKategorie(monat);
  const monthBudgets = budgetRows.filter((b) => b.zeitraum === "monat");
  const yearBudgets = budgetRows.filter((b) => b.zeitraum === "jahr");

  let totalBudget = 0, totalIst = 0, overCount = 0;
  const budgetHtml = (buds) => buds.map((b) => {
    const kat = katRows.find((k) => k.id === b.kategorie_id);
    const katName = kat ? kat.name : (b.kategorie_id ? "?" : "Ohne Kategorie");
    const parentKat = kat && kat.parent_id ? katRows.find((k) => k.id === kat.parent_id) : null;
    const displayName = parentKat ? `${parentKat.name} / ${kat.name}` : katName;

    // Ist: Ausgaben dieser Kategorie + aller Unterkategorien
    const idsToCheck = kat ? [kat.id, ...katRows.filter((k) => k.parent_id === kat.id).map((k) => k.id)] : [b.kategorie_id];
    const ist = idsToCheck.reduce((s, id) => s + (istMap[id] || 0), 0);
    const budget = b.zeitraum === "jahr" ? b.betrag / 12 : b.betrag; // Jahresbudget auf Monat herunterrechnen
    const pct = budget > 0 ? Math.min(100, (ist / budget) * 100) : 0;
    const over = ist > budget;
    if (b.zeitraum === "monat") { totalBudget += budget; totalIst += ist; }
    if (over) overCount++;
    return `<div style="border:1px solid var(--border);border-radius:8px;padding:12px 16px;margin-bottom:8px;background:var(--panel)">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
        <div style="flex:1">
          <div style="font-weight:600;font-size:14px">${esc(displayName)}</div>
          <div style="font-size:11px;color:var(--muted)">${b.zeitraum === "jahr" ? "Jahresbudget" : "Monatsbudget"}</div>
        </div>
        <div style="text-align:right;white-space:nowrap">
          <span class="${over ? "neg" : "pos"}" style="font-weight:700">${euro(ist)}</span>
          <span style="color:var(--muted);font-size:12px"> / ${euro(budget)}</span>
        </div>
        <button class="danger" style="font-size:11px;padding:3px 8px" data-bud-del="${b.id}">✕</button>
      </div>
      <div style="background:var(--panel2);border-radius:4px;height:8px;overflow:hidden">
        <div style="width:${pct}%;height:8px;background:${over ? "var(--neg)" : "var(--accent)"};border-radius:4px;transition:width .3s"></div>
      </div>
      ${over ? `<div style="font-size:11px;color:var(--neg);margin-top:4px">Überschreitung: ${euro(ist - budget)}</div>` : `<div style="font-size:11px;color:var(--muted);margin-top:4px">Noch verfügbar: ${euro(budget - ist)}</div>`}
    </div>`;
  }).join("");

  setText("bud-sum-budget", euro(totalBudget));
  setText("bud-sum-ist", euro(totalIst));
  const restEl = document.getElementById("bud-sum-rest");
  if (restEl) { restEl.textContent = euro(Math.max(0, totalBudget - totalIst)); restEl.className = "v " + (totalIst > totalBudget ? "neg" : "pos"); }
  setText("bud-count-over", String(overCount));

  listEl.innerHTML = (monthBudgets.length ? `<h4 style="margin:0 0 8px;font-size:13px;color:var(--muted)">Monatsbudgets</h4>` + budgetHtml(monthBudgets) : "") +
    (yearBudgets.length ? `<h4 style="margin:12px 0 8px;font-size:13px;color:var(--muted)">Jahresbudgets (anteilig pro Monat)</h4>` + budgetHtml(yearBudgets) : "");
}

document.getElementById("bud-list").addEventListener("click", async (e) => {
  const delBtn = e.target.closest("[data-bud-del]");
  if (delBtn) { if (!confirm("Budget löschen?")) return; const { error } = await sb.from("budgets").delete().eq("id", delBtn.getAttribute("data-bud-del")); if (error) alert("Fehler: " + error.message); else loadBudgets(); }
});

document.getElementById("bud-monat").addEventListener("change", () => renderBudgets());

document.getElementById("bud-kat-manage").addEventListener("click", openKatManager);

document.getElementById("bud-add").addEventListener("click", () => {
  const obers = katOberRows();
  if (obers.length === 0) { openKatManager(); return; }
  const modal = document.createElement("div");
  modal.style = "position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:999;display:flex;align-items:center;justify-content:center";
  modal.innerHTML = `<div style="background:var(--panel);border-radius:12px;padding:24px;width:420px;max-width:96vw;box-shadow:0 8px 40px rgba(0,0,0,0.3)">
    <h3 style="margin:0 0 16px">Neues Budget</h3>
    <div class="row" style="margin-bottom:12px">
      <div style="grid-column:1/-1"><label>Kategorie</label>
        <select id="bud-new-kat" style="width:100%"><option value="">– wählen –</option>
          ${katRows.map((k) => { const parent = k.parent_id ? katRows.find((p) => p.id === k.parent_id) : null; const name = parent ? `${parent.name} / ${k.name}` : k.name; return `<option value="${k.id}">${esc(name)}</option>`; }).join("")}
        </select>
      </div>
      <div><label>Betrag €</label><input type="text" inputmode="decimal" id="bud-new-betrag" placeholder="500,00" /></div>
      <div><label>Zeitraum</label><select id="bud-new-zeitraum"><option value="monat">Monat</option><option value="jahr">Jahr</option></select></div>
    </div>
    <div id="bud-new-hint" style="font-size:12px;color:var(--muted);margin-bottom:12px"></div>
    <div style="display:flex;gap:8px">
      <button id="bud-new-save">Speichern</button>
      <button class="secondary" id="bud-new-cancel">Abbrechen</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  // Tipp: Durchschnitt der letzten 6 Monate vorschlagen
  document.getElementById("bud-new-kat").addEventListener("change", (e) => {
    const id = e.target.value; if (!id) return;
    const monatEl = document.getElementById("bud-monat");
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString().slice(0, 10);
    const idsToCheck = [id, ...katRows.filter((k) => k.parent_id === id).map((k) => k.id)];
    const sumIst = allRows.filter((r) => !r.umbuchung && r.soll < 0 && r.buchungsdatum >= from && idsToCheck.includes(r.kategorie_id))
      .reduce((s, r) => s + Math.abs(Number(r.soll)) * userShare(r.bank || ""), 0);
    const avg = sumIst / 6;
    const hint = document.getElementById("bud-new-hint");
    if (hint) hint.textContent = avg > 0 ? `Ø der letzten 6 Monate: ${euro(avg)} → als Vorschlag für Monatsbudget` : "Noch keine Ausgaben in dieser Kategorie erfasst.";
    const betragEl = document.getElementById("bud-new-betrag");
    if (avg > 0 && betragEl && !betragEl.value) betragEl.value = fmtNum(avg);
  });
  document.getElementById("bud-new-cancel").addEventListener("click", () => modal.remove());
  document.getElementById("bud-new-save").addEventListener("click", async () => {
    const kat_id = document.getElementById("bud-new-kat").value;
    const betrag = numDE(document.getElementById("bud-new-betrag").value);
    const zeitraum = document.getElementById("bud-new-zeitraum").value;
    if (!kat_id || !betrag) { alert("Bitte Kategorie und Betrag angeben."); return; }
    const { error } = await sb.from("budgets").insert([{ kategorie_id: kat_id, betrag, zeitraum }]);
    if (error) alert("Fehler: " + error.message); else { modal.remove(); loadBudgets(); }
  });
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
});

let versRows = [];
let versStand = [];

// Prämie normiert auf Jahr
function versPraemieJahr(d) {
  const p = Number(d.praemie) || 0;
  switch (d.zahlweise) {
    case "monatlich":        return p * 12;
    case "vierteljaehrlich": return p * 4;
    case "einmalig":         return p;
    default:                 return p; // jaehrlich
  }
}
// Letzter Stand aus versStand, Fallback auf rueckkaufswert
function versCurrentWert(versId) {
  const snaps = versStand.filter((s) => s.vers_id === versId);
  if (snaps.length === 0) return Number(versRows.find((v) => v.id === versId)?.rueckkaufswert) || 0;
  snaps.sort((a, b) => (a.datum > b.datum ? 1 : a.datum < b.datum ? -1 : 0));
  return Number(snaps[snaps.length - 1].wert) || 0;
}
function versHistory(versId) {
  return versStand.filter((s) => s.vers_id === versId).slice().sort((a, b) => (a.datum < b.datum ? -1 : 1));
}
// Ablauf-Ampel: gibt { color, label } zurück
function versAmpel(ablauf) {
  if (!ablauf) return { color: "var(--green)", label: "unbefristet" };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const exp = new Date(ablauf + "T00:00:00");
  const days = Math.round((exp - today) / 86400000);
  if (days < 0)  return { color: "var(--red)",     label: "abgelaufen" };
  if (days <= 60) return { color: "var(--warning)", label: days + " Tage" };
  return { color: "var(--green)", label: exp.toLocaleDateString("de-DE") };
}
// Detrazione 19% auf absetzbare Prämien (Topf-gedeckelt)
function versDetrazione() {
  const sum = (cats) => versRows.filter((d) => d.absetzbar && cats.includes(d.kategorie)).reduce((s, d) => s + versPraemieJahr(d), 0);
  const topf530   = Math.min(sum(["leben_kapital", "risikoleben", "bu_unfall"]), 530);
  const topfLtc   = Math.min(sum(["ltc"]), 1291.14);
  const gebaeude  = sum(["gebaeude"]);  // 19% ohne Deckel
  return (topf530 + topfLtc + gebaeude) * 0.19;
}
// Auto-Topf-Vorschlag je Kategorie
const VERS_TOPF_LABEL = {
  leben_kapital: "530 € (Leben/Unfall)", risikoleben: "530 € (Leben/Unfall)",
  bu_unfall: "530 € (Leben/Unfall)", ltc: "1.291,14 € (LTC)",
  gebaeude: "Unbegrenzt (Calamità)", kranken: "Nicht absetzbar",
  kfz: "Nicht absetzbar", hausrat_haftpflicht: "Nicht absetzbar", sonstiges: "–",
};

function pensCurrentWert(pensionId) {
  const snaps = pensStand.filter((s) => s.pension_id === pensionId);
  if (snaps.length === 0) return 0;
  snaps.sort((a, b) => (a.datum > b.datum ? 1 : a.datum < b.datum ? -1 : 0));
  return Number(snaps[snaps.length - 1].wert) || 0;
}
function pensHistory(pensionId) {
  return pensStand.filter((s) => s.pension_id === pensionId).slice().sort((a, b) => (a.datum < b.datum ? -1 : 1));
}

function pensKPIs(d, currentWert) {
  const n = (v) => Number(v) || 0;
  const jahr = new Date().getFullYear();
  const rentenjahr = n(d.rentenjahr);
  const nJahre = Math.max(0, rentenjahr - jahr);
  const beitragM = n(d.eigenbeitrag) + n(d.agbeitrag);
  const rJahr = n(d.rendite) / 100;
  const rMonat = Math.pow(1 + rJahr, 1 / 12) - 1;
  const monate = nJahre * 12;
  const wert = n(currentWert);
  let prognose;
  if (rentenjahr > 0 && rentenjahr <= jahr) prognose = wert;
  else {
    const grow = wert * Math.pow(1 + rJahr, nJahre);
    const contrib = Math.abs(rMonat) < 1e-9 ? beitragM * monate : beitragM * ((Math.pow(1 + rMonat, monate) - 1) / rMonat);
    prognose = grow + contrib;
  }
  const absetzbar = d.absetzbar ? Math.min(beitragM * 12, STEUER_MAX_PENSION) : null;
  return { nJahre, beitragM, prognose, absetzbar, vergangenheit: rentenjahr > 0 && rentenjahr <= jahr, rentenjahr };
}

async function loadPens() {
  const [pf, ps] = await Promise.all([
    sb.from("pensionsfonds").select("*").order("created_at", { ascending: true }),
    sb.from("pension_stand").select("*").order("datum", { ascending: true }),
  ]);
  if (pf.error) { console.error(pf.error); return; }
  pensRows = pf.data || [];
  pensStand = ps.error ? [] : (ps.data || []);
  renderPens();
  renderDashboard();
}

function pensFieldsHTML(d) {
  const v = (f) => fmtNum(d[f]);
  const ft = d.fondstyp || "FPA";
  const opt = (val, lab) => `<option value="${val}" ${ft === val ? "selected" : ""}>${lab}</option>`;
  return `
    <div class="immo-section">
      <h4>Stammdaten</h4>
      <div class="immo-grid">
        <div><label>Fondsname</label><input type="text" data-f="name" value="${esc(d.name || "")}" /></div>
        <div><label>Fondstyp</label><select data-f="fondstyp">${opt("FPA", "FPA – Fondo Pensione Aperto")}${opt("FPN", "FPN – Fondo Pensione Negoziale")}${opt("PIP", "PIP – Piano Individuale")}${opt("TFR", "TFR-Zuweisung")}${opt("Sonstiges", "Sonstiges")}</select></div>
        <div><label>Geplantes Rentenjahr</label><input type="text" inputmode="numeric" data-f="rentenjahr" value="${d.rentenjahr || ""}" /><div style="font-size:12px;color:var(--muted);margin-top:4px" data-k="jahre">–</div></div>
        <div><label>Bindung</label><select data-f="bindung">${bindOptions(d.bindung)}</select></div>
      </div>
    </div>
    <div class="immo-section">
      <h4>Beiträge &amp; Rendite</h4>
      <div class="immo-grid">
        <div><label>Eigenbeitrag/Monat (€)</label><input type="text" inputmode="decimal" data-f="eigenbeitrag" value="${v("eigenbeitrag")}" /></div>
        <div><label>Arbeitgeberbeitrag/Mon. (€)</label><input type="text" inputmode="decimal" data-f="agbeitrag" value="${v("agbeitrag")}" /></div>
        <div><label>Erwartete Rendite p.a. (%)</label><input type="text" inputmode="decimal" data-f="rendite" value="${v("rendite")}" /></div>
        <div><label>Steuerlich absetzbar</label><select data-f="absetzbar"><option value="ja" ${d.absetzbar !== false ? "selected" : ""}>Ja (max. 5.164 €/Jahr)</option><option value="nein" ${d.absetzbar === false ? "selected" : ""}>Nein</option></select></div>
      </div>
    </div>
    <div class="immo-section">
      <h4>Wertentwicklung</h4>
      <div style="font-size:13px;color:var(--muted);margin-bottom:10px">Aktueller Wert (letzter Stand): <b data-k="curwert" style="color:var(--text)">–</b></div>
      <div class="toolbar" style="margin-bottom:10px">
        <input type="date" data-pens-stand-datum style="max-width:170px" />
        <input type="text" inputmode="decimal" data-pens-stand-wert placeholder="Wert (€)" style="max-width:160px" />
        <button class="secondary" data-pens-stand-add>Stand erfassen</button>
      </div>
      <div data-pens-chart class="chart-wrap"></div>
      <div style="overflow-x:auto;margin-top:10px">
        <table>
          <thead><tr><th>Datum</th><th style="text-align:right">Wert</th><th></th></tr></thead>
          <tbody data-pens-stand-body></tbody>
        </table>
      </div>
    </div>
    <div class="immo-section">
      <h4>Prognose</h4>
      <div class="kpi-grid">
        <div class="kpibox"><div class="kpi-k" data-k="prog-label">Prognosewert</div><div class="kpi-v" data-k="prognose">–</div></div>
        <div class="kpibox"><div class="kpi-k">Gesamt-Beitrag/Monat</div><div class="kpi-v" data-k="beitrag">–</div></div>
        <div class="kpibox"><div class="kpi-k">Absetzbarer Betrag/Jahr</div><div class="kpi-v" data-k="absetzbar">–</div></div>
      </div>
      <div data-k="warn" style="color:var(--warning);font-size:13px;margin-top:8px"></div>
    </div>
    <div class="immo-actions">
      <button data-pens-save>Speichern</button>
      <span data-pens-msg style="font-size:13px"></span>
    </div>`;
}

function pensCardHTML(d) {
  const cur = pensCurrentWert(d.id);
  const k = pensKPIs(d, cur);
  return `<div class="immo-card collapsed" data-id="${d.id}">
    <div class="immo-head" data-pens-toggle>
      <span class="chev">▾</span>
      <div class="titlewrap">
        <div class="immo-title">${esc(d.name || "Neuer Pensionsfonds")}</div>
        <div class="immo-sub">${esc(d.fondstyp || "FPA")} | Aktuell: ${euro(cur)} | Prognose ${d.rentenjahr || "–"}: ${euro(k.prognose)}</div>
      </div>
      <button class="iconbtn" data-pens-del title="Löschen"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
    </div>
    <div class="immo-body">${pensFieldsHTML(d)}</div>
  </div>`;
}

function readPensCard(card) {
  const g = (f) => { const el = card.querySelector(`[data-f="${f}"]`); return el ? el.value : ""; };
  return {
    id: card.getAttribute("data-id") || null,
    name: g("name") || null,
    fondstyp: g("fondstyp") || "FPA",
    rentenjahr: g("rentenjahr") ? (parseInt(String(g("rentenjahr")).replace(/\D/g, "")) || null) : null,
    eigenbeitrag: numDE(g("eigenbeitrag")), agbeitrag: numDE(g("agbeitrag")),
    rendite: numDE(g("rendite")), absetzbar: g("absetzbar") !== "nein",
    bindung: g("bindung") || null,
  };
}

function recomputePensCard(card) {
  const d = readPensCard(card);
  const cur = pensCurrentWert(d.id);
  const k = pensKPIs(d, cur);
  const set = (key, val) => { const el = card.querySelector(`[data-k="${key}"]`); if (el) el.textContent = val; };
  set("jahre", k.vergangenheit ? "Rentenjahr liegt in der Vergangenheit" : (d.rentenjahr ? k.nJahre + " Jahre bis Rente" : ""));
  set("prog-label", "Prognosewert" + (d.rentenjahr ? " " + d.rentenjahr : ""));
  set("prognose", euro(k.prognose));
  set("beitrag", euro(k.beitragM));
  set("absetzbar", k.absetzbar == null ? "–" : euro(k.absetzbar));
  set("warn", k.vergangenheit ? "Hinweis: Rentenjahr liegt in der Vergangenheit – Prognose = aktueller Wert." : "");
  set("curwert", euro(cur));
  // Wert-Historie
  const hist = pensHistory(d.id);
  const body = card.querySelector("[data-pens-stand-body]");
  if (body) body.innerHTML = [...hist].reverse().map((s) => `<tr><td>${s.datum ? new Date(s.datum).toLocaleDateString("de-DE") : ""}</td><td class="num">${euro(Number(s.wert) || 0)}</td><td class="num"><button class="danger" data-pens-stand-del="${s.id}">Löschen</button></td></tr>`).join("") || `<tr><td colspan="3" class="empty">Noch keine Stände erfasst.</td></tr>`;
  const chartEl = card.querySelector("[data-pens-chart]");
  if (chartEl) drawAreaChart(chartEl, hist.map((s) => ({ m: String(s.datum).slice(0, 7), v: Number(s.wert) || 0 })));
  const sub = card.querySelector(".immo-sub");
  if (sub) sub.textContent = `${d.fondstyp || "FPA"} | Aktuell: ${euro(cur)} | Prognose ${d.rentenjahr || "–"}: ${euro(k.prognose)}`;
  const title = card.querySelector(".immo-title");
  if (title) title.textContent = d.name || "Neuer Pensionsfonds";
}

function renderPensSummary() {
  let wert = 0, beitrag = 0, absetz = 0;
  pensRows.forEach((d) => { const cur = pensCurrentWert(d.id); const k = pensKPIs(d, cur); wert += cur; beitrag += k.beitragM; absetz += (k.absetzbar || 0); });
  document.getElementById("pens-sum-wert").textContent = euro(wert);
  document.getElementById("pens-sum-beitrag").textContent = euro(beitrag);
  document.getElementById("pens-sum-absetz").textContent = euro(absetz);
}

function renderPens() {
  const list = document.getElementById("pens-list");
  if (!list) return;
  list.innerHTML = pensRows.map(pensCardHTML).join("");
  document.getElementById("pens-empty").classList.toggle("hidden", pensRows.length > 0);
  list.querySelectorAll(".immo-card").forEach((card) => recomputePensCard(card));
  const iso = isoDate(new Date());
  list.querySelectorAll("[data-pens-stand-datum]").forEach((el) => { el.value = iso; });
  renderPensSummary();
}

const pensListEl = document.getElementById("pens-list");
pensListEl.addEventListener("input", (e) => { const c = e.target.closest(".immo-card"); if (c) { recomputePensCard(c); renderPensSummary(); } });
pensListEl.addEventListener("change", (e) => { const c = e.target.closest(".immo-card"); if (c) { recomputePensCard(c); renderPensSummary(); } });
pensListEl.addEventListener("click", async (e) => {
  const card = e.target.closest(".immo-card"); if (!card) return;
  if (e.target.closest("[data-pens-del]")) {
    e.stopPropagation();
    if (!confirm("Diesen Pensionsfonds wirklich löschen?")) return;
    const { error } = await sb.from("pensionsfonds").delete().eq("id", card.getAttribute("data-id"));
    if (error) alert("Fehler: " + error.message); else loadPens();
    return;
  }
  if (e.target.closest("[data-pens-stand-add]")) {
    const datum = card.querySelector("[data-pens-stand-datum]").value;
    const wert = numDE(card.querySelector("[data-pens-stand-wert]").value);
    if (!datum || wert == null) { alert("Bitte Datum und Wert eingeben."); return; }
    const { error } = await sb.from("pension_stand").insert([{ pension_id: card.getAttribute("data-id"), datum, wert }]);
    if (error) { alert("Fehler: " + error.message); return; }
    loadPens();
    return;
  }
  const standDel = e.target.closest("[data-pens-stand-del]");
  if (standDel) {
    const { error } = await sb.from("pension_stand").delete().eq("id", standDel.getAttribute("data-pens-stand-del"));
    if (error) alert("Fehler: " + error.message); else loadPens();
    return;
  }
  const pensSaveBtn = e.target.closest("[data-pens-save]");
  if (pensSaveBtn) {
    pensSaveBtn.disabled = true;
    const d = readPensCard(card); const id = d.id; delete d.id;
    const msg = card.querySelector("[data-pens-msg]");
    let error;
    if (id) ({ error } = await sb.from("pensionsfonds").update(d).eq("id", id));
    else ({ error } = await sb.from("pensionsfonds").insert([d]));
    pensSaveBtn.disabled = false;
    if (error) { msg.textContent = "Fehler: " + error.message; msg.style.color = "var(--red)"; return; }
    msg.textContent = "Gespeichert."; msg.style.color = "var(--green)";
    loadPens();
    return;
  }
  if (e.target.closest("[data-pens-toggle]")) card.classList.toggle("collapsed");
});
document.getElementById("pens-add").addEventListener("click", async () => {
  const { error } = await sb.from("pensionsfonds").insert([{ name: "Neuer Pensionsfonds", fondstyp: "FPA", absetzbar: true, rentenjahr: new Date().getFullYear() + 25 }]);
  if (error) { alert("Fehler beim Anlegen: " + error.message); return; }
  loadPens();
});

// ======================================================================
//  Versicherungen
// ======================================================================
async function loadVers() {
  const [vr, vs] = await Promise.all([
    sb.from("versicherungen").select("*").order("created_at", { ascending: true }),
    sb.from("versicherung_stand").select("*").order("datum", { ascending: true }),
  ]);
  if (vr.error) { console.error(vr.error); return; }
  versRows = vr.data || [];
  versStand = vs.error ? [] : (vs.data || []);
  renderVers();
  renderDashboard();
}

function versKatOpts(cur) {
  const opts = [
    ["leben_kapital",      "Lebensvers. kapitalbildend (Ramo I/III)"],
    ["risikoleben",        "Risikoleben (temporanea caso morte)"],
    ["bu_unfall",          "Berufsunfähigkeit / Unfall"],
    ["ltc",                "Pflege / Non autosufficienza (LTC)"],
    ["kranken",            "Krankenversicherung"],
    ["kfz",                "KFZ / RC Auto"],
    ["hausrat_haftpflicht","Hausrat / Haftpflicht"],
    ["gebaeude",           "Gebäude / Calamità naturali"],
    ["sonstiges",          "Sonstiges"],
  ];
  return opts.map(([v, l]) => `<option value="${v}" ${cur === v ? "selected" : ""}>${l}</option>`).join("");
}

function versFieldsHTML(d) {
  const v = (f) => fmtNum(d[f]);
  const isKapital = d.art === "kapital";
  return `
    <div class="immo-section">
      <h4>Stammdaten</h4>
      <div class="immo-grid">
        <div><label>Bezeichnung</label><input type="text" data-f="bezeichnung" value="${esc(d.bezeichnung || "")}" /></div>
        <div><label>Gesellschaft</label><input type="text" data-f="gesellschaft" value="${esc(d.gesellschaft || "")}" /></div>
        <div><label>Art</label><select data-f="art">
          <option value="risiko"  ${d.art !== "kapital" ? "selected" : ""}>Risiko / Schutz (kein Vermögen)</option>
          <option value="kapital" ${d.art === "kapital"  ? "selected" : ""}>Kapitalbildend (Rückkaufswert)</option>
        </select></div>
        <div><label>Kategorie</label><select data-f="kategorie">${versKatOpts(d.kategorie)}</select></div>
        <div><label>Bindung</label><select data-f="bindung">${bindOptions(d.bindung)}</select></div>
        <div><label>Absetzbar (Detrazione)</label><select data-f="absetzbar">
          <option value="ja" ${d.absetzbar !== false ? "selected" : ""}>Ja – 19 % absetzbar</option>
          <option value="nein" ${d.absetzbar === false ? "selected" : ""}>Nein</option>
        </select></div>
      </div>
    </div>
    <div class="immo-section">
      <h4>Prämie &amp; Laufzeit</h4>
      <div class="immo-grid">
        <div><label>Prämie (€)</label><input type="text" inputmode="decimal" data-f="praemie" value="${v("praemie")}" /></div>
        <div><label>Zahlweise</label><select data-f="zahlweise">
          <option value="monatlich" ${d.zahlweise === "monatlich" ? "selected" : ""}>Monatlich</option>
          <option value="vierteljaehrlich" ${d.zahlweise === "vierteljaehrlich" ? "selected" : ""}>Vierteljährlich</option>
          <option value="jaehrlich" ${!d.zahlweise || d.zahlweise === "jaehrlich" ? "selected" : ""}>Jährlich</option>
          <option value="einmalig" ${d.zahlweise === "einmalig" ? "selected" : ""}>Einmalig</option>
        </select></div>
        <div><label>Vertragsstart</label><input type="date" data-f="vertragsstart" value="${d.vertragsstart || ""}" /></div>
        <div><label>Ablauf (leer = unbefristet)</label><input type="date" data-f="ablauf" value="${d.ablauf || ""}" /></div>
        <div><label>Versicherungssumme / Deckung (€)</label><input type="text" inputmode="decimal" data-f="versicherungssumme" value="${v("versicherungssumme")}" /></div>
        <div><label>Begünstigter</label><input type="text" data-f="beguenstigter" value="${esc(d.beguenstigter || "")}" /></div>
      </div>
    </div>
    <div class="immo-section" data-vers-kapital style="${isKapital ? "" : "display:none"}">
      <h4>Wertentwicklung (Rückkaufswert)</h4>
      <div style="font-size:13px;color:var(--muted);margin-bottom:10px">Aktueller Wert (letzter Stand): <b data-k="curwert" style="color:var(--text)">–</b></div>
      <div class="toolbar" style="margin-bottom:10px">
        <input type="date" data-vers-stand-datum style="max-width:170px" />
        <input type="text" inputmode="decimal" data-vers-stand-wert placeholder="Wert (€)" style="max-width:160px" />
        <button class="secondary" data-vers-stand-add>Stand erfassen</button>
      </div>
      <div data-vers-chart class="chart-wrap"></div>
      <div style="overflow-x:auto;margin-top:10px">
        <table><thead><tr><th>Datum</th><th style="text-align:right">Wert</th><th></th></tr></thead>
        <tbody data-vers-stand-body></tbody></table>
      </div>
    </div>
    <div class="immo-section">
      <h4>Notiz</h4>
      <div><textarea data-f="notiz" rows="2" style="width:100%;box-sizing:border-box">${esc(d.notiz || "")}</textarea></div>
    </div>
    <div class="immo-actions">
      <button data-vers-save>Speichern</button>
      <span data-vers-msg style="font-size:13px"></span>
    </div>`;
}

function versCardHTML(d) {
  const ampel = versAmpel(d.ablauf);
  const praemieJ = versPraemieJahr(d);
  const cur = d.art === "kapital" ? versCurrentWert(d.id) : null;
  const katLabel = {
    leben_kapital: "Lebensvers.", risikoleben: "Risikoleben", bu_unfall: "BU/Unfall",
    ltc: "LTC/Pflege", kranken: "Kranken", kfz: "KFZ/RC", hausrat_haftpflicht: "Hausrat/HP",
    gebaeude: "Gebäude", sonstiges: "Sonstiges",
  }[d.kategorie || ""] || d.kategorie || "";
  const subParts = [
    esc(d.gesellschaft || ""),
    katLabel,
    praemieJ ? euro(praemieJ) + "/Jahr" : "",
    cur != null ? "Rückkauf: " + euro(cur) : "",
  ].filter(Boolean).join(" · ");
  return `<div class="immo-card collapsed" data-id="${d.id}">
    <div class="immo-head" data-vers-toggle>
      <span class="chev">▾</span>
      <div class="titlewrap">
        <div class="immo-title">${esc(d.bezeichnung || "Neue Police")}</div>
        <div class="immo-sub">${subParts}</div>
      </div>
      <span style="font-size:12px;color:${ampel.color};white-space:nowrap;margin-right:8px">${ampel.label}</span>
      <button class="iconbtn" data-vers-del title="Löschen"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
    </div>
    <div class="immo-body">${versFieldsHTML(d)}</div>
  </div>`;
}

function readVersCard(card) {
  const g = (f) => { const el = card.querySelector(`[data-f="${f}"]`); return el ? el.value : ""; };
  return {
    id: card.getAttribute("data-id") || null,
    bezeichnung: g("bezeichnung") || null,
    gesellschaft: g("gesellschaft") || null,
    art: g("art") || "risiko",
    kategorie: g("kategorie") || null,
    praemie: numDE(g("praemie")),
    zahlweise: g("zahlweise") || "jaehrlich",
    vertragsstart: g("vertragsstart") || null,
    ablauf: g("ablauf") || null,
    versicherungssumme: numDE(g("versicherungssumme")),
    beguenstigter: g("beguenstigter") || null,
    absetzbar: g("absetzbar") !== "nein",
    bindung: g("bindung") || null,
    notiz: g("notiz") || null,
  };
}

function recomputeVersCard(card) {
  const d = readVersCard(card);
  const isKapital = d.art === "kapital";
  const kapitalEl = card.querySelector("[data-vers-kapital]");
  if (kapitalEl) kapitalEl.style.display = isKapital ? "" : "none";
  if (isKapital) {
    const cur = versCurrentWert(d.id);
    const el = card.querySelector("[data-k='curwert']"); if (el) el.textContent = euro(cur);
    const hist = versHistory(d.id);
    const body = card.querySelector("[data-vers-stand-body]");
    if (body) body.innerHTML = [...hist].reverse().map((s) => `<tr><td>${s.datum ? new Date(s.datum).toLocaleDateString("de-DE") : ""}</td><td class="num">${euro(Number(s.wert) || 0)}</td><td class="num"><button class="danger" data-vers-stand-del="${s.id}">Löschen</button></td></tr>`).join("") || `<tr><td colspan="3" class="empty">Noch keine Stände erfasst.</td></tr>`;
    const chartEl = card.querySelector("[data-vers-chart]");
    if (chartEl) drawAreaChart(chartEl, hist.map((s) => ({ m: String(s.datum).slice(0, 7), v: Number(s.wert) || 0 })));
  }
  // Ampel in Head aktualisieren
  const ampel = versAmpel(d.ablauf);
  const ampelEl = card.querySelector(".immo-head > span[style*='white-space']");
  if (ampelEl) { ampelEl.textContent = ampel.label; ampelEl.style.color = ampel.color; }
  // Sub-Zeile aktualisieren
  const praemieJ = versPraemieJahr(d);
  const cur2 = isKapital ? versCurrentWert(d.id) : null;
  const katLabel = { leben_kapital: "Lebensvers.", risikoleben: "Risikoleben", bu_unfall: "BU/Unfall", ltc: "LTC/Pflege", kranken: "Kranken", kfz: "KFZ/RC", hausrat_haftpflicht: "Hausrat/HP", gebaeude: "Gebäude", sonstiges: "Sonstiges" }[d.kategorie || ""] || "";
  const sub = card.querySelector(".immo-sub");
  if (sub) sub.textContent = [d.gesellschaft, katLabel, praemieJ ? euro(praemieJ) + "/Jahr" : "", cur2 != null ? "Rückkauf: " + euro(cur2) : ""].filter(Boolean).join(" · ");
  const title = card.querySelector(".immo-title");
  if (title) title.textContent = d.bezeichnung || "Neue Police";
}

function renderVersSummary() {
  let gesamtPraemie = 0;
  versRows.forEach((d) => { gesamtPraemie += versPraemieJahr(d); });
  let kapWert = 0;
  versRows.filter((d) => d.art === "kapital").forEach((d) => { kapWert += versCurrentWert(d.id); });
  setText("vers-sum-wert", euro(kapWert));
  setText("vers-sum-praemie", euro(gesamtPraemie));
  setText("vers-sum-detrazione", euro(versDetrazione()));
}

function renderVers() {
  const list = document.getElementById("vers-list");
  if (!list) return;
  list.innerHTML = versRows.map(versCardHTML).join("");
  const emptyEl = document.getElementById("vers-empty");
  if (emptyEl) emptyEl.classList.toggle("hidden", versRows.length > 0);
  list.querySelectorAll(".immo-card").forEach((card) => recomputeVersCard(card));
  const iso = isoDate(new Date());
  list.querySelectorAll("[data-vers-stand-datum]").forEach((el) => { el.value = iso; });
  renderVersSummary();
}

const versListEl = document.getElementById("vers-list");
versListEl.addEventListener("input",  (e) => { const c = e.target.closest(".immo-card"); if (c) { recomputeVersCard(c); renderVersSummary(); } });
versListEl.addEventListener("change", (e) => { const c = e.target.closest(".immo-card"); if (c) { recomputeVersCard(c); renderVersSummary(); } });
versListEl.addEventListener("click", async (e) => {
  const card = e.target.closest(".immo-card"); if (!card) return;
  // Toggle
  if (e.target.closest("[data-vers-toggle]") && !e.target.closest("[data-vers-del]")) {
    card.classList.toggle("collapsed"); return;
  }
  // Löschen
  if (e.target.closest("[data-vers-del]")) {
    e.stopPropagation();
    if (!confirm("Diese Police wirklich löschen?")) return;
    const { error } = await sb.from("versicherungen").delete().eq("id", card.getAttribute("data-id"));
    if (error) alert("Fehler: " + error.message); else loadVers();
    return;
  }
  // Stand erfassen
  if (e.target.closest("[data-vers-stand-add]")) {
    const datum = card.querySelector("[data-vers-stand-datum]").value;
    const wert  = numDE(card.querySelector("[data-vers-stand-wert]").value);
    if (!datum || wert == null) { alert("Bitte Datum und Wert eingeben."); return; }
    const { error } = await sb.from("versicherung_stand").insert([{ vers_id: card.getAttribute("data-id"), datum, wert }]);
    if (error) { alert("Fehler: " + error.message); return; }
    loadVers(); return;
  }
  // Stand löschen
  const standDel = e.target.closest("[data-vers-stand-del]");
  if (standDel) {
    const { error } = await sb.from("versicherung_stand").delete().eq("id", standDel.getAttribute("data-vers-stand-del"));
    if (error) alert("Fehler: " + error.message); else loadVers();
    return;
  }
  // Speichern
  if (e.target.closest("[data-vers-save]")) {
    const d = readVersCard(card); const id = d.id; delete d.id;
    const msg = card.querySelector("[data-vers-msg]");
    let error;
    if (id) ({ error } = await sb.from("versicherungen").update(d).eq("id", id));
    else    ({ error } = await sb.from("versicherungen").insert([d]));
    if (error) { if (msg) { msg.textContent = "Fehler: " + error.message; msg.style.color = "var(--red)"; } return; }
    if (msg) { msg.textContent = "Gespeichert."; msg.style.color = "var(--green)"; setTimeout(() => { msg.textContent = ""; }, 2000); }
    loadVers(); return;
  }
});

document.getElementById("vers-add").addEventListener("click", async () => {
  const { error } = await sb.from("versicherungen").insert([{ bezeichnung: "Neue Police", art: "risiko", kategorie: "sonstiges", zahlweise: "jaehrlich", absetzbar: true }]);
  if (error) { alert("Fehler beim Anlegen: " + error.message); return; }
  loadVers();
});

// ======================================================================
//  Simulation — V1: Liquiditätsprognose
// ======================================================================
let simSettings = {};
let simEvents = [];  // [{id, label, betrag, monat}]
let simSidebarW = 320;
let simSidebarCollapsed = false;

async function loadSim() {
  const [se, sz, sa] = await Promise.all([
    sb.from("sim_einstellungen").select("*").limit(1).maybeSingle(),
    sb.from("sim_ziele").select("*").order("prioritaet", { ascending: true }),
    sb.from("sim_aktionen").select("*").order("datum_start", { ascending: true }),
  ]);
  simSettings = se.data || {};
  simEvents = Array.isArray(simSettings.einmal_events) ? simSettings.einmal_events : [];
  simZiele = sz.data || [];
  simAktionen = sa.data || [];
  renderSim();
  renderSimZiele();
  // Szenarien nur rendern wenn Seite aktiv
  if (document.getElementById("page-sim-szenarien") && !document.getElementById("page-sim-szenarien").classList.contains("hidden")) {
    renderSimSzenarien();
  }
}

let _simSaveTimer = null;
async function saveSim() {
  const payload = {
    horizont_monate: Number(simSettings.horizont_monate) || 24,
    mindest_puffer: simSettings.mindest_puffer || null,
    einmal_events: simEvents,
  };
  if (simSettings.id) {
    await sb.from("sim_einstellungen").update(payload).eq("id", simSettings.id);
  } else {
    const { data } = await sb.from("sim_einstellungen").upsert(payload, { onConflict: "user_id" }).select().maybeSingle();
    if (data) simSettings.id = data.id;
  }
}
function debounceSaveSim() {
  clearTimeout(_simSaveTimer);
  _simSaveTimer = setTimeout(saveSim, 600);
}

// Gesamte Liquidität aus Banksalden + Transaktionen
function simCurrentLiquid() {
  let total = 0;
  banks.forEach((b) => {
    const txSum = allRows.filter((r) => !r.umbuchung && (r.bank || "") === b.name)
      .reduce((s, r) => s + (Number(r.soll) || 0) + (Number(r.haben) || 0), 0);
    total += (Number(b.saldo_start) || 0) + txSum;
  });
  return total;
}

// Ø monatliche Ein-/Ausgaben aus den letzten 12 Monaten (umbuchungen ausgeschlossen)
function simAvgCashflow() {
  const today = new Date();
  const cutoff = new Date(today.getFullYear(), today.getMonth() - 12, 1);
  const cutoffM = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}`;
  const relevant = allRows.filter((r) => !r.umbuchung && r.buchungsdatum && r.buchungsdatum.slice(0, 7) >= cutoffM);
  const map = {};
  relevant.forEach((r) => {
    const m = r.buchungsdatum.slice(0, 7);
    if (!map[m]) map[m] = { ein: 0, aus: 0 };
    map[m].ein += Number(r.haben) || 0;
    map[m].aus += Number(r.soll) || 0;
  });
  const months = Object.values(map);
  if (!months.length) return { ein: 0, aus: 0, net: 0 };
  const avgEin = months.reduce((s, m) => s + m.ein, 0) / months.length;
  const avgAus = months.reduce((s, m) => s + m.aus, 0) / months.length;
  return { ein: avgEin, aus: avgAus, net: avgEin + avgAus };
}

// Vorwärtsprojektion: gibt Monatsserie + Basisdaten zurück
function projectLiquiditaet() {
  const horizont = Number(simSettings.horizont_monate) || 24;
  const liquid0 = simCurrentLiquid();
  const { ein: avgEin, aus: avgAus, net: avgNet } = simAvgCashflow();
  const today = new Date();
  const series = [];
  let base = liquid0, pess = liquid0, opt = liquid0;
  for (let i = 0; i < horizont; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() + i + 1, 1);
    const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const evts = simEvents.filter((e) => e.monat === m);
    const evtSum = evts.reduce((s, e) => s + (Number(e.betrag) || 0), 0);
    base += avgNet + evtSum;
    pess += (avgEin * 0.85 + avgAus) + evtSum;
    opt  += (avgEin * 1.15 + avgAus) + evtSum;
    series.push({ m, base, pess, opt, events: evts });
  }
  return { series, liquid0, avgEin, avgAus, avgNet };
}

// Hilfsfunktion: "schöner" Y-Achsen-Schritt
function niceStepSim(rough) {
  if (rough <= 0) return 1000;
  const e = Math.pow(10, Math.floor(Math.log10(rough)));
  const f = rough / e;
  return e * (f < 2 ? 1 : f < 5 ? 2 : 5);
}

function drawSimLiqChart(el, series, puffer) {
  if (!el) return;
  if (!series || series.length < 2) {
    el.innerHTML = `<div class="empty" style="padding:40px 0">Keine Transaktionsdaten für die Prognose. Bitte Transaktionen im Bereich Finanzen erfassen.</div>`;
    return;
  }
  const W = 880, H = 270, padL = 78, padR = 18, padT = 22, padB = 44;
  const n = series.length;
  const allV = series.flatMap((p) => [p.pess, p.base, p.opt]);
  if (puffer) allV.push(puffer);
  allV.push(0);
  const rawMax = Math.max(...allV), rawMin = Math.min(...allV);
  const pad = (rawMax - rawMin) * 0.1 || 500;
  const maxV = rawMax + pad, minV = rawMin - pad;
  const rng = maxV - minV;
  const X = (i) => padL + (i / (n - 1)) * (W - padL - padR);
  const Y = (v) => H - padB - ((v - minV) / rng) * (H - padT - padB);

  const ptStr = (key) => series.map((p, i) => `${X(i).toFixed(1)},${Y(p[key]).toFixed(1)}`).join(" ");
  const bandPoly = series.map((p, i) => `${X(i).toFixed(1)},${Y(p.opt).toFixed(1)}`).join(" ") + " " +
    [...series].reverse().map((p, _, arr) => {
      const origI = series.indexOf(p);
      return `${X(origI).toFixed(1)},${Y(p.pess).toFixed(1)}`;
    }).join(" ");

  const step = niceStepSim((maxV - minV) / 4);
  const yStart = Math.ceil(minV / step) * step;
  const yTicks = [];
  for (let v = yStart; v <= maxV; v += step) {
    const y = Y(v).toFixed(1);
    const label = Math.abs(v) >= 1000 ? (v / 1000).toFixed(v % 1000 === 0 ? 0 : 1) + "k" : Math.round(v) + "";
    yTicks.push(`<line x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" stroke="var(--border)" stroke-width="1" opacity="0.5"/>
      <text x="${padL - 6}" y="${Number(y) + 4}" fill="#6B6B6B" font-size="11" text-anchor="end">${label}</text>`);
  }

  const y0str = Y(0).toFixed(1);
  const zeroLine = (Number(y0str) > padT && Number(y0str) < H - padB)
    ? `<line x1="${padL}" x2="${W - padR}" y1="${y0str}" y2="${y0str}" stroke="#6B6B6B" stroke-width="1" opacity="0.3" stroke-dasharray="3,3"/>`
    : "";

  const pufferY = puffer ? Y(puffer).toFixed(1) : null;
  const pufferLine = pufferY
    ? `<line x1="${padL}" x2="${W - padR}" y1="${pufferY}" y2="${pufferY}" stroke="#E53935" stroke-width="1.5" stroke-dasharray="6,4" opacity="0.8"/>
       <text x="${W - padR}" y="${Number(pufferY) - 4}" fill="#E53935" font-size="11" text-anchor="end">Puffer</text>`
    : "";

  const labelStep = n <= 12 ? 1 : n <= 24 ? 2 : 6;
  const xLabels = series
    .filter((_, i) => i % labelStep === 0 || i === n - 1)
    .map((p) => {
      const i = series.indexOf(p);
      return `<text x="${X(i).toFixed(1)}" y="${H - padB + 16}" fill="#6B6B6B" font-size="11" text-anchor="middle">${fmtMonthShort(p.m)}</text>`;
    }).join("");

  const eventMarkers = series.flatMap((p, i) =>
    (p.events || []).filter((e) => e.label || e.betrag).map(() =>
      `<circle cx="${X(i).toFixed(1)}" cy="${Y(p.base).toFixed(1)}" r="6" fill="#F59E0B" stroke="white" stroke-width="1.5"/>`
    )
  ).join("");

  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block" id="sim-liq-svg">
      ${yTicks.join("")}${zeroLine}
      <polygon points="${bandPoly}" fill="rgba(47,93,168,0.10)"/>
      <polyline points="${ptStr("pess")}" fill="none" stroke="#2F5DA8" stroke-width="1.5" stroke-dasharray="5,3" opacity="0.45"/>
      <polyline points="${ptStr("opt")}"  fill="none" stroke="#2F5DA8" stroke-width="1.5" stroke-dasharray="5,3" opacity="0.45"/>
      <polyline points="${ptStr("base")}" fill="none" stroke="#2F5DA8" stroke-width="2.5"/>
      ${pufferLine}${eventMarkers}${xLabels}
      <line id="slg-guide" y1="${padT}" y2="${H - padB}" stroke="#C4C4C4" stroke-width="1" style="display:none"/>
      <circle id="slg-dot" r="5" fill="#2F5DA8" stroke="#FFFFFF" stroke-width="1.5" style="display:none"/>
    </svg>
    <div id="slg-tip" class="chart-tip" style="display:none;min-width:160px"></div>`;

  const svg = el.querySelector("svg");
  const guide = el.querySelector("#slg-guide");
  const dot = el.querySelector("#slg-dot");
  const tip = el.querySelector("#slg-tip");
  svg.addEventListener("mousemove", (e) => {
    const rect = svg.getBoundingClientRect();
    const sx = (e.clientX - rect.left) / rect.width * W;
    let best = 0, bd = Infinity;
    series.forEach((_, i) => { const d = Math.abs(X(i) - sx); if (d < bd) { bd = d; best = i; } });
    const p = series[best];
    const gx = X(best).toFixed(1), gy = Y(p.base).toFixed(1);
    guide.setAttribute("x1", gx); guide.setAttribute("x2", gx); guide.style.display = "";
    dot.setAttribute("cx", gx); dot.setAttribute("cy", gy); dot.style.display = "";
    const evtHtml = (p.events || []).length
      ? `<br><span style="color:var(--warning)">📌 ${p.events.map((e) => esc(e.label || "Ereignis") + (e.betrag ? " (" + euro(Number(e.betrag)) + ")" : "")).join(", ")}</span>` : "";
    const belowPuff = puffer && p.base < puffer ? `<br><span style="color:var(--red)">⚠ unter Mindest-Puffer</span>` : "";
    tip.innerHTML = `<b>${fmtMonthLong(p.m)}</b><br>
      Pess.: <b>${euro(p.pess)}</b><br>
      Basis: <b>${euro(p.base)}</b><br>
      Opt.:  <b>${euro(p.opt)}</b>${evtHtml}${belowPuff}`;
    const leftPx = Math.max(80, Math.min(rect.width - 130, (Number(gx) / W) * rect.width));
    tip.style.left = leftPx + "px"; tip.style.top = "8px"; tip.style.display = "";
  });
  svg.addEventListener("mouseleave", () => { guide.style.display = "none"; dot.style.display = "none"; tip.style.display = "none"; });
}

function renderSimEvents() {
  const list = document.getElementById("sim-events-list");
  if (!list) return;
  if (!simEvents.length) {
    list.innerHTML = `<div style="font-size:13px;color:var(--muted);margin-bottom:6px">Keine Ereignisse erfasst.</div>`;
    return;
  }
  list.innerHTML = simEvents.map((e, i) => `
    <div class="sim-event-row" data-evtidx="${i}">
      <input type="text" class="sim-ev-label" placeholder="Bezeichnung" value="${esc(e.label || "")}" style="min-width:0">
      <input type="text" inputmode="decimal" class="sim-ev-betrag" placeholder="-18.000" value="${fmtNum(e.betrag)}" style="max-width:90px">
      <input type="month" class="sim-ev-monat" value="${e.monat || ""}" style="max-width:130px">
      <button class="danger" data-sim-ev-del="${i}" style="padding:7px;white-space:nowrap">✕</button>
    </div>`).join("");
}

function renderSim() {
  const page = document.getElementById("page-simulator-uebersicht");
  if (!page || page.classList.contains("hidden")) return;

  const horizont = Number(simSettings.horizont_monate) || 24;
  const puffer   = Number(simSettings.mindest_puffer) || 0;

  // Horizont-Slider Sync
  const slider = document.getElementById("sim-horizont");
  if (slider && slider.value != horizont) slider.value = horizont;
  const slLabel = document.getElementById("sim-horizont-label");
  if (slLabel) slLabel.textContent = horizont + " Mon.";

  // Puffer-Feld Sync
  const pufferInput = document.getElementById("sim-puffer");
  if (pufferInput && !pufferInput.matches(":focus") && puffer) pufferInput.value = fmtNum(puffer);

  const { series, liquid0, avgEin, avgAus, avgNet } = projectLiquiditaet();

  // KPIs
  const tiefpunkt = series.reduce((min, p) => p.base < min.v ? { v: p.base, m: p.m } : min, { v: Infinity, m: "" });
  const unterPuffer = puffer > 0 ? series.filter((p) => p.base < puffer).length : 0;

  setText("sim-heute", euro(liquid0));
  setText("sim-tiefpunkt", tiefpunkt.v === Infinity ? "–" : `${euro(tiefpunkt.v)}\xa0(${fmtMonthShort(tiefpunkt.m)})`);
  const spEl = document.getElementById("sim-sparrate");
  if (spEl) { spEl.textContent = (avgNet >= 0 ? "+" : "") + euro(avgNet) + "/Mon"; spEl.className = "v " + (avgNet >= 0 ? "pos" : "neg"); }
  const upEl = document.getElementById("sim-unter-puffer");
  if (upEl) { upEl.textContent = puffer > 0 ? (unterPuffer > 0 ? unterPuffer + " Mon." : "Keiner ✓") : "–"; upEl.style.color = unterPuffer > 0 ? "var(--red)" : "var(--green)"; }

  // Datenbasis Sidebar
  setText("sim-avg-ein", euro(avgEin));
  setText("sim-avg-aus", euro(avgAus));
  const netEl = document.getElementById("sim-avg-net");
  if (netEl) { netEl.textContent = (avgNet >= 0 ? "+" : "") + euro(avgNet); netEl.style.color = avgNet >= 0 ? "var(--green)" : "var(--red)"; }

  drawSimLiqChart(document.getElementById("sim-liq-chart"), series, puffer || null);
  renderSimEvents();
}

// Sidebar Resize (Drag-Divider)
const _simDiv = document.getElementById("sim-divider");
const _simSb  = document.getElementById("sim-sidebar");
const _simColBtn = document.getElementById("sim-collapse-btn");

_simDiv.addEventListener("mousedown", (e) => {
  if (e.target.closest(".sim-collapse-btn")) return;
  e.preventDefault();
  const startX = e.clientX, startW = simSidebarW;
  const onMove = (ev) => {
    const newW = Math.max(220, Math.min(600, startW + (startX - ev.clientX)));
    simSidebarW = newW;
    if (!simSidebarCollapsed) _simSb.style.width = newW + "px";
  };
  const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
});

_simColBtn.addEventListener("click", () => {
  simSidebarCollapsed = !simSidebarCollapsed;
  _simSb.style.transition = "width .15s ease";
  _simSb.classList.toggle("collapsed", simSidebarCollapsed);
  if (!simSidebarCollapsed) _simSb.style.width = simSidebarW + "px";
  _simColBtn.textContent = simSidebarCollapsed ? "◀" : "▶";
  setTimeout(() => { _simSb.style.transition = ""; }, 200);
});

// ---- Simulation V2: Finanzielle Ziele ----
let simZiele = [];

// FV = P·(1+r)^n + E·((1+r)^n − 1)/r
function simFV(startkapital, sparrate, rendite_pa, months) {
  const r = rendite_pa / 100 / 12, n = months;
  if (Math.abs(r) < 1e-10) return startkapital + sparrate * n;
  return startkapital * Math.pow(1 + r, n) + sparrate * ((Math.pow(1 + r, n) - 1) / r);
}
// Nötige Monatsrate für E = (Ziel − P·(1+r)^n) · r / ((1+r)^n − 1)
function simReqSparrate(zielbetrag, startkapital, rendite_pa, months) {
  const r = rendite_pa / 100 / 12, n = months;
  if (n <= 0) return Infinity;
  const fvLump = Math.abs(r) < 1e-10 ? startkapital : startkapital * Math.pow(1 + r, n);
  const needed = zielbetrag - fvLump;
  if (Math.abs(r) < 1e-10) return needed / n;
  const ann = (Math.pow(1 + r, n) - 1) / r;
  return ann < 1e-10 ? Infinity : needed / ann;
}
// Monate bis Ziel (Binärsuche)
function simMonthsToGoal(startkapital, sparrate, rendite_pa, zielbetrag) {
  if (zielbetrag <= 0 || startkapital >= zielbetrag) return 0;
  const maxN = 12 * 60;
  if (simFV(startkapital, sparrate, rendite_pa, maxN) < zielbetrag) return Infinity;
  let lo = 1, hi = maxN;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    simFV(startkapital, sparrate, rendite_pa, mid) >= zielbetrag ? (hi = mid) : (lo = mid + 1);
  }
  return lo;
}

const TYP_RENDITE_DEF = { notgroschen: 1.5, sparziel: 4.0, ruhestand: 5.0, freiheit: 6.0 };
const TYP_LABEL_MAP = { notgroschen: "Notgroschen", sparziel: "Sparziel", ruhestand: "Ruhestand", freiheit: "Fin. Freiheit" };

function zielKPIsCalc(d) {
  const rendite = Number(d.rendite_override) || TYP_RENDITE_DEF[d.typ] || 4;
  let zielbetrag = Number(d.zielbetrag) || 0;
  let startkapital = Number(d.startkapital) || 0;
  let sparrate = Number(d.sparrate) || 0;
  let fireMsg = null;

  if (d.typ === "freiheit") {
    const liquid = simCurrentLiquid();
    const latest = latestPortfolioMap(portfolioRows, null);
    const passivM = currentPassiveIncome();
    const { avgAus, avail, luecke } = computeFFKPIs(liquid, latest, passivM);
    if (luecke <= 0) {
      return { alreadyFire: true, pct: 100, ampel: "green", zielbetrag: 0, startkapital: avail, sparrate, rendite, reqSparrate: 0, prognoseDatum: new Date(), months: 0, fireMsg: "Passives Einkommen deckt bereits die Ausgaben. 🎉" };
    }
    const r = rendite / 100 / 12;
    if (!zielbetrag) zielbetrag = r > 0 ? luecke / r : 0;
    if (!startkapital) startkapital = Math.max(0, avail);
    if (!sparrate) sparrate = Math.max(0, simAvgCashflow().net);
    fireMsg = `Monatl. Lücke: ${euro(luecke)} · Verfügbares Vermögen: ${euro(avail)}`;
  }

  const pct = zielbetrag > 0 ? Math.min(100, Math.max(0, (startkapital / zielbetrag) * 100)) : 0;
  const months = zielbetrag > 0 ? simMonthsToGoal(startkapital, sparrate, rendite, zielbetrag) : 0;
  const today = new Date();
  const prognoseDatum = months === Infinity ? null : months === 0 ? today : new Date(today.getFullYear(), today.getMonth() + months, 1);
  const zieldatum = d.zieldatum ? new Date(d.zieldatum + "T00:00:00") : null;
  const monthsToZiel = zieldatum ? Math.round((zieldatum - today) / (1000 * 60 * 60 * 24 * 30.44)) : null;
  const reqSparrate = (monthsToZiel !== null && monthsToZiel > 0 && zielbetrag > 0) ? simReqSparrate(zielbetrag, startkapital, rendite, monthsToZiel) : null;

  let ampel = "green";
  if (pct < 100 && months > 0) {
    if (!prognoseDatum) { ampel = "red"; }
    else if (zieldatum) {
      const diffDays = (prognoseDatum - zieldatum) / 86400000;
      if (diffDays > 90) ampel = "red"; else if (diffDays > 0) ampel = "yellow";
    }
  }
  return { pct, ampel, zielbetrag, startkapital, sparrate, rendite, reqSparrate, prognoseDatum, months, fireMsg };
}

function zielPrognoseDateStr(kpis) {
  if (kpis.alreadyFire) return "FIRE 🎉";
  if (kpis.pct >= 100 || kpis.months === 0) return "✓ Erreicht";
  if (!kpis.prognoseDatum) return "Nicht erreichbar";
  const d = kpis.prognoseDatum;
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function zielFieldsHTML(d, kpis) {
  const g = (f) => (d[f] !== undefined && d[f] !== null && d[f] !== "" ? d[f] : "");
  const isFire = d.typ === "freiheit";
  const ampelColors = { green: "var(--green)", yellow: "var(--warning)", red: "var(--red)" };
  return `
    <div class="immo-section"><h4>Stammdaten</h4><div class="immo-grid">
      <div><label>Bezeichnung</label><input type="text" data-f="bezeichnung" value="${esc(g("bezeichnung"))}"/></div>
      <div><label>Typ</label><select data-f="typ">
        <option value="sparziel" ${d.typ === "sparziel" || !d.typ ? "selected" : ""}>Sparziel (allgemein)</option>
        <option value="notgroschen" ${d.typ === "notgroschen" ? "selected" : ""}>Notgroschen / Puffer</option>
        <option value="ruhestand" ${d.typ === "ruhestand" ? "selected" : ""}>Ruhestand / Rente</option>
        <option value="freiheit" ${d.typ === "freiheit" ? "selected" : ""}>Finanzielle Freiheit (FIRE)</option>
      </select></div>
      <div><label>Priorität</label><select data-f="prioritaet">
        ${[1,2,3,4,5].map((p) => `<option value="${p}" ${Number(g("prioritaet") || 1) === p ? "selected" : ""}>Priorität ${p}</option>`).join("")}
      </select></div>
    </div></div>
    <div class="immo-section"><h4>Zielparameter</h4>
      ${kpis.fireMsg ? `<div class="sim-disclaimer" style="margin-bottom:12px">${esc(kpis.fireMsg)}</div>` : ""}
      <div class="immo-grid">
        <div><label>Zielbetrag (€)${isFire ? " – aus Lücke/Rendite" : ""}</label><input type="text" inputmode="decimal" data-f="zielbetrag" value="${g("zielbetrag") ? fmtNum(g("zielbetrag")) : ""}" placeholder="${isFire && kpis.zielbetrag ? fmtNum(kpis.zielbetrag) : ""}"/></div>
        <div><label>Zieldatum</label><input type="date" data-f="zieldatum" value="${g("zieldatum")}"/></div>
        <div><label>Startkapital (€)</label><input type="text" inputmode="decimal" data-f="startkapital" value="${g("startkapital") ? fmtNum(g("startkapital")) : ""}" placeholder="${isFire && kpis.startkapital ? fmtNum(kpis.startkapital) : "0"}"/></div>
        <div><label>Monatliche Sparrate (€)</label><input type="text" inputmode="decimal" data-f="sparrate" value="${g("sparrate") ? fmtNum(g("sparrate")) : ""}"/></div>
        <div><label>Rendite p.a. (%) – leer = ${TYP_RENDITE_DEF[d.typ] || 4} %</label><input type="text" inputmode="decimal" data-f="rendite_override" value="${g("rendite_override") ? fmtNum(g("rendite_override")) : ""}"/></div>
      </div>
    </div>
    <div class="immo-section"><h4>Hochrechnung</h4>
      <div class="kpi-grid">
        <div class="kpibox"><div class="kpi-k">Fortschritt</div><div class="kpi-v">${fmtNum(kpis.pct, 1)} %</div></div>
        <div class="kpibox"><div class="kpi-k">Prognose-Datum</div><div class="kpi-v" style="font-size:16px;color:${ampelColors[kpis.ampel]}">${zielPrognoseDateStr(kpis)}</div></div>
        <div class="kpibox"><div class="kpi-k">Nötige Sparrate (Zieldatum)</div><div class="kpi-v">${kpis.reqSparrate !== null ? euro(kpis.reqSparrate) + "/Mon" : "–"}</div></div>
        <div class="kpibox"><div class="kpi-k">Fehlender Betrag</div><div class="kpi-v">${kpis.zielbetrag > 0 ? euro(Math.max(0, kpis.zielbetrag - kpis.startkapital)) : "–"}</div></div>
        <div class="kpibox"><div class="kpi-k">Eff. Rendite</div><div class="kpi-v">${fmtNum(kpis.rendite, 1)} %</div></div>
        <div class="kpibox"><div class="kpi-k">Monate bis Ziel</div><div class="kpi-v">${kpis.months === Infinity ? "∞" : kpis.months === 0 ? "✓" : kpis.months}</div></div>
      </div>
    </div>
    <div class="immo-section"><h4>Notiz</h4>
      <div><textarea data-f="notiz" rows="2" style="width:100%;box-sizing:border-box">${esc(g("notiz"))}</textarea></div>
    </div>
    <div class="immo-actions">
      <button data-ziel-save>Speichern</button>
      <span data-ziel-msg style="font-size:13px"></span>
    </div>`;
}

function zielCardHTML(d) {
  const kpis = zielKPIsCalc(d);
  const pctW = kpis.pct.toFixed(1);
  const pctColor = { green: "#4CAF50", yellow: "#F59E0B", red: "#E53935" }[kpis.ampel] || "#4CAF50";
  const typLabel = TYP_LABEL_MAP[d.typ] || d.typ || "Ziel";
  const subParts = [typLabel, kpis.zielbetrag ? euro(kpis.zielbetrag) : "", d.zieldatum ? "bis " + new Date(d.zieldatum + "T00:00:00").toLocaleDateString("de-DE", { month: "2-digit", year: "numeric" }) : ""].filter(Boolean).join(" · ");
  const dotColor = { green: "var(--green)", yellow: "var(--warning)", red: "var(--red)" }[kpis.ampel];
  return `<div class="immo-card collapsed" data-id="${d.id}">
    <div class="immo-head" data-ziel-toggle>
      <span class="chev">▾</span>
      <div class="titlewrap" style="flex:1;min-width:0">
        <div class="immo-title">${esc(d.bezeichnung || "Neues Ziel")}</div>
        <div class="immo-sub">${subParts}</div>
        <div style="height:3px;border-radius:2px;background:var(--border);margin-top:5px;overflow:hidden;max-width:300px">
          <div style="height:100%;width:${pctW}%;background:${pctColor};border-radius:2px"></div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:5px;white-space:nowrap;margin-left:10px">
        <span class="dot" style="background:${dotColor}"></span>
        <span style="font-size:12px;color:var(--muted)">${zielPrognoseDateStr(kpis)}</span>
      </div>
      <button class="iconbtn" data-ziel-del title="Löschen"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
    </div>
    <div class="immo-body">${zielFieldsHTML(d, kpis)}</div>
  </div>`;
}

function readZielCard(card) {
  const g = (f) => { const el = card.querySelector(`[data-f="${f}"]`); return el ? el.value : ""; };
  return {
    id: card.getAttribute("data-id"),
    bezeichnung: g("bezeichnung") || null,
    typ: g("typ") || "sparziel",
    prioritaet: Number(g("prioritaet")) || 1,
    zielbetrag: numDE(g("zielbetrag")),
    zieldatum: g("zieldatum") || null,
    startkapital: numDE(g("startkapital")),
    sparrate: numDE(g("sparrate")),
    rendite_override: numDE(g("rendite_override")),
    notiz: g("notiz") || null,
  };
}

function recomputeZielCard(card) {
  const d = readZielCard(card);
  const kpis = zielKPIsCalc(d);
  // Progress bar
  const bar = card.querySelector(".titlewrap > div:last-of-type > div");
  if (bar) { const c = { green: "#4CAF50", yellow: "#F59E0B", red: "#E53935" }[kpis.ampel]; bar.style.width = kpis.pct.toFixed(1) + "%"; bar.style.background = c; }
  // Ampel dot + prognose text
  const dot = card.querySelector(".immo-head > div > span.dot");
  const progTxt = card.querySelector(".immo-head > div > span:not(.dot)");
  const dc = { green: "var(--green)", yellow: "var(--warning)", red: "var(--red)" };
  if (dot) dot.style.background = dc[kpis.ampel];
  if (progTxt) progTxt.textContent = zielPrognoseDateStr(kpis);
  // Title / sub
  const title = card.querySelector(".immo-title"); if (title) title.textContent = d.bezeichnung || "Neues Ziel";
  // KPI boxes
  const kpiVals = card.querySelectorAll(".kpibox .kpi-v");
  if (kpiVals.length >= 6) {
    const aColor = dc[kpis.ampel] || dc.green;
    kpiVals[0].textContent = fmtNum(kpis.pct, 1) + " %";
    kpiVals[1].textContent = zielPrognoseDateStr(kpis); kpiVals[1].style.color = aColor;
    kpiVals[2].textContent = kpis.reqSparrate !== null ? euro(kpis.reqSparrate) + "/Mon" : "–";
    kpiVals[3].textContent = kpis.zielbetrag > 0 ? euro(Math.max(0, kpis.zielbetrag - kpis.startkapital)) : "–";
    kpiVals[4].textContent = fmtNum(kpis.rendite, 1) + " %";
    kpiVals[5].textContent = kpis.months === Infinity ? "∞" : kpis.months === 0 ? "✓" : String(kpis.months);
  }
}

function renderSimZielSummary() {
  const { net: avgNet } = simAvgCashflow();
  let gesamtReq = 0;
  simZiele.forEach((d) => { const k = zielKPIsCalc(d); if (k.reqSparrate !== null && k.reqSparrate > 0) gesamtReq += k.reqSparrate; });
  const diff = avgNet - gesamtReq;
  setText("simz-req-sparrate", euro(gesamtReq) + "/Mon");
  setText("simz-verf-sparrate", (avgNet >= 0 ? "+" : "") + euro(avgNet) + "/Mon");
  const diffEl = document.getElementById("simz-differenz");
  if (diffEl) { diffEl.textContent = (diff >= 0 ? "+" : "") + euro(diff) + "/Mon"; diffEl.className = "v " + (diff >= 0 ? "pos" : "neg"); }
}

function renderSimZiele() {
  const list = document.getElementById("simz-list");
  if (!list) return;
  const sorted = [...simZiele].sort((a, b) => (Number(a.prioritaet) || 1) - (Number(b.prioritaet) || 1));
  list.innerHTML = sorted.map(zielCardHTML).join("");
  const emptyEl = document.getElementById("simz-empty");
  if (emptyEl) emptyEl.classList.toggle("hidden", simZiele.length > 0);
  renderSimZielSummary();
}

const simzListEl = document.getElementById("simz-list");
simzListEl.addEventListener("input",  (e) => { const c = e.target.closest(".immo-card"); if (c) { recomputeZielCard(c); renderSimZielSummary(); } });
simzListEl.addEventListener("change", (e) => { const c = e.target.closest(".immo-card"); if (c) { recomputeZielCard(c); renderSimZielSummary(); } });
simzListEl.addEventListener("click", async (e) => {
  const card = e.target.closest(".immo-card"); if (!card) return;
  if (e.target.closest("[data-ziel-toggle]") && !e.target.closest("[data-ziel-del]")) { card.classList.toggle("collapsed"); return; }
  if (e.target.closest("[data-ziel-del]")) {
    e.stopPropagation();
    if (!confirm("Dieses Ziel wirklich löschen?")) return;
    const { error } = await sb.from("sim_ziele").delete().eq("id", card.getAttribute("data-id"));
    if (error) alert("Fehler: " + error.message); else loadSim();
    return;
  }
  if (e.target.closest("[data-ziel-save]")) {
    const d = readZielCard(card); const id = d.id; delete d.id;
    const msg = card.querySelector("[data-ziel-msg]");
    let error;
    if (id) ({ error } = await sb.from("sim_ziele").update(d).eq("id", id));
    else    ({ error } = await sb.from("sim_ziele").insert([d]));
    if (error) { if (msg) { msg.textContent = "Fehler: " + error.message; msg.style.color = "var(--red)"; } return; }
    if (msg) { msg.textContent = "Gespeichert."; msg.style.color = "var(--green)"; setTimeout(() => { msg.textContent = ""; }, 2000); }
    loadSim(); return;
  }
});

document.getElementById("simz-add").addEventListener("click", async () => {
  const { error } = await sb.from("sim_ziele").insert([{ bezeichnung: "Neues Ziel", typ: "sparziel", prioritaet: simZiele.length + 1 }]);
  if (error) { alert("Fehler: " + error.message); return; }
  loadSim();
  setTimeout(() => { document.getElementById("page-sim-ziele")?.scrollTo(0, 999999); }, 200);
});

// ---- Simulation V3: Szenarien ----
let simAktionen = [];
let sznSidebarW = 320, sznSidebarCollapsed = false;

// Alle echten Assets als flache Liste mit Startwerten aufbauen
function buildSimAssets() {
  const assets = [];
  const latest = latestPortfolioMap(portfolioRows, null);

  banks.filter((b) => b.hat_portfolio).forEach((b) => {
    let val = 0;
    Object.values(latest).filter((r) => (r.bank || "") === b.name).forEach((r) => { val += (Number(r.wert) || 0) * userShare(b.name); });
    assets.push({ id: b.id, typ: "portfolio", name: b.name, value: val, defaultRendite: Number(simSettings.rendite_etf) || 6 });
  });

  immoRows.forEach((d) => {
    const k = immoKPIs(d);
    const sh = (Number(d.anteil_user) || 100) / 100;
    assets.push({ id: d.id, typ: "immo", name: d.strasse || d.name || "Immobilie", value: (k.ekWert || 0) * sh, defaultRendite: Number(d.wertsteigerung) || Number(simSettings.rendite_immo) || 2 });
  });

  banks.filter((b) => !b.hat_portfolio).forEach((b) => {
    const txSum = allRows.filter((r) => !r.umbuchung && (r.bank || "") === b.name).reduce((s, r) => s + (Number(r.soll) || 0) + (Number(r.haben) || 0), 0);
    assets.push({ id: b.id, typ: "bank", name: b.name, value: (Number(b.saldo_start) || 0) + txSum, defaultRendite: Number(simSettings.rendite_liquide) || 1.5 });
  });

  betRows.forEach((d) => {
    assets.push({ id: d.id, typ: "bet", name: d.name || "Beteiligung", value: betKPIs(d).vermoegen || 0, defaultRendite: 4 });
  });

  pensRows.forEach((d) => {
    assets.push({ id: d.id, typ: "pens", name: d.name || "Pensionsfonds", value: pensCurrentWert(d.id), defaultRendite: Number(d.rendite) || 4 });
  });

  versRows.filter((d) => d.art === "kapital").forEach((d) => {
    assets.push({ id: d.id, typ: "vers", name: d.bezeichnung || "Versicherung Kapital", value: versCurrentWert(d.id), defaultRendite: 2 });
  });

  return assets;
}

// Asset-class-specific volatility bands (pess/optim multipliers)
const SIM_MULT = {
  base:  { portfolio:1.00, immo:1.00, bank:1.00, bet:1.00, pens:1.00, vers:1.00 },
  pess:  { portfolio:0.50, immo:0.60, bank:0.85, bet:0.40, pens:0.70, vers:0.90 },
  optim: { portfolio:1.50, immo:1.40, bank:1.15, bet:1.80, pens:1.30, vers:1.10 },
};
const BOLLO = 0.0020; // 0.20% p.a. Imposta di Bollo (IT)
const ETF_TER = 0.0020; // 0.20% p.a. default TER

function simLatentTax(assetVals) {
  let tax = 0;
  assetVals.forEach((a) => {
    if (a.typ === "portfolio" || a.typ === "bet") {
      const gain = (a.value || 0) - (a.costBasis || 0);
      if (gain > 0) tax += gain * KEST;
    }
  });
  return tax;
}

// Jahresweise Vorwärtsprojektion
function projectSzenarien(assets, horizont, mode = "base") {
  const inflation = (Number(simSettings.inflation) || 2) / 100;
  const liqR = (Number(simSettings.rendite_liquide) || 1.5) / 100;
  const mult = SIM_MULT[mode] || SIM_MULT.base;
  const today = new Date();
  const currentYear = today.getFullYear();

  const assetVals = assets.map((a) => ({
    ...a,
    value: Math.max(0, a.value || 0),
    costBasis: Math.max(0, a.value || 0),
  }));

  let freiesKapital = 0;
  let freiesKapBasis = 0;
  let cumTaxPaid = 0;
  let cumCostsPaid = 0;

  const year0gross = assetVals.reduce((s, a) => s + a.value, 0);
  const year0net = year0gross - simLatentTax(assetVals);
  const series = [{
    year: currentYear,
    total: year0gross,
    netTotal: year0net,
    realNetTotal: year0net,
    taxPaid: 0,
    costsPaid: 0,
  }];

  for (let y = 1; y <= horizont; y++) {
    const year = currentYear + y;
    freiesKapital *= (1 + liqR);

    let yearCosts = 0;

    assetVals.forEach((asset) => {
      const m = mult[asset.typ] || 1.0;
      const rGross = (asset.defaultRendite / 100) * m;

      if (asset.typ === "portfolio") {
        // Grow gross, then subtract Bollo + TER as absolute cost
        asset.value *= (1 + rGross);
        const costsDrag = asset.value * (BOLLO + ETF_TER);
        asset.value -= costsDrag;
        yearCosts += costsDrag;
      } else {
        asset.value *= (1 + rGross);
      }

      // Apply aktionen
      simAktionen.filter((a) => a.asset_ref_id === asset.id).forEach((a) => {
        const startY = a.datum_start ? new Date(a.datum_start + "T00:00:00").getFullYear() : 9999;
        const endY   = a.datum_ende  ? new Date(a.datum_ende  + "T00:00:00").getFullYear() : startY;
        if (a.aktion_typ === "sparplan" && year >= startY && year <= endY) {
          const c = (Number(a.betrag) || 0) * 12;
          asset.value += c;
          asset.costBasis += c;
        } else if ((a.aktion_typ === "einmal" || a.aktion_typ === "auszahlung") && year === startY) {
          const b = Number(a.betrag) || 0;
          asset.value += b;
          if (b > 0) asset.costBasis += b;
          else { freiesKapital += Math.abs(b); freiesKapBasis += Math.abs(b); }
        } else if (a.aktion_typ === "verkauf" && year === startY) {
          const v = a.betrag ? Math.min(asset.value, Number(a.betrag)) : asset.value;
          const ratio = asset.value > 0 ? v / asset.value : 1;
          const gainSold = Math.max(0, v - (asset.costBasis || 0) * ratio);
          const taxOnSale = (asset.typ === "portfolio" || asset.typ === "bet") ? gainSold * KEST : 0;
          cumTaxPaid += taxOnSale;
          freiesKapital += v - taxOnSale;
          freiesKapBasis += v - taxOnSale;
          asset.costBasis = Math.max(0, (asset.costBasis || 0) * (1 - ratio));
          asset.value = Math.max(0, asset.value - v);
        }
      });
    });

    cumCostsPaid += yearCosts;

    const grossTotal = assetVals.reduce((s, a) => s + Math.max(0, a.value), 0) + freiesKapital;
    const netTotal = grossTotal - simLatentTax(assetVals);
    const realNetTotal = netTotal / Math.pow(1 + inflation, y);

    series.push({ year, total: grossTotal, netTotal, realNetTotal, taxPaid: cumTaxPaid, costsPaid: cumCostsPaid });
  }
  return series;
}

function drawSzenarienChart(el, baseSeries, pessimSeries, optimSeries, showReal = false) {
  if (!el || !baseSeries || baseSeries.length < 2) { el.innerHTML = `<div class="empty" style="padding:30px 0">Keine Daten.</div>`; return; }
  const W = 880, H = 220, padL = 72, padR = 12, padT = 16, padB = 36;
  const n = baseSeries.length;
  const allV = [...baseSeries, ...pessimSeries, ...optimSeries].map((p) => p.total)
    .concat(baseSeries.map((p) => p.netTotal))
    .concat(showReal ? baseSeries.map((p) => p.realNetTotal) : [])
    .concat([0]);
  const maxV = Math.max(...allV), minV = Math.min(...allV, 0);
  const rng = maxV - minV || 1;
  const X = (i) => padL + (i / (n - 1)) * (W - padL - padR);
  const Y = (v) => H - padB - ((v - minV) / rng) * (H - padT - padB);
  const pts = (ser) => ser.map((p, i) => `${X(i).toFixed(1)},${Y(p.total).toFixed(1)}`).join(" ");
  const bandPoly = optimSeries.map((p, i) => `${X(i).toFixed(1)},${Y(p.total).toFixed(1)}`).join(" ") +
    " " + [...pessimSeries].reverse().map((p, i, arr) => `${X(n - 1 - i).toFixed(1)},${Y(p.total).toFixed(1)}`).join(" ");
  const ptsNet  = baseSeries.map((p, i) => `${X(i).toFixed(1)},${Y(p.netTotal).toFixed(1)}`).join(" ");
  const ptsReal = showReal ? baseSeries.map((p, i) => `${X(i).toFixed(1)},${Y(p.realNetTotal).toFixed(1)}`).join(" ") : "";
  const step = niceStepSim((maxV - minV) / 4);
  const yStart = Math.ceil(minV / step) * step;
  const yTicks = [];
  for (let v = yStart; v <= maxV + step * 0.5; v += step) {
    const y = Y(v).toFixed(1);
    const lbl = Math.abs(v) >= 1000 ? (v / 1000).toFixed(v % 1000 === 0 ? 0 : 1) + "k" : Math.round(v) + "";
    yTicks.push(`<line x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" stroke="var(--border)" stroke-width="1" opacity="0.5"/>
      <text x="${padL - 5}" y="${Number(y) + 4}" fill="#6B6B6B" font-size="11" text-anchor="end">${lbl}</text>`);
  }
  const xLabels = baseSeries.filter((_, i) => i % Math.max(1, Math.floor(n / 5)) === 0 || i === n - 1)
    .map((p) => { const i = baseSeries.indexOf(p); return `<text x="${X(i).toFixed(1)}" y="${H - padB + 14}" fill="#6B6B6B" font-size="11" text-anchor="middle">${p.year}</text>`; }).join("");

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block" id="szn-svg">
    ${yTicks.join("")}
    <polygon points="${bandPoly}" fill="rgba(47,93,168,0.10)"/>
    <polyline points="${pts(pessimSeries)}" fill="none" stroke="#2F5DA8" stroke-width="1.5" stroke-dasharray="5,3" opacity="0.45"/>
    <polyline points="${pts(optimSeries)}"  fill="none" stroke="#2F5DA8" stroke-width="1.5" stroke-dasharray="5,3" opacity="0.45"/>
    <polyline points="${pts(baseSeries)}"   fill="none" stroke="#2F5DA8" stroke-width="2.5"/>
    <polyline points="${ptsNet}" fill="none" stroke="#2E7D32" stroke-width="2"/>
    ${showReal ? `<polyline points="${ptsReal}" fill="none" stroke="#2E7D32" stroke-width="1.5" stroke-dasharray="5,3"/>` : ""}
    ${xLabels}
    <line id="szn-guide" y1="${padT}" y2="${H - padB}" stroke="#C4C4C4" stroke-width="1" style="display:none"/>
    <circle id="szn-dot" r="5" fill="#2F5DA8" stroke="#FFFFFF" stroke-width="1.5" style="display:none"/>
  </svg><div id="szn-tip" class="chart-tip" style="display:none;min-width:160px"></div>`;

  const svg = el.querySelector("svg"), guide = el.querySelector("#szn-guide"), dot = el.querySelector("#szn-dot"), tip = el.querySelector("#szn-tip");
  svg.addEventListener("mousemove", (e) => {
    const rect = svg.getBoundingClientRect();
    const sx = (e.clientX - rect.left) / rect.width * W;
    let best = 0, bd = Infinity;
    baseSeries.forEach((_, i) => { const d = Math.abs(X(i) - sx); if (d < bd) { bd = d; best = i; } });
    const p = baseSeries[best], pp = pessimSeries[best], po = optimSeries[best];
    const gx = X(best).toFixed(1), gy = Y(p.total).toFixed(1);
    guide.setAttribute("x1", gx); guide.setAttribute("x2", gx); guide.style.display = "";
    dot.setAttribute("cx", gx); dot.setAttribute("cy", gy); dot.style.display = "";
    tip.innerHTML = `<b>${p.year}</b><br>Pess.: <b>${euro(pp.total)}</b><br>Basis: <b>${euro(p.total)}</b><br>Opt.:  <b>${euro(po.total)}</b><br>Netto KeSt: <b>${euro(p.netTotal)}</b><br>${showReal ? `Real: <b>${euro(p.realNetTotal)}</b><br>` : ""}`;
    tip.style.left = Math.max(80, Math.min(rect.width - 130, (Number(gx) / W) * rect.width)) + "px";
    tip.style.top = "8px"; tip.style.display = "";
  });
  svg.addEventListener("mouseleave", () => { guide.style.display = "none"; dot.style.display = "none"; tip.style.display = "none"; });
}

// Aktionen-Tags für ein Asset rendern (Zusammenfassung, nicht editable)
function renderAktionenWrap(assetId, assetTyp) {
  const ak = simAktionen.filter((a) => a.asset_ref_id === assetId);
  const AK_LABELS = { sparplan: "Sparplan", einmal: "Einmalig", verkauf: "Verkauf", auszahlung: "Auszahlung" };
  const tagsHtml = ak.map((a) => {
    const lbl = AK_LABELS[a.aktion_typ] || a.aktion_typ;
    const betr = a.betrag ? euro(Number(a.betrag)) : "Alles";
    const datum = a.datum_start ? new Date(a.datum_start + "T00:00:00").toLocaleDateString("de-DE", { month: "2-digit", year: "numeric" }) : "";
    const end = a.datum_ende ? "–" + new Date(a.datum_ende + "T00:00:00").toLocaleDateString("de-DE", { month: "2-digit", year: "numeric" }) : "";
    return `<span class="sim-ak-tag">${lbl}: ${betr}${datum ? " ab " + datum : ""}${end}<button data-ak-del="${a.id}" title="Löschen">✕</button></span>`;
  }).join("");
  const formId = `ak-form-${assetId}`;
  return `<div class="sim-aktionen-wrap">
    <div style="margin-bottom:6px;min-height:4px">${tagsHtml}</div>
    <div id="${formId}" style="display:none">
      <div class="sim-ak-row">
        <select data-ak-typ style="font-size:12px;padding:5px 7px">
          <option value="sparplan">Sparplan (monatl.)</option>
          <option value="einmal">Einmalkauf / -entnahme</option>
          <option value="verkauf">Verkauf (Teil oder ganz)</option>
          ${(assetTyp === "pens" || assetTyp === "vers") ? '<option value="auszahlung">Auszahlung ab Datum</option>' : ""}
        </select>
        <input type="text" inputmode="decimal" data-ak-betrag placeholder="Betrag €" style="font-size:12px;padding:5px 7px">
        <input type="date" data-ak-start style="font-size:12px;padding:5px 7px">
        <input type="date" data-ak-ende placeholder="Ende (opt.)" style="font-size:12px;padding:5px 7px">
        <button class="secondary" data-ak-save data-asset-id="${assetId}" data-asset-typ="${assetTyp}" style="font-size:12px;padding:5px 10px">✓ Speichern</button>
        <button class="secondary" data-ak-cancel data-form-id="${formId}" style="font-size:12px;padding:5px 10px">✕</button>
      </div>
    </div>
    <button class="secondary" data-ak-add data-form-id="${formId}" style="font-size:12px;padding:5px 10px;margin-top:2px">+ Aktion</button>
  </div>`;
}

const GROUPS = [
  { typ: "portfolio", icon: "📈", label: "ETF / Depot" },
  { typ: "immo",      icon: "🏠", label: "Immobilien" },
  { typ: "bank",      icon: "🏦", label: "Liquidität / Banken" },
  { typ: "bet",       icon: "💼", label: "Beteiligungen" },
  { typ: "pens",      icon: "🏛", label: "Pensionsfonds" },
  { typ: "vers",      icon: "🛡", label: "Versicherungen (Kapital)" },
];

function renderSimSzenarien() {
  const assetsEl = document.getElementById("szn-assets");
  if (!assetsEl) return;

  const horizont = Number(simSettings.horizont_jahre) || 15;
  const assets = buildSimAssets();
  const totalHeute = assets.reduce((s, a) => s + a.value, 0);

  // Projektion (3 Pfade)
  const baseS  = projectSzenarien(assets, horizont, "base");
  const pessS  = projectSzenarien(assets, horizont, "pess");
  const optimS = projectSzenarien(assets, horizont, "optim");
  const endBase = baseS[baseS.length - 1]?.total || 0;
  const endNet  = baseS[baseS.length - 1]?.netTotal || 0;
  const endReal = baseS[baseS.length - 1]?.realNetTotal || 0;
  const endTax  = baseS[baseS.length - 1]?.taxPaid || 0;
  const endCosts = baseS[baseS.length - 1]?.costsPaid || 0;
  const cagr = horizont > 0 && totalHeute > 0 ? (Math.pow(endNet / totalHeute, 1 / horizont) - 1) * 100 : 0;
  const zuwachs = endBase - totalHeute;

  // KPIs
  setText("szn-heute", euro(totalHeute));
  setText("szn-prognose", euro(endBase));
  setText("szn-netto", euro(endNet));
  setText("szn-real", euro(endReal));
  setText("szn-steuerkosten", "-" + euro(endTax + endCosts));
  setText("szn-horizont-label", String(horizont));
  const zwEl = document.getElementById("szn-zuwachs");
  if (zwEl) { zwEl.textContent = (zuwachs >= 0 ? "+" : "") + euro(zuwachs); zwEl.className = "v " + (zuwachs >= 0 ? "pos" : "neg"); }
  const cagrEl = document.getElementById("szn-cagr");
  if (cagrEl) { cagrEl.textContent = (cagr >= 0 ? "+" : "") + fmtNum(cagr, 1) + " % p.a."; cagrEl.className = "v " + (cagr >= 0 ? "pos" : "neg"); }

  // Horizont-Sidebar sync
  const hrSlider = document.getElementById("szn-horizont"); if (hrSlider && hrSlider.value != horizont) hrSlider.value = horizont;
  const hrLabel = document.getElementById("szn-horizont-label-sb"); if (hrLabel) hrLabel.textContent = horizont + " J.";
  const syncInput = (id, key, def) => { const el = document.getElementById(id); if (el && !el.matches(":focus") && simSettings[key]) el.value = fmtNum(simSettings[key]); else if (el && !el.value) el.placeholder = String(def); };
  syncInput("szn-rendite-etf",     "rendite_etf",     6.0);
  syncInput("szn-rendite-immo",    "rendite_immo",    2.0);
  syncInput("szn-rendite-liquide", "rendite_liquide", 1.5);
  syncInput("szn-inflation",       "inflation",       2.0);

  // Chart
  const showReal = document.getElementById("szn-show-real")?.checked || false;
  drawSzenarienChart(document.getElementById("szn-chart"), baseS, pessS, optimS, showReal);

  // Asset-Gruppen
  let groupsHtml = "";
  GROUPS.forEach((g) => {
    const groupAssets = assets.filter((a) => a.typ === g.typ);
    if (!groupAssets.length) return;
    const groupTotal = groupAssets.reduce((s, a) => s + a.value, 0);
    const assetCards = groupAssets.map((asset) => `
      <div class="sim-asset-card" data-asset-id="${asset.id}">
        <div class="sim-asset-hd">
          <span class="sim-asset-name">${esc(asset.name)}</span>
          <span class="sim-asset-val">${euro(asset.value)}</span>
          <span class="sim-asset-rendite">${fmtNum(asset.defaultRendite, 1)} % p.a.</span>
        </div>
        ${renderAktionenWrap(asset.id, asset.typ)}
      </div>`).join("");
    groupsHtml += `<div class="sim-group" data-group-typ="${g.typ}">
      <div class="sim-group-hd" data-group-toggle>
        <span class="sim-group-icon">${g.icon}</span>
        <span class="sim-group-name">${g.label}</span>
        <span class="sim-group-total">${euro(groupTotal)}</span>
        <span class="sim-group-chev">▾</span>
      </div>
      <div class="sim-group-body">${assetCards}</div>
    </div>`;
  });
  assetsEl.innerHTML = groupsHtml || `<div class="empty">Keine Vermögenswerte gefunden. Bitte Banken, Immobilien oder Portfolio im Finanzen-Bereich erfassen.</div>`;
}

// Szenarien Event-Handler
document.getElementById("szn-assets").addEventListener("click", async (e) => {
  // Group Toggle
  if (e.target.closest("[data-group-toggle]")) {
    e.target.closest(".sim-group").classList.toggle("collapsed"); return;
  }
  // Aktion hinzufügen (Form öffnen)
  const addBtn = e.target.closest("[data-ak-add]");
  if (addBtn) { document.getElementById(addBtn.getAttribute("data-form-id")).style.display = ""; addBtn.style.display = "none"; return; }
  // Formular abbrechen
  const cancelBtn = e.target.closest("[data-ak-cancel]");
  if (cancelBtn) { const f = document.getElementById(cancelBtn.getAttribute("data-form-id")); if (f) { f.style.display = "none"; f.closest(".sim-aktionen-wrap").querySelector("[data-ak-add]").style.display = ""; } return; }
  // Aktion speichern
  const saveBtn = e.target.closest("[data-ak-save]");
  if (saveBtn) {
    const wrap = saveBtn.closest(".sim-ak-row");
    const assetId = saveBtn.getAttribute("data-asset-id");
    const assetTyp = saveBtn.getAttribute("data-asset-typ");
    const assetName = e.target.closest(".sim-asset-card")?.querySelector(".sim-asset-name")?.textContent || "";
    const aktion_typ = wrap.querySelector("[data-ak-typ]").value;
    const betragStr  = wrap.querySelector("[data-ak-betrag]").value;
    const datum_start = wrap.querySelector("[data-ak-start]").value || null;
    const datum_ende  = wrap.querySelector("[data-ak-ende]").value || null;
    const betrag = numDE(betragStr);
    if (!datum_start && aktion_typ !== "sparplan") { alert("Bitte ein Startdatum angeben."); return; }
    const payload = { asset_typ: assetTyp, asset_ref_id: assetId, asset_name: assetName, aktion_typ, betrag: betrag || null, datum_start, datum_ende: datum_ende || null };
    const { error } = await sb.from("sim_aktionen").insert([payload]);
    if (error) { alert("Fehler: " + error.message); return; }
    loadSim(); return;
  }
  // Aktion löschen
  const delBtn = e.target.closest("[data-ak-del]");
  if (delBtn) {
    const { error } = await sb.from("sim_aktionen").delete().eq("id", delBtn.getAttribute("data-ak-del"));
    if (error) alert("Fehler: " + error.message); else loadSim(); return;
  }
});

// Szenarien Sidebar Resize + Collapse
const _sznDiv = document.getElementById("szn-divider");
const _sznSb  = document.getElementById("szn-sidebar");
const _sznColBtn = document.getElementById("szn-collapse-btn");
_sznDiv.addEventListener("mousedown", (e) => {
  if (e.target.closest(".sim-collapse-btn")) return;
  e.preventDefault();
  const startX = e.clientX, startW = sznSidebarW;
  const onMove = (ev) => { const w = Math.max(220, Math.min(600, startW + (startX - ev.clientX))); sznSidebarW = w; if (!sznSidebarCollapsed) _sznSb.style.width = w + "px"; };
  const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
  document.addEventListener("mousemove", onMove); document.addEventListener("mouseup", onUp);
});
_sznColBtn.addEventListener("click", () => {
  sznSidebarCollapsed = !sznSidebarCollapsed;
  _sznSb.style.transition = "width .15s ease";
  _sznSb.classList.toggle("collapsed", sznSidebarCollapsed);
  if (!sznSidebarCollapsed) _sznSb.style.width = sznSidebarW + "px";
  _sznColBtn.textContent = sznSidebarCollapsed ? "◀" : "▶";
  setTimeout(() => { _sznSb.style.transition = ""; }, 200);
});

// Szenarien Annahmen-Inputs
function sznSave(key, val) { simSettings[key] = val; debounceSaveSim(); renderSimSzenarien(); }
document.getElementById("szn-horizont").addEventListener("input", (e) => { sznSave("horizont_jahre", Number(e.target.value)); });
document.getElementById("szn-rendite-etf").addEventListener("change", (e) => { sznSave("rendite_etf", numDE(e.target.value) || 6); });
document.getElementById("szn-rendite-immo").addEventListener("change", (e) => { sznSave("rendite_immo", numDE(e.target.value) || 2); });
document.getElementById("szn-rendite-liquide").addEventListener("change", (e) => { sznSave("rendite_liquide", numDE(e.target.value) || 1.5); });
document.getElementById("szn-inflation").addEventListener("change", (e) => { sznSave("inflation", numDE(e.target.value) || 2); });

// Annahmen-Profile
const SIM_PROFILE = {
  konservativ:  { rendite_etf: 4.0, rendite_immo: 1.0, rendite_liquide: 1.0, inflation: 2.5 },
  mittel:       { rendite_etf: 6.0, rendite_immo: 2.0, rendite_liquide: 1.5, inflation: 2.0 },
  optimistisch: { rendite_etf: 8.0, rendite_immo: 3.0, rendite_liquide: 2.5, inflation: 1.5 },
};

document.getElementById("szn-sidebar").addEventListener("click", (e) => {
  const btn = e.target.closest(".szn-profil-btn");
  if (!btn) return;
  const p = SIM_PROFILE[btn.getAttribute("data-profil")];
  if (!p) return;
  Object.assign(simSettings, p);
  const sync = (id, val) => { const el = document.getElementById(id); if (el) el.value = fmtNum(val); };
  sync("szn-rendite-etf",     p.rendite_etf);
  sync("szn-rendite-immo",    p.rendite_immo);
  sync("szn-rendite-liquide", p.rendite_liquide);
  sync("szn-inflation",       p.inflation);
  debounceSaveSim();
  renderSimSzenarien();
});

// Real-Toggle
document.getElementById("szn-show-real")?.addEventListener("change", () => renderSimSzenarien());

// Sidebar Inputs
document.getElementById("sim-horizont").addEventListener("input", (e) => {
  simSettings.horizont_monate = Number(e.target.value);
  document.getElementById("sim-horizont-label").textContent = simSettings.horizont_monate + " Mon.";
  renderSim(); debounceSaveSim();
});
document.getElementById("sim-puffer").addEventListener("change", (e) => {
  simSettings.mindest_puffer = numDE(e.target.value) || 0;
  renderSim(); debounceSaveSim();
});

// Einmal-Ereignisse
document.getElementById("sim-event-add").addEventListener("click", () => {
  simEvents.push({ id: crypto.randomUUID(), label: "", betrag: null, monat: isoDate(new Date()).slice(0, 7) });
  renderSim(); debounceSaveSim();
});
document.getElementById("sim-events-list").addEventListener("click", (e) => {
  const delBtn = e.target.closest("[data-sim-ev-del]");
  if (delBtn) {
    simEvents.splice(Number(delBtn.getAttribute("data-sim-ev-del")), 1);
    renderSim(); debounceSaveSim();
  }
});
document.getElementById("sim-events-list").addEventListener("change", (e) => {
  const row = e.target.closest("[data-evtidx]");
  if (!row) return;
  const idx = Number(row.getAttribute("data-evtidx"));
  const ev = simEvents[idx]; if (!ev) return;
  if (e.target.classList.contains("sim-ev-label"))  ev.label  = e.target.value;
  if (e.target.classList.contains("sim-ev-betrag")) ev.betrag = numDE(e.target.value);
  if (e.target.classList.contains("sim-ev-monat"))  ev.monat  = e.target.value;
  renderSim(); debounceSaveSim();
});

// ======================================================================
//  Steuern
// ======================================================================
let steuerSettings = {};
function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

// IRPEF-Stufen 2026: 23% bis 28.000, 33% bis 50.000, 43% darüber
function irpef(income) {
  const i = Math.max(0, Number(income) || 0);
  let t = Math.min(i, 28000) * 0.23;
  if (i > 28000) t += (Math.min(i, 50000) - 28000) * 0.33;
  if (i > 50000) t += (i - 50000) * 0.43;
  return t;
}
function renderIRPEFGrafik(einkommen, addizR, addizK) {
  const el = document.getElementById("ste-stufengrafik");
  if (!el) return;
  const i = Math.max(0, einkommen);
  if (i === 0) { el.innerHTML = `<div style="color:var(--muted);font-size:13px">Kein Einkommen erfasst.</div>`; return; }

  // Stufenanteile
  const s1 = Math.min(i, 28000);
  const s2 = i > 28000 ? Math.min(i, 50000) - 28000 : 0;
  const s3 = i > 50000 ? i - 50000 : 0;
  const luft = i < 50000 ? (i < 28000 ? 28000 - i : 50000 - i) : 0;
  const grenze = Math.max(i * 1.1, 50000);  // Skala: mindestens 50k, sonst 110% des Einkommens

  const pct = (v) => (v / grenze * 100).toFixed(1) + "%";
  const colors = { s1: "#4e8ef7", s2: "#f59e0b", s3: "#ef4444", luft: "var(--border)", rest: "var(--panel2)" };

  const grenzSatz = i <= 28000 ? 23 : i <= 50000 ? 33 : 43;
  const avgSatz   = i > 0 ? ((irpef(i) + i * (addizR + addizK)) / i * 100) : 0;

  el.innerHTML = `
    <div style="font-size:12px;color:var(--muted);margin-bottom:4px">
      0 € <span style="float:right">${euro(Math.min(i, 50000))}</span>
    </div>
    <div style="display:flex;height:28px;border-radius:6px;overflow:hidden;background:var(--panel2)">
      ${s1 > 0 ? `<div style="width:${pct(s1)};background:${colors.s1};display:flex;align-items:center;justify-content:center;font-size:11px;color:#fff;font-weight:600" title="23 % auf ${euro(s1)}">23 %</div>` : ""}
      ${s2 > 0 ? `<div style="width:${pct(s2)};background:${colors.s2};display:flex;align-items:center;justify-content:center;font-size:11px;color:#fff;font-weight:600" title="33 % auf ${euro(s2)}">33 %</div>` : ""}
      ${s3 > 0 ? `<div style="width:${pct(s3)};background:${colors.s3};display:flex;align-items:center;justify-content:center;font-size:11px;color:#fff;font-weight:600" title="43 % auf ${euro(s3)}">43 %</div>` : ""}
      ${luft > 0 ? `<div style="width:${pct(luft)};opacity:0.3" title="Luft bis nächste Stufe: ${euro(luft)}"></div>` : ""}
    </div>
    <div style="font-size:12px;margin-top:6px;display:flex;gap:16px;flex-wrap:wrap">
      <span style="color:${colors.s1}">■ 23 % (bis 28.000 €)</span>
      <span style="color:${colors.s2}">■ 33 % (28–50.000 €)</span>
      <span style="color:${colors.s3}">■ 43 % (über 50.000 €)</span>
    </div>`;

  const si = document.getElementById("ste-satz-info");
  if (si) {
    const luftText = i < 28000 ? ` · Luft bis 33%-Stufe: ${euro(28000 - i)}`
      : i < 50000 ? ` · Luft bis 43%-Stufe: ${euro(50000 - i)}` : "";
    si.textContent = `Grenzsteuersatz: ${grenzSatz} %   ·   Ø-Satz (inkl. Addiz.): ${fmtNum(avgSatz, 1)} %${luftText}`;
  }
}

// Einkommens-Transaktionen (ist_einkommen=true) laufendes Jahr — präzise Ist-Berechnung
function incomeYearTagged() {
  const yearStart = new Date().getFullYear() + "-01-01";
  let brutto = 0, ritenuteSum = 0;
  allRows.forEach((r) => {
    if (!r.ist_einkommen || !r.buchungsdatum || r.buchungsdatum < yearStart) return;
    const netto = Number(r.haben) || 0;
    const rit   = Number(r.ritenuta) || 0;
    brutto += r.betrag_brutto ? netto : netto + rit;
    ritenuteSum += rit;
  });
  return { brutto, ritenuteSum, hasData: brutto > 0 };
}

function renderSteuerKopf(incomeTax, rentTax, imuTotal, kapLaufend, bolloDepot, bolloKonten, pensTax, ivafivie, addizR, addizK) {
  // IST-Seite
  const tagged = incomeYearTagged();
  const cta = document.getElementById("st-ist-cta");
  if (tagged.hasData) {
    const istSteuer = irpef(tagged.brutto) + tagged.brutto * (addizR + addizK);
    const istOffen  = Math.max(0, istSteuer - tagged.ritenuteSum);
    setText("st-kopf-ist-steuer", euro(istSteuer));
    setText("st-kopf-ist-einkommen", euro(tagged.brutto));
    setText("st-kopf-ist-bezahlt", euro(tagged.ritenuteSum));
    setText("st-kopf-ist-offen", euro(istOffen));
    if (cta) cta.style.display = "none";
  } else {
    setText("st-kopf-ist-steuer", "–");
    setText("st-kopf-ist-einkommen", "–");
    setText("st-kopf-ist-bezahlt", "–");
    setText("st-kopf-ist-offen", "–");
    if (cta) cta.style.display = "";
  }

  // PLAN-Seite: Jahreseinkommen aus manuellem Override oder Hochrechnung aus workIncomeYear()
  const now = new Date();
  const ytdMonths = now.getMonth() + 1;  // 1–12
  const workInc = workIncomeYear();
  const planEink = steuerSettings.zu_versteuerndes_einkommen != null
    ? Number(steuerSettings.zu_versteuerndes_einkommen)
    : (ytdMonths > 0 ? workInc / ytdMonths * 12 : workInc);
  const planIRPEF   = irpef(planEink) + planEink * (addizR + addizK);
  const planKapital = kapLaufend + bolloDepot + bolloKonten + pensTax + ivafivie;
  const planImmo    = rentTax + imuTotal;
  const planTotal   = planIRPEF + planKapital + planImmo;
  const voraus      = Number(steuerSettings.vorauszahlung) || 0;
  const planRest    = planTotal - voraus;

  setText("st-kopf-plan-total", euro(planTotal));
  setText("st-kopf-voraus", euro(voraus));
  const restEl = document.getElementById("st-kopf-plan-rest");
  if (restEl) { restEl.textContent = euro(Math.abs(planRest)); restEl.style.color = planRest > 0 ? "var(--neg)" : "var(--pos)"; }

  const bd = document.getElementById("st-kopf-plan-breakdown");
  if (bd) {
    bd.innerHTML = [
      ["Einkommen (IRPEF + Addiz.)", planIRPEF],
      ["Kapital + Bollo + Pensions-Ertrag", planKapital],
      ["Immobilien (Miete + IMU)", planImmo],
    ].map(([label, v]) => `<div style="display:flex;justify-content:space-between"><span style="color:var(--muted)">${label}</span><span class="neg">${euro(v)}</span></div>`).join("");
  }
}

// Arbeitseinkommen der letzten 12 Monate (Transaktions-Einnahmen ohne Immobilien-Zuordnung)
function workIncomeYear() {
  const now = new Date();
  const cmKey = isoMonth(now);
  const sD = new Date(now.getFullYear(), now.getMonth() - 12, 1);
  const sKey = isoMonth(sD);
  let v = 0;
  allRows.forEach((r) => {
    if (r.umbuchung || r.immo_id || !r.buchungsdatum || !bankSelected(r.bank || "")) return;
    const m = String(r.buchungsdatum).slice(0, 7);
    if (m < sKey || m >= cmKey) return;
    v += (Number(r.haben) || 0) * userShare(r.bank || "");
  });
  return v;
}

async function loadSteuer() {
  const { data, error } = await sb.from("steuer_einstellungen").select("*").limit(1);
  steuerSettings = (!error && data && data[0]) ? data[0] : {};
  const g = document.getElementById("set-grenz"); if (g) g.value = steuerSettings.grenzsteuersatz != null ? fmtNum(steuerSettings.grenzsteuersatz) : "23";
  const vz = document.getElementById("set-voraus"); if (vz) vz.value = steuerSettings.vorauszahlung != null ? fmtNum(steuerSettings.vorauszahlung) : "";
  const je = document.getElementById("set-jahreseink"); if (je) je.value = steuerSettings.zu_versteuerndes_einkommen != null ? fmtNum(steuerSettings.zu_versteuerndes_einkommen) : "";
  const ar = document.getElementById("set-addiz-reg"); if (ar) ar.value = fmtNum(steuerSettings.addizionale_regionale ?? 1.23);
  const ak = document.getElementById("set-addiz-kom"); if (ak) ak.value = fmtNum(steuerSettings.addizionale_comunale ?? 0.8);
  renderSteuern();
}

function renderSteuern() {
  if (!document.getElementById("st-total")) return;
  const grenz = Number(steuerSettings && steuerSettings.grenzsteuersatz) || 23;
  const grenzF = grenz / 100;
  const n = (v) => Number(v) || 0;

  // Addizionale-Sätze (regional + kommunal)
  const addizR = (steuerSettings.addizionale_regionale ?? 1.23) / 100;
  const addizK = (steuerSettings.addizionale_comunale ?? 0.8) / 100;

  // Einkommensteuer (IRPEF + Addizionale)
  const workInc = workIncomeYear();
  const incomeTax = irpef(workInc) + workInc * (addizR + addizK);

  // Mieteinnahmen + IMU
  let rentTax = 0, imuTotal = 0;
  immoRows.forEach((d) => {
    const k = immoKPIs(d); const sh = (n(d.anteil_user) || 100) / 100;
    rentTax += (k.steuerM || 0) * 12 * sh;
    imuTotal += (k.imuM || 0) * 12 * sh;
  });

  // Kapitalerträge laufend (Beteiligungen)
  let zinsTaxSum = 0, divTaxSum = 0;
  betRows.forEach((d) => {
    zinsTaxSum += n(d.darlehen) * n(d.zins) / 100 * KEST;
    divTaxSum += d.dividende_netto ? 0 : n(d.dividende_jahr) * KEST;
  });
  const kapLaufend = zinsTaxSum + divTaxSum;

  // Latente Steuer (ETF + Beteiligungen Buchgewinne)
  let etfGain = 0;
  const latest = latestPortfolioMap(portfolioRows);
  Object.values(latest).forEach((r) => { const g = (n(r.wert) - n(r.investiert)) * userShare(r.bank); if (g > 0) etfGain += g; });
  let betGain = 0;
  betRows.forEach((d) => { const g = n(d.marktwert) - n(d.invest_hist); if (g > 0) betGain += g; });
  const latent = KEST * (etfGain + betGain);

  // Bollo Depot: 0,20 % auf aktuellen Depotwert
  let totalDepotWert = 0;
  Object.values(latest).forEach((r) => { totalDepotWert += n(r.wert) * userShare(r.bank); });
  const bolloDepot = totalDepotWert * 0.002;

  // Absetzbare Beiträge
  let totalContrib = 0;
  pensRows.forEach((d) => { totalContrib += (n(d.eigenbeitrag) + n(d.agbeitrag)) * 12; });
  const absetzbar = Math.min(totalContrib, 5164.57);
  const vorteil = absetzbar * grenzF;

  // W2.2: Bollo Konten — 34,20 € je Bank mit Saldo > 5.000 €
  let bolloKonten = 0;
  banks.forEach((b) => {
    const tx = allRows.filter((r) => (r.bank || "") === b.name);
    const txSum = tx.reduce((s, r) => s + (Number(r.soll) || 0) + (Number(r.haben) || 0), 0);
    const computed = (Number(b.saldo_start) || 0) + txSum;
    if (computed > 5000) bolloKonten += 34.20;
  });

  // W2.3: Cedolare-Anteil (informational, bereits in rentTax enthalten)
  let cedolareTax = 0;
  immoRows.forEach((d) => {
    const k = immoKPIs(d); const sh = (n(d.anteil_user) || 100) / 100;
    if (d.steuermodell === "cedolare" || d.steuermodell === "cedolare_concordato") cedolareTax += (k.steuerM || 0) * 12 * sh;
  });

  // W2.4: Pensionsfonds-Ertragsbesteuerung — 20 % auf lfd. Rendite
  let pensTax = 0;
  pensRows.forEach((d) => { pensTax += pensCurrentWert(d.id) * (n(d.rendite) / 100) * 0.20; });

  // W2.5: IVAFE (0,20 % Auslandsdepots/-konten) + IVIE (0,76 % Auslandsimmobilien)
  let ivafe = 0, ivie = 0;
  banks.forEach((b) => {
    if (!b.im_ausland) return;
    if (b.hat_portfolio) {
      const latestB = latestPortfolioMap(portfolioRows, (bank) => bank === b.name);
      let wert = 0; Object.values(latestB).forEach((r) => { wert += Number(r.wert) || 0; });
      ivafe += wert * 0.002;
    } else {
      const tx = allRows.filter((r) => (r.bank || "") === b.name);
      const txSum = tx.reduce((s, r) => s + (Number(r.soll) || 0) + (Number(r.haben) || 0), 0);
      const balance = (Number(b.saldo_start) || 0) + txSum;
      if (balance > 0) ivafe += balance * 0.002;
    }
  });
  immoRows.forEach((d) => {
    if (!d.im_ausland) return;
    ivie += n(d.marktwert) * ((n(d.anteil_user) || 100) / 100) * 0.0106;
  });

  // Summen
  const laufend = incomeTax + rentTax + imuTotal + kapLaufend + bolloDepot + bolloKonten + pensTax + ivafe + ivie;
  const voraus = n(steuerSettings && steuerSettings.vorauszahlung);
  const diff = laufend - voraus;

  // Kopfblock (Ist/Plan)
  renderSteuerKopf(incomeTax, rentTax, imuTotal, kapLaufend, bolloDepot, bolloKonten, pensTax, ivafe + ivie, addizR, addizK);

  // Übersicht
  setText("st-total", euro(laufend));
  setText("st-einkommen", euro(incomeTax));
  setText("st-miete", euro(rentTax));
  setText("st-imu", euro(imuTotal));
  setText("st-kapital", euro(kapLaufend));
  setText("st-bollo-depot", euro(bolloDepot));
  setText("st-bollo-konten", euro(bolloKonten));
  setText("st-cedolare", euro(cedolareTax));
  setText("st-pens-ertrag", euro(pensTax));
  setText("st-latent", euro(latent));
  setText("st-vorteil", euro(vorteil));
  const diffEl = document.getElementById("st-diff");
  if (diffEl) { diffEl.textContent = (diff >= 0 ? "Nachzahlung " : "Guthaben ") + euro(Math.abs(diff)); diffEl.className = "v " + (diff > 0 ? "neg" : "pos"); }
  const auslandRow = document.getElementById("st-row-ausland");
  if (auslandRow) {
    auslandRow.style.display = (ivafe > 0 || ivie > 0) ? "" : "none";
    setText("st-ivafe", euro(ivafe));
    setText("st-ivie", euro(ivie));
  }
  renderStBreakdown([
    { name: "Einkommensteuer + Addiz.", v: incomeTax },
    { name: "Mieteinnahmen (IRPEF)", v: rentTax - cedolareTax },
    { name: "Cedolare Secca", v: cedolareTax },
    { name: "IMU", v: imuTotal },
    { name: "Kapitalerträge", v: kapLaufend },
    { name: "Bollo Depot", v: bolloDepot },
    { name: "Bollo Konten", v: bolloKonten },
    { name: "Pensionsfonds-Ertrag", v: pensTax },
    { name: "IVAFE/IVIE", v: ivafe + ivie },
  ]);

  // Einkommen-Seite
  renderIRPEFGrafik(workInc, addizR, addizK);
  setText("ste-income", euro(workInc));
  setText("ste-tax", euro(incomeTax));
  setText("ste-rate", workInc > 0 ? pctDE(incomeTax / workInc * 100) : "–");
  setText("ste-net", euro(workInc - incomeTax));
  const eb = document.getElementById("ste-body");
  if (eb) {
    const i = Math.max(0, workInc);
    const b1 = Math.min(i, 28000), b2 = i > 28000 ? Math.min(i, 50000) - 28000 : 0, b3 = i > 50000 ? i - 50000 : 0;
    const addizTotal = i * (addizR + addizK);
    eb.innerHTML = [["bis 28.000 €", b1, 23], ["28.000–50.000 €", b2, 33], ["über 50.000 €", b3, 43]]
      .map((r) => `<tr><td>${r[0]}</td><td class="num">${euro(r[1])}</td><td class="num">${r[2]} %</td><td class="num neg">${euro(r[1] * r[2] / 100)}</td></tr>`).join("")
      + `<tr style="border-top:1px solid var(--border);color:var(--muted)"><td>Addizionale reg. + kom.</td><td class="num">${euro(i)}</td><td class="num">${fmtNum((addizR + addizK) * 100, 2)} %</td><td class="num neg">${euro(addizTotal)}</td></tr>`;
  }

  // Mieteinnahmen-Seite
  const mb = document.getElementById("stm-body");
  if (mb) {
    const rows = immoRows.filter((d) => d.typ === "vermietung");
    mb.innerHTML = rows.length === 0 ? `<tr><td colspan="5" class="empty">Keine vermieteten Immobilien.</td></tr>`
      : rows.map((d) => { const k = immoKPIs(d); const sh = (n(d.anteil_user) || 100) / 100; const modell = { cedolare: "Cedolare 21 %", cedolare_concordato: "Cedolare 10 %", irpef: "IRPEF", keine: "Keine" }[d.steuermodell || "cedolare"]; return `<tr><td>${esc(d.bezeichnung || "")}</td><td>${modell}</td><td class="num">${euro(n(d.bruttomiete) * 12 * sh)}</td><td class="num neg">${euro((k.steuerM || 0) * 12 * sh)}</td><td class="num neg">${euro((k.imuM || 0) * 12 * sh)}</td></tr>`; }).join("");
  }

  // Kapitalerträge-Seite
  const kb = document.getElementById("stk-body");
  if (kb) {
    const rows = betRows;
    kb.innerHTML = rows.length === 0 ? `<tr><td colspan="4" class="empty">Keine Beteiligungen.</td></tr>`
      : rows.map((d) => { const zb = n(d.darlehen) * n(d.zins) / 100; const db = n(d.dividende_jahr); const tax = zb * KEST + (d.dividende_netto ? 0 : db * KEST); return `<tr><td>${esc(d.name || "")}</td><td class="num">${euro(zb)}</td><td class="num">${euro(db)}</td><td class="num neg">${euro(tax)}</td></tr>`; }).join("");
  }
  setText("stk-etf-gain", euro(etfGain));
  setText("stk-bet-gain", euro(betGain));
  setText("stk-latent", euro(latent));

  // Absetzbares-Seite
  setText("sta-beitrag", euro(totalContrib));
  setText("sta-absetzbar", euro(absetzbar));
  setText("sta-satz", pctDE(grenz));
  setText("sta-vorteil", euro(vorteil));
  const ab = document.getElementById("sta-body");
  if (ab) {
    const rows = pensRows;
    ab.innerHTML = rows.length === 0 ? `<tr><td colspan="2" class="empty">Keine Pensionsfonds.</td></tr>`
      : rows.map((d) => `<tr><td>${esc(d.name || "")}</td><td class="num">${euro((n(d.eigenbeitrag) + n(d.agbeitrag)) * 12)}</td></tr>`).join("");
  }
}

function renderStBreakdown(arr) {
  const el = document.getElementById("st-breakdown");
  if (!el) return;
  const items = arr.filter((a) => a.v > 0).sort((a, b) => b.v - a.v);
  if (items.length === 0) { el.innerHTML = `<div class="empty">Keine laufende Steuerlast.</div>`; return; }
  const max = Math.max(...items.map((a) => a.v));
  el.innerHTML = items.map((a) => `<div class="hbar"><span class="hbar-label">${esc(a.name)}</span><span class="hbar-track"><span class="hbar-fill" style="width:${(a.v / max * 100).toFixed(1)}%"></span></span><span class="hbar-val neg">${euro(a.v)}</span></div>`).join("");
}

document.getElementById("set-save").addEventListener("click", async () => {
  const grenz  = numDE(document.getElementById("set-grenz").value);
  const voraus = numDE(document.getElementById("set-voraus").value);
  const jahreseink = numDE(document.getElementById("set-jahreseink").value);
  const addizReg = numDE(document.getElementById("set-addiz-reg").value);
  const addizKom = numDE(document.getElementById("set-addiz-kom").value);
  const msg = document.getElementById("set-msg");
  const payload = {
    grenzsteuersatz: grenz,
    vorauszahlung: voraus,
    zu_versteuerndes_einkommen: jahreseink != null && !isNaN(jahreseink) ? jahreseink : null,
    addizionale_regionale: addizReg != null && !isNaN(addizReg) ? addizReg : 1.23,
    addizionale_comunale:  addizKom != null && !isNaN(addizKom) ? addizKom : 0.8,
  };
  let error;
  if (steuerSettings && steuerSettings.id) ({ error } = await sb.from("steuer_einstellungen").update(payload).eq("id", steuerSettings.id));
  else ({ error } = await sb.from("steuer_einstellungen").insert([payload]));
  if (error) { msg.textContent = "Fehler: " + error.message; msg.style.color = "var(--red)"; return; }
  msg.textContent = "Gespeichert."; msg.style.color = "var(--green)";
  loadSteuer();
});

// ======================================================================
//  CSV-Vorlage herunterladen
// ======================================================================
document.getElementById("csv-template-btn").addEventListener("click", () => {
  const csv = "﻿" + [
    "Buchungsdatum;Beschreibung;Soll Euro;Haben Euro;Kategorie;Bank;Immobilie",
    "01.01.26;Beispiel Ausgabe;-50,00 €;0;Lebensmittel;Volksbank;",
    "01.01.26;Beispiel Einnahme;0;2500,00 €;Gehalt;Sparkasse;",
    "01.01.26;Mieteinnahme;0;800,00 €;Miete;Raiffeisenkasse;Wohnung Verona",
  ].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "Transaktionen-Vorlage.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

// ======================================================================
//  CSV-Import
// ======================================================================
document.getElementById("csv-import-btn").addEventListener("click", (ev) => {
  const fileInput = document.getElementById("csv-file");
  const msg = document.getElementById("csv-msg");
  const file = fileInput.files[0];
  if (!file) { showMsg(msg, "Bitte zuerst eine CSV-Datei auswählen.", "error"); return; }
  ev.target.disabled = true;

  Papa.parse(file, {
    header: true, delimiter: ";", skipEmptyLines: true,
    complete: async (results) => {
      const rows = results.data.map((row) => {
        // Spaltennamen tolerant finden (Groß/Klein, Leerzeichen)
        const get = (name) => {
          const key = Object.keys(row).find((k) => k.trim().toLowerCase() === name.toLowerCase());
          return key ? row[key] : "";
        };
        const immoName = (get("Immobilie") || "").trim();
        const immo = immoName ? immoRows.find((d) => (d.bezeichnung || "").trim().toLowerCase() === immoName.toLowerCase()) : null;
        return {
          buchungsdatum: parseDate(get("Buchungsdatum")),
          beschreibung: (get("Beschreibung") || "").trim() || null,
          soll: parseAmount(get("Soll Euro")),
          haben: parseAmount(get("Haben Euro")),
          kategorie: (get("Kategorie") || "").trim() || null,
          bank: (get("Bank") || "").trim() || null,
          immo_id: immo ? immo.id : null,
        };
      }).filter((r) => r.beschreibung || r.buchungsdatum || r.soll != null || r.haben != null);

      if (activeTxBank) rows.forEach((r) => { r.bank = activeTxBank; });  // Import gilt für die gewählte Bank
      rows.forEach((r) => { r.bank_id = bankIdByName(r.bank); });
      if (document.getElementById("csv-kk").checked) rows.forEach((r) => { r.kreditkarte = true; });

      if (rows.length === 0) { showMsg(msg, "Keine gültigen Zeilen gefunden. Prüfe die Spaltenüberschriften.", "error"); return; }

      showMsg(msg, `Importiere ${rows.length} Zeilen…`, "ok");
      const { error } = await sb.from("transactions").insert(rows);
      ev.target.disabled = false;
      if (error) { showMsg(msg, "Fehler beim Import: " + error.message, "error"); return; }
      showMsg(msg, `${rows.length} Zeilen erfolgreich importiert.`, "ok");
      fileInput.value = "";
      loadData();
    },
    error: (err) => { ev.target.disabled = false; showMsg(msg, "CSV konnte nicht gelesen werden: " + err.message, "error"); },
  });
});
