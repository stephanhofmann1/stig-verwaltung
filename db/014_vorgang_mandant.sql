-- Mandant zu einem Vorgang, ohne gesetzten Mandanten
--
-- Der Agent schreibt Entwuerfe ueber POST /api/vorgang/<id>/entwurf und
-- weist sich dabei mit dem Aufgabenschluessel aus, nicht mit einer Sitzung.
-- Er hat also eine Vorgangskennung, aber keinen Mandanten -- und ohne
-- Mandanten findet er den Vorgang nicht, weil RLS ihn verbirgt.
--
-- Gleiches Muster wie bei der Anmeldung (db/013): ein eng begrenztes
-- Fenster statt einer offenen Tabelle. Die Funktion verraet zu einer
-- vollstaendigen Vorgangskennung genau ein Feld -- den Mandanten. Mehr
-- bekommt man damit nicht; der Vorgang selbst bleibt hinter RLS.
--
-- Raten laesst sich eine UUID nicht, und wer sie hat, hat sie aus einer
-- Antwort bekommen, fuer die er bereits berechtigt war.

BEGIN;

CREATE OR REPLACE FUNCTION mandant_fuer_vorgang(p_vorgang uuid)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
    SELECT mandant_id FROM vorgang WHERE id = p_vorgang;
$$;

REVOKE ALL ON FUNCTION mandant_fuer_vorgang(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mandant_fuer_vorgang(uuid) TO stig_app;

COMMIT;
