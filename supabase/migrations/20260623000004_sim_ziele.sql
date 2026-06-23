-- Simulation V2: Finanzielle Ziele (Baustein B)
-- Vorwärts- und Rückwärtsrechnung: Zieldatum/Sparrate/Rendite.
-- typ 'freiheit' = FIRE: Zielbetrag auto aus monatlicher Lücke / Rendite.

create table public.sim_ziele (
  id               uuid default gen_random_uuid() primary key,
  user_id          uuid not null default auth.uid() references auth.users(id),
  bezeichnung      text,
  typ              text default 'sparziel',  -- 'sparziel'|'notgroschen'|'ruhestand'|'freiheit'
  zielbetrag       numeric,
  zieldatum        date,
  startkapital     numeric,
  sparrate         numeric,
  rendite_override numeric,                  -- % p.a.; null = Typ-Default
  prioritaet       int default 1,
  notiz            text,
  created_at       timestamptz default now()
);

alter table public.sim_ziele enable row level security;
create policy "Users manage own sim_ziele"
  on public.sim_ziele for all using (auth.uid() = user_id);
