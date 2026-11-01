-- Adresse zu einem Mietverhaeltnis
--
-- Nachgereicht statt in 015 ergaenzt: Der Migrationsrunner merkt sich
-- angewandte Dateien am Namen. Haette ich 015 nachtraeglich geaendert,
-- waere die Aenderung auf jedem Server uebersprungen worden, der 015
-- bereits eingespielt hat -- und zwar lautlos.
-- Migrationen werden ergaenzt, nicht bearbeitet.
--
-- Gebraucht fuer Meldungen aus dem Mieterbereich: Die Meldung geht denselben
-- Weg wie eine eingehende Mail und braucht dafuer eine Absenderadresse.

BEGIN;

CREATE OR REPLACE FUNCTION mieter_email(p_mv uuid)
RETURNS TABLE (email text, anzeigename text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
    SELECT ke.email, k.anzeigename
      FROM mietverhaeltnis mv
      JOIN kontakt k       ON k.id = mv.kontakt_id
      JOIN kontakt_email ke ON ke.kontakt_id = k.id
     WHERE mv.id = p_mv
     ORDER BY ke.ist_primaer DESC
     LIMIT 1;
$$;

REVOKE ALL ON FUNCTION mieter_email(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mieter_email(uuid) TO stig_app;

COMMIT;
