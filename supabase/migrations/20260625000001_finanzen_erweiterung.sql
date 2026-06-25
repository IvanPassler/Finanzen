-- Finanzen-Erweiterung (Juni 2026)
-- Alle neuen Tabellen und Spalten für den erweiterten Finanzen-Bereich.
-- Idempotent dank IF NOT EXISTS bei Tabellen und ADD COLUMN IF NOT EXISTS.

-- 2.2 Bank: eigener Anteil (explizit, einfacher als eigentuemer-JSON)
alter table public.banks
  add column if not exists anteil_user numeric default 100;

-- 3 ETF & Aktien: Wertpapier-Typ je Position
alter table public.portfolio
  add column if not exists wertpapier_typ text default 'etf';

-- 4.1 Immobilien-Tilgungsplan (ursprünglicher Darlehensbetrag + Tilgungsbeginn)
alter table public.immobilien
  add column if not exists darlehen_start numeric,
  add column if not exists tilgung_start date;

-- Transaktions-Erweiterungen:
--   kategorie_id  → zweistufige Kategorien (FK auf kategorien)
--   einkommen_id  → Verknüpfung zur Einkommensquelle
--   steuerstatus  → netto/brutto/vorsteuer/steuerfrei (überschreibt einkommen.steuerstatus)
--   ist_kreditrate / tilgungsanteil / zinsanteil → für Tilgungsplan
alter table public.transactions
  add column if not exists kategorie_id     uuid references public.kategorien(id) on delete set null,
  add column if not exists einkommen_id     uuid references public.einkommen(id) on delete set null,
  add column if not exists steuerstatus     text,
  add column if not exists ist_kreditrate   boolean default false,
  add column if not exists tilgungsanteil   numeric,
  add column if not exists zinsanteil       numeric;

-- 4.2 Immobilien teilen
create table if not exists public.immo_shares (
  id          uuid primary key default gen_random_uuid(),
  immo_id     uuid not null references public.immobilien(id) on delete cascade,
  owner_id    uuid not null references auth.users(id) default auth.uid(),
  shared_with uuid not null references auth.users(id),
  anteil      numeric,
  rolle       text default 'viewer',
  created_at  timestamptz default now(),
  unique (immo_id, shared_with)
);
alter table public.immo_shares enable row level security;
create policy "ish_select_own" on public.immo_shares
  for select using (auth.uid() = owner_id or auth.uid() = shared_with);
create policy "ish_insert_own" on public.immo_shares
  for insert with check (auth.uid() = owner_id);
create policy "ish_delete_own" on public.immo_shares
  for delete using (auth.uid() = owner_id);
-- Immobilien für Mitbesitzer lesbar (zusätzliche SELECT-Policy)
create policy "i_select_shared" on public.immobilien
  for select using (
    exists (select 1 from public.immo_shares s
            where s.immo_id = immobilien.id and s.shared_with = auth.uid())
  );

-- 5 Vermögensgegenstände (Gold, Fahrzeuge, Krypto, Bargeld, …)
create table if not exists public.vermoegensgegenstaende (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) default auth.uid(),
  bezeichnung  text not null,
  art          text default 'sonstige',   -- 'gold'|'edelmetall'|'fahrzeug'|'kunst'|'sammlung'|'krypto'|'bargeld'|'sonstige'
  menge        numeric,
  einheit      text,                       -- 'g'|'oz'|'Stk'|…
  kaufdatum    date,
  kaufpreis    numeric,
  marktwert    numeric,
  anteil_user  numeric default 100,
  notiz        text,
  bindung      text,
  created_at   timestamptz default now()
);
alter table public.vermoegensgegenstaende enable row level security;
create policy "vg_select_own" on public.vermoegensgegenstaende for select using (auth.uid() = user_id);
create policy "vg_insert_own" on public.vermoegensgegenstaende for insert with check (auth.uid() = user_id);
create policy "vg_update_own" on public.vermoegensgegenstaende for update using (auth.uid() = user_id);
create policy "vg_delete_own" on public.vermoegensgegenstaende for delete using (auth.uid() = user_id);

-- 2.1 Kategorien-Hierarchie (Oberkategorie → Unterkategorie, parent_id = NULL → Ober)
create table if not exists public.kategorien (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) default auth.uid(),
  name       text not null,
  parent_id  uuid references public.kategorien(id) on delete cascade,
  typ        text default 'ausgabe',   -- 'ausgabe'|'einnahme'|'einkommen'
  created_at timestamptz default now()
);
alter table public.kategorien enable row level security;
create policy "kat_select_own" on public.kategorien for select using (auth.uid() = user_id);
create policy "kat_insert_own" on public.kategorien for insert with check (auth.uid() = user_id);
create policy "kat_update_own" on public.kategorien for update using (auth.uid() = user_id);
create policy "kat_delete_own" on public.kategorien for delete using (auth.uid() = user_id);

-- 6 Einkommensquellen mit Steuer-Profil
create table if not exists public.einkommen (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) default auth.uid(),
  bezeichnung           text not null,
  art                   text not null,     -- 'arbeit'|'immobilie'|'beteiligung'|'arbeitslosengeld'|'autonomo'|'rente'|'sonstige'
  steuerstatus          text default 'brutto',
  steuermodell          text,              -- 'irpef'|'cedolare'|'kapitalertrag'|'befreit'
  steuersatz            numeric,
  quelle_immo_id        uuid references public.immobilien(id) on delete set null,
  quelle_beteiligung_id uuid references public.beteiligungen(id) on delete set null,
  notiz                 text,
  created_at            timestamptz default now()
);
alter table public.einkommen enable row level security;
create policy "ek_select_own" on public.einkommen for select using (auth.uid() = user_id);
create policy "ek_insert_own" on public.einkommen for insert with check (auth.uid() = user_id);
create policy "ek_update_own" on public.einkommen for update using (auth.uid() = user_id);
create policy "ek_delete_own" on public.einkommen for delete using (auth.uid() = user_id);

-- 7 Budgets je Kategorie
create table if not exists public.budgets (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) default auth.uid(),
  kategorie_id uuid references public.kategorien(id) on delete cascade,
  betrag       numeric not null,
  zeitraum     text default 'monat',   -- 'monat'|'jahr'
  notiz        text,
  created_at   timestamptz default now(),
  unique (user_id, kategorie_id, zeitraum)
);
alter table public.budgets enable row level security;
create policy "bg_select_own" on public.budgets for select using (auth.uid() = user_id);
create policy "bg_insert_own" on public.budgets for insert with check (auth.uid() = user_id);
create policy "bg_update_own" on public.budgets for update using (auth.uid() = user_id);
create policy "bg_delete_own" on public.budgets for delete using (auth.uid() = user_id);

-- 1 Dashboard: monatlicher Gesamtvermögens-Snapshot (für XIRR + Wertzuwachs)
create table if not exists public.vermoegen_snapshot (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) default auth.uid(),
  datum            date not null,
  wert_gesamt      numeric,
  netto_einzahlung numeric,
  created_at       timestamptz default now(),
  unique (user_id, datum)
);
alter table public.vermoegen_snapshot enable row level security;
create policy "vs_select_own" on public.vermoegen_snapshot for select using (auth.uid() = user_id);
create policy "vs_insert_own" on public.vermoegen_snapshot for insert with check (auth.uid() = user_id);
create policy "vs_update_own" on public.vermoegen_snapshot for update using (auth.uid() = user_id);
create policy "vs_delete_own" on public.vermoegen_snapshot for delete using (auth.uid() = user_id);
