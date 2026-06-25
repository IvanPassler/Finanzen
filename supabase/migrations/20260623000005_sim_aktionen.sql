-- Simulation V3: Szenarien – Aktionen auf bestehenden Vermögenswerten
-- Jede Aktion zeigt was mit einem Asset in Zukunft passiert:
--   sparplan  = monatliche Zukäufe (datum_start–datum_ende, betrag/Mon)
--   einmal    = Einmalzahlung / -entnahme (positiv=Kauf, negativ=Entnahme)
--   verkauf   = Teilverkauf (betrag) oder Vollverkauf (betrag NULL = alles)
--   auszahlung = Rentenauszahlung ab datum_start (Pensions/Versicherung)
-- asset_ref_id verweist auf das echte Asset (banks.id, immobilien.id, ...)
-- Freigesetztes Kapital aus Verkäufen fließt rechnerisch in Liquidität zurück.

create table public.sim_aktionen (
  id           uuid default gen_random_uuid() primary key,
  user_id      uuid not null default auth.uid() references auth.users(id),
  asset_typ    text not null,   -- 'portfolio'|'immo'|'bank'|'bet'|'pens'|'vers'
  asset_ref_id uuid not null,   -- ID des echten Assets
  asset_name   text,            -- Denormalisierter Name (für Anzeige auch nach Asset-Umbenennung)
  aktion_typ   text not null,   -- 'sparplan'|'einmal'|'verkauf'|'auszahlung'
  betrag       numeric,         -- €/Mon (sparplan) oder Einmalbetrag; NULL bei Vollverkauf
  datum_start  date,
  datum_ende   date,            -- nur bei sparplan/auszahlung
  notiz        text,
  created_at   timestamptz default now()
);

alter table public.sim_aktionen enable row level security;
create policy "Users manage own sim_aktionen"
  on public.sim_aktionen for all using (auth.uid() = user_id);

-- Horizont + Immo-Rendite zu sim_einstellungen ergänzen
alter table public.sim_einstellungen
  add column if not exists horizont_jahre int default 15,
  add column if not exists rendite_immo   numeric default 2.0;
