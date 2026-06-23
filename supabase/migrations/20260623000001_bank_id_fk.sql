-- C17: bank_id als FK in transactions und portfolio.
-- bank-Textspalte bleibt erhalten (display + filter bleiben unverändert).
-- bank_id wird für neue Einträge geschrieben; Rename-Kaskade läuft im JS-Client.
-- ON DELETE SET NULL: Bank-Löschung orphaned nicht die Transaktionen, setzt bank_id nur auf NULL.

alter table public.transactions
  add column bank_id uuid references public.banks(id) on delete set null;

alter table public.portfolio
  add column bank_id uuid references public.banks(id) on delete set null;

-- Bestehende Zeilen mit bank_id befüllen (Name-Match innerhalb desselben Users)
update public.transactions t
  set bank_id = b.id
  from public.banks b
  where b.name = t.bank
    and b.user_id = t.user_id;

update public.portfolio p
  set bank_id = b.id
  from public.banks b
  where b.name = p.bank
    and b.user_id = p.user_id;

-- Indizes für FK-Lookups
create index if not exists transactions_bank_id_idx on public.transactions(bank_id);
create index if not exists portfolio_bank_id_idx    on public.portfolio(bank_id);
