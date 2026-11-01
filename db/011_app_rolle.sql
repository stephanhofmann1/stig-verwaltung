-- Eigene Rolle fuer die Anwendung
--
-- Das Postgres-Abbild legt POSTGRES_USER (hier "stig") als Superuser an.
-- Ein Superuser umgeht Row Level Security grundsaetzlich -- auch bei
-- FORCE ROW LEVEL SECURITY. Verbindet sich die Anwendung als "stig",
-- ist die gesamte Mandantentrennung aus 010 wirkungslos und faellt dabei
-- nicht einmal auf, weil alles funktioniert: man sieht eben alles.
--
-- Deshalb: Die Anwendung bekommt eine eigene Rolle ohne Sonderrechte.
-- "stig" bleibt fuer Migrationen, Onboarding neuer Mandanten und Wartung.
--
-- Das Passwort steht bewusst nicht hier, sondern wird beim Einrichten
-- gesetzt:  ALTER ROLE stig_app PASSWORD '...';

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stig_app') THEN
        CREATE ROLE stig_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
                             NOINHERIT NOBYPASSRLS;
    END IF;
END $$;

GRANT USAGE ON SCHEMA public TO stig_app;

GRANT SELECT, INSERT, UPDATE, DELETE
   ON ALL TABLES    IN SCHEMA public TO stig_app;
GRANT USAGE, SELECT
   ON ALL SEQUENCES IN SCHEMA public TO stig_app;

-- Spaetere Tabellen und Sequenzen gleich mitnehmen, sonst faellt die
-- naechste Migration erst im Betrieb auf.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES    TO stig_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT                 ON SEQUENCES TO stig_app;

-- Die Anwendung darf den Mandanten nicht wechseln und keine Mandanten
-- anlegen -- nur den eigenen lesen und seinen Vorgangszaehler hochsetzen.
-- Beides deckt die Policy aus 010 ab.
REVOKE INSERT, DELETE ON mandant FROM stig_app;

COMMIT;
