-- transactions: Einkommens-Klassifizierung für präzise IRPEF-Ist-Berechnung.
-- Bestehende Zeilen behalten default-Werte (ist_einkommen = false, rest null).
-- workIncomeYear() bleibt unverändert; neue Funktion incomeYearTagged() nutzt
-- diese Felder. Keine neuen RLS-Policies nötig.

alter table public.transactions
  add column ist_einkommen  boolean default false,
  add column einkommensart  text,       -- 'dipendente' | 'autonomo' | 'affitto' | 'sonstige'
  add column betrag_brutto  boolean default false,  -- haben = brutto (true) oder netto+ritenuta (false)
  add column ritenuta       numeric;                -- bereits einbehaltene Steuer (z. B. aus Busta Paga)
