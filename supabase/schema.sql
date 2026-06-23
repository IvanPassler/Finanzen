--
-- PostgreSQL database dump
--
-- Wichtige Design-Entscheidungen (nicht aus dem Schema selbst ableitbar):
--
-- 1. transactions.bank und portfolio.bank sind TEXT (bleibt für Anzeige/Filter erhalten);
--    bank_id ist UUID-FK auf banks.id (C17). Beide Spalten existieren parallel.
--    Verknüpfung erfolgt via Stringvergleich (r.bank === b.name in JS).
--    Migration zu FK geplant (IMPROVEMENT_PLAN Step 17 / C17).
--
-- 2. pension_stand hat kein eigenes user_id-Feld. RLS-Zugang erfolgt per
--    JOIN zu pensionsfonds.user_id (JOIN-basierte Policies).
--
-- 3. immobilien.restschuld ist denormalisiert: Spiegel des neuesten
--    immo_schuld-Eintrags. Wird beim Speichern/Löschen eines Schuld-Stands
--    synchron aktualisiert.
--

\restrict bxBEDreS3hdaTINMkXgVjXj69B8gLqmr24RyGy6NVOQNqQlYvOgTFr4lpJKs0MT

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: banks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.banks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    name text NOT NULL,
    hat_portfolio boolean DEFAULT false,
    vertragsstart date,
    saldo_start numeric,
    eigentuemer jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    hat_kreditkarte boolean DEFAULT false,
    im_ausland boolean DEFAULT false
);


--
-- Name: beteiligungen; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.beteiligungen (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    name text,
    quote numeric,
    invest_hist numeric,
    marktwert numeric,
    dividende_jahr numeric,
    dividende_netto boolean DEFAULT false,
    darlehen numeric,
    zins numeric,
    zins_modus text DEFAULT 'ausschuettend'::text,
    created_at timestamp with time zone DEFAULT now(),
    bindung text
);


--
-- Name: immo_schuld; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.immo_schuld (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    immo_id uuid NOT NULL,
    datum date,
    restschuld numeric,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: immobilien; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.immobilien (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    bezeichnung text,
    typ text DEFAULT 'vermietung'::text,
    kaufjahr integer,
    kaufpreis numeric,
    marktwert numeric,
    restschuld numeric,
    rate_monat numeric,
    zinssatz numeric,
    restlaufzeit numeric,
    wertsteigerung numeric,
    bruttomiete numeric,
    leerstand numeric,
    condominio numeric,
    versicherung numeric,
    instandhaltung numeric,
    steuermodell text DEFAULT 'cedolare'::text,
    grenzsteuersatz numeric DEFAULT 23,
    imu_faellig boolean DEFAULT false,
    imu_jahr numeric,
    anteil_user numeric DEFAULT 100,
    created_at timestamp with time zone DEFAULT now(),
    bindung text,
    kaufnebenkosten numeric,
    erstwohnsitz boolean DEFAULT false
);


--
-- Name: pensionsfonds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pensionsfonds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    name text,
    fondstyp text DEFAULT 'FPA'::text,
    rentenjahr integer,
    fondswert numeric,
    eigenbeitrag numeric,
    agbeitrag numeric,
    rendite numeric,
    absetzbar boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    bindung text
);


--
-- Name: pension_stand; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pension_stand (
    id         uuid DEFAULT gen_random_uuid() NOT NULL,
    pension_id uuid NOT NULL,
    datum      date,
    wert       numeric,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: portfolio; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portfolio (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    datum date,
    bank text,
    bank_id uuid,
    bezeichnung text,
    anteile numeric,
    investiert numeric,
    wert numeric,
    created_at timestamp with time zone DEFAULT now(),
    bindung text
);


--
-- Name: steuer_einstellungen; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.steuer_einstellungen (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    grenzsteuersatz numeric DEFAULT 23,
    vorauszahlung numeric,
    zu_versteuerndes_einkommen numeric,
    addizionale_regionale numeric DEFAULT 1.23,
    addizionale_comunale numeric DEFAULT 0.8,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    buchungsdatum date,
    beschreibung text,
    soll numeric,
    haben numeric,
    kategorie text,
    bank text,
    created_at timestamp with time zone DEFAULT now(),
    immo_id uuid,
    kreditkarte boolean DEFAULT false,
    umbuchung boolean DEFAULT false,
    umbuchung_partner uuid,
    ist_einkommen boolean DEFAULT false,
    einkommensart text,
    betrag_brutto boolean DEFAULT false,
    ritenuta numeric,
    bank_id uuid
);


--
-- Name: banks banks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.banks
    ADD CONSTRAINT banks_pkey PRIMARY KEY (id);


--
-- Name: beteiligungen beteiligungen_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beteiligungen
    ADD CONSTRAINT beteiligungen_pkey PRIMARY KEY (id);


--
-- Name: immo_schuld immo_schuld_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.immo_schuld
    ADD CONSTRAINT immo_schuld_pkey PRIMARY KEY (id);


--
-- Name: immobilien immobilien_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.immobilien
    ADD CONSTRAINT immobilien_pkey PRIMARY KEY (id);


--
-- Name: pensionsfonds pensionsfonds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pensionsfonds
    ADD CONSTRAINT pensionsfonds_pkey PRIMARY KEY (id);


--
-- Name: pension_stand pension_stand_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pension_stand
    ADD CONSTRAINT pension_stand_pkey PRIMARY KEY (id);


--
-- Name: portfolio portfolio_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio
    ADD CONSTRAINT portfolio_pkey PRIMARY KEY (id);


--
-- Name: steuer_einstellungen steuer_einstellungen_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.steuer_einstellungen
    ADD CONSTRAINT steuer_einstellungen_pkey PRIMARY KEY (id);


--
-- Name: steuer_einstellungen steuer_einstellungen_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.steuer_einstellungen
    ADD CONSTRAINT steuer_einstellungen_user_id_key UNIQUE (user_id);


--
-- Name: transactions transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);


--
-- Name: banks banks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.banks
    ADD CONSTRAINT banks_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: beteiligungen beteiligungen_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beteiligungen
    ADD CONSTRAINT beteiligungen_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: immo_schuld immo_schuld_immo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.immo_schuld
    ADD CONSTRAINT immo_schuld_immo_id_fkey FOREIGN KEY (immo_id) REFERENCES public.immobilien(id) ON DELETE CASCADE;


--
-- Name: immo_schuld immo_schuld_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.immo_schuld
    ADD CONSTRAINT immo_schuld_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: immobilien immobilien_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.immobilien
    ADD CONSTRAINT immobilien_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: pensionsfonds pensionsfonds_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pensionsfonds
    ADD CONSTRAINT pensionsfonds_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: pension_stand pension_stand_pension_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pension_stand
    ADD CONSTRAINT pension_stand_pension_id_fkey
    FOREIGN KEY (pension_id)
    REFERENCES public.pensionsfonds(id)
    ON DELETE CASCADE;


--
-- Name: portfolio portfolio_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio
    ADD CONSTRAINT portfolio_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: steuer_einstellungen steuer_einstellungen_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.steuer_einstellungen
    ADD CONSTRAINT steuer_einstellungen_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: transactions transactions_immo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_immo_id_fkey FOREIGN KEY (immo_id) REFERENCES public.immobilien(id) ON DELETE SET NULL;


--
-- Name: transactions transactions_umbuchung_partner_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_umbuchung_partner_fkey FOREIGN KEY (umbuchung_partner) REFERENCES public.transactions(id) ON DELETE SET NULL;


--
-- Name: transactions transactions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: banks b_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY b_delete_own ON public.banks FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: banks b_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY b_insert_own ON public.banks FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: banks b_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY b_select_own ON public.banks FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: banks b_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY b_update_own ON public.banks FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: banks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.banks ENABLE ROW LEVEL SECURITY;

--
-- Name: beteiligungen be_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY be_delete_own ON public.beteiligungen FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: beteiligungen be_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY be_insert_own ON public.beteiligungen FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: beteiligungen be_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY be_select_own ON public.beteiligungen FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: beteiligungen be_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY be_update_own ON public.beteiligungen FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: beteiligungen; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.beteiligungen ENABLE ROW LEVEL SECURITY;

--
-- Name: transactions delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY delete_own ON public.transactions FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: immobilien i_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY i_delete_own ON public.immobilien FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: immobilien i_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY i_insert_own ON public.immobilien FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: immobilien i_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY i_select_own ON public.immobilien FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: immobilien i_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY i_update_own ON public.immobilien FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: immo_schuld; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.immo_schuld ENABLE ROW LEVEL SECURITY;

--
-- Name: immobilien; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.immobilien ENABLE ROW LEVEL SECURITY;

--
-- Name: transactions insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY insert_own ON public.transactions FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: immo_schuld is_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY is_delete_own ON public.immo_schuld FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: immo_schuld is_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY is_insert_own ON public.immo_schuld FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: immo_schuld is_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY is_select_own ON public.immo_schuld FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: immo_schuld is_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY is_update_own ON public.immo_schuld FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: portfolio p_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY p_delete_own ON public.portfolio FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: portfolio p_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY p_insert_own ON public.portfolio FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: portfolio p_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY p_select_own ON public.portfolio FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: portfolio p_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY p_update_own ON public.portfolio FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: pensionsfonds; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pensionsfonds ENABLE ROW LEVEL SECURITY;

--
-- Name: pensionsfonds pf_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pf_delete_own ON public.pensionsfonds FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: pensionsfonds pf_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pf_insert_own ON public.pensionsfonds FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: pensionsfonds pf_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pf_select_own ON public.pensionsfonds FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: pensionsfonds pf_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pf_update_own ON public.pensionsfonds FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: pension_stand; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pension_stand ENABLE ROW LEVEL SECURITY;

--
-- Name: pension_stand ps_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ps_delete_own ON public.pension_stand FOR DELETE
    USING (EXISTS (
        SELECT 1 FROM public.pensionsfonds
        WHERE id = pension_stand.pension_id
          AND user_id = auth.uid()
    ));


--
-- Name: pension_stand ps_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ps_insert_own ON public.pension_stand FOR INSERT
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.pensionsfonds
        WHERE id = pension_stand.pension_id
          AND user_id = auth.uid()
    ));


--
-- Name: pension_stand ps_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ps_select_own ON public.pension_stand FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.pensionsfonds
        WHERE id = pension_stand.pension_id
          AND user_id = auth.uid()
    ));


--
-- Name: pension_stand ps_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ps_update_own ON public.pension_stand FOR UPDATE
    USING (EXISTS (
        SELECT 1 FROM public.pensionsfonds
        WHERE id = pension_stand.pension_id
          AND user_id = auth.uid()
    ));


--
-- Name: portfolio; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.portfolio ENABLE ROW LEVEL SECURITY;

--
-- Name: transactions select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY select_own ON public.transactions FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: steuer_einstellungen st_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY st_delete_own ON public.steuer_einstellungen FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: steuer_einstellungen st_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY st_insert_own ON public.steuer_einstellungen FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: steuer_einstellungen st_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY st_select_own ON public.steuer_einstellungen FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: steuer_einstellungen st_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY st_update_own ON public.steuer_einstellungen FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: steuer_einstellungen; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.steuer_einstellungen ENABLE ROW LEVEL SECURITY;

--
-- Name: transactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: transactions update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY update_own ON public.transactions FOR UPDATE USING ((auth.uid() = user_id));


--
-- PostgreSQL database dump complete
--

\unrestrict bxBEDreS3hdaTINMkXgVjXj69B8gLqmr24RyGy6NVOQNqQlYvOgTFr4lpJKs0MT

