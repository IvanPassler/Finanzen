-- Simulations-Einstellungen: eine Zeile pro Nutzer (upsert on user_id)
-- V1: Liquiditätsprognose-Parameter + Einmal-Ereignisse als JSONB
-- V2/V3: rendite_* und szenario-Tabellen kommen später

create table public.sim_einstellungen (
  id               uuid default gen_random_uuid() primary key,
  user_id          uuid not null default auth.uid() references auth.users(id),
  unique (user_id),
  horizont_monate  int default 24,
  mindest_puffer   numeric,
  einmal_events    jsonb default '[]'::jsonb,
  inflation        numeric default 2.0,
  rendite_etf      numeric default 6.0,
  rendite_anleihen numeric default 3.0,
  rendite_liquide  numeric default 1.5,
  created_at       timestamptz default now()
);

alter table public.sim_einstellungen enable row level security;
create policy "Users manage own sim_einstellungen"
  on public.sim_einstellungen for all using (auth.uid() = user_id);
