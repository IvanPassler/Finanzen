-- Versicherungen: Haupttabelle + Wert-Verlauf (analog pensionsfonds / pension_stand)
-- art='kapital' → Rückkaufswert fließt ins Nettovermögen
-- art='risiko'  → Prämie als Kosten, keine Vermögenswirkung

create table public.versicherungen (
  id               uuid default gen_random_uuid() primary key,
  user_id          uuid default auth.uid() not null references auth.users(id),
  bezeichnung      text,
  gesellschaft     text,
  art              text not null default 'risiko',   -- 'kapital' | 'risiko'
  kategorie        text,                              -- siehe KATEGORIE_TOPF im JS
  praemie          numeric,
  zahlweise        text default 'jaehrlich',          -- 'monatlich' | 'vierteljaehrlich' | 'jaehrlich' | 'einmalig'
  vertragsstart    date,
  ablauf           date,                              -- null = unbefristet
  versicherungssumme numeric,
  rueckkaufswert   numeric,                           -- Startwert / letzter bekannter Wert (ergänzt durch versicherung_stand)
  beguenstigter    text,
  absetzbar        boolean default true,
  bindung          text,
  notiz            text,
  immo_id          uuid references public.immobilien(id) on delete set null,
  created_at       timestamp with time zone default now()
);

create table public.versicherung_stand (
  id        uuid default gen_random_uuid() primary key,
  user_id   uuid default auth.uid() not null references auth.users(id),
  vers_id   uuid not null references public.versicherungen(id) on delete cascade,
  datum     date not null,
  wert      numeric not null,
  created_at timestamp with time zone default now()
);

alter table public.versicherungen    enable row level security;
alter table public.versicherung_stand enable row level security;

create policy "Users manage own versicherungen"
  on public.versicherungen for all using (auth.uid() = user_id);

create policy "Users manage own versicherung_stand"
  on public.versicherung_stand for all using (auth.uid() = user_id);
