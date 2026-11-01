-- Anmeldung trotz Mandantentrennung
--
-- Henne-Ei, zum zweiten: Um den Mandanten zu setzen, muss man wissen, wer
-- sich anmeldet. Um den Benutzer zu lesen, muesste der Mandant gesetzt sein.
--
-- Die Tabelle dafuer von RLS auszunehmen waere der bequeme Weg und der
-- falsche: dort liegen Namen und Passwort-Hashes aller Kunden.
--
-- Stattdessen ein eng begrenztes Fenster: eine Funktion mit SECURITY DEFINER,
-- die unter dem Eigentuemer laeuft und damit an RLS vorbeisieht. Sie gibt
-- genau eine Zeile zu genau einem Namen heraus, nichts weiter -- kein LIKE,
-- keine Liste, kein Zugriff auf andere Spalten. Mehr Loch als das braucht
-- die Anmeldung nicht.
--
-- search_path wird festgenagelt. Ohne das koennte jemand mit Rechten auf ein
-- anderes Schema eine eigene Tabelle "benutzer" davorschieben und die
-- Funktion damit auf fremde Daten umlenken.

BEGIN;

CREATE OR REPLACE FUNCTION anmelde_daten(p_name text)
RETURNS TABLE (name text, mandant_id uuid, rolle text, passwort_hash text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
    SELECT b.name, b.mandant_id, b.rolle, b.passwort_hash
      FROM benutzer b
     WHERE lower(b.name) = lower(p_name)
       AND b.aktiv
       -- Mieter melden sich nicht mit Passwort an, sondern ueber einen
       -- Einmallink an ihre im Mietvertrag hinterlegte Adresse.
       AND b.rolle <> 'mieter'
     LIMIT 2;
$$;

REVOKE ALL ON FUNCTION anmelde_daten(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION anmelde_daten(text) TO stig_app;

-- Zeitstempel der letzten Anmeldung. Gleicher Grund, gleicher Zuschnitt:
-- schreibt genau ein Feld, genau einer Zeile.
CREATE OR REPLACE FUNCTION anmeldung_vermerken(p_name text, p_mandant uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    UPDATE benutzer SET letzte_anmeldung = now()
     WHERE lower(name) = lower(p_name) AND mandant_id = p_mandant;
$$;

REVOKE ALL ON FUNCTION anmeldung_vermerken(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION anmeldung_vermerken(text, uuid) TO stig_app;

COMMIT;
