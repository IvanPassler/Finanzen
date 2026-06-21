-- pension_stand: Wertstand-Historie je Pensionsfonds.
-- Kein eigenes user_id-Feld; Nutzerzuordnung läuft über pensionsfonds.user_id (Join-basierte RLS).

CREATE TABLE public.pension_stand (
    id         uuid DEFAULT gen_random_uuid() NOT NULL,
    pension_id uuid NOT NULL,
    datum      date,
    wert       numeric,
    created_at timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY public.pension_stand
    ADD CONSTRAINT pension_stand_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.pension_stand
    ADD CONSTRAINT pension_stand_pension_id_fkey
    FOREIGN KEY (pension_id)
    REFERENCES public.pensionsfonds(id)
    ON DELETE CASCADE;

ALTER TABLE public.pension_stand ENABLE ROW LEVEL SECURITY;

CREATE POLICY ps_select_own ON public.pension_stand FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.pensionsfonds
        WHERE id = pension_stand.pension_id
          AND user_id = auth.uid()
    ));

CREATE POLICY ps_insert_own ON public.pension_stand FOR INSERT
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.pensionsfonds
        WHERE id = pension_stand.pension_id
          AND user_id = auth.uid()
    ));

CREATE POLICY ps_update_own ON public.pension_stand FOR UPDATE
    USING (EXISTS (
        SELECT 1 FROM public.pensionsfonds
        WHERE id = pension_stand.pension_id
          AND user_id = auth.uid()
    ));

CREATE POLICY ps_delete_own ON public.pension_stand FOR DELETE
    USING (EXISTS (
        SELECT 1 FROM public.pensionsfonds
        WHERE id = pension_stand.pension_id
          AND user_id = auth.uid()
    ));
