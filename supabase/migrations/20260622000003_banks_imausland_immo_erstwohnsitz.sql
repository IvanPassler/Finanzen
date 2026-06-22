-- banks: Auslandsflag für IVAFE-Berechnung (Depot 0,20 % / Konto 34,20 € fix).
-- immobilien: Erstwohnsitz-Flag für IMU-Befreiung und IVIE-Ausschluss.
-- Bestehende Zeilen erhalten default false → keine Änderung an bestehenden Berechnungen.
-- Keine neuen RLS-Policies nötig; bestehende Policies greifen auf alle Spalten.

alter table public.banks
  add column im_ausland boolean default false;

alter table public.immobilien
  add column erstwohnsitz boolean default false;
