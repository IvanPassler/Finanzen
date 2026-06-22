-- steuer_einstellungen: Addizionale-Zuschläge + planbares Jahreseinkommen.
-- Keine neuen RLS-Policies nötig; bestehende Policies (auth.uid() = user_id)
-- decken neue Spalten automatisch ab.
-- ALTER TABLE ADD COLUMN mit DEFAULT ist in PG 17 non-blocking.

alter table public.steuer_einstellungen
  add column zu_versteuerndes_einkommen numeric,
  add column addizionale_regionale       numeric default 1.23,
  add column addizionale_comunale        numeric default 0.8;
