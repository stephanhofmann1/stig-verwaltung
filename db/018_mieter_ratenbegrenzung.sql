-- Ratenbegrenzung fuer Mieter-Anmeldelinks
--
-- /api/mieter/anmelden ist ohne Anmeldung erreichbar -- es muss es sein, sonst
-- koennte sich niemand anmelden. Damit laesst sich aber auch jedes Postfach
-- zuschuetten: Wer die Adresse eines Mieters kennt, loest beliebig viele
-- Mails aus. Fuer den Mieter sieht das aus wie ein Angriff auf sein Konto,
-- und beim naechsten echten Link glaubt er der Mail nicht mehr.
--
-- Die Grenze sitzt bewusst in der Datenbank und nicht in der Anwendung:
--   - Ein Zaehler im Arbeitsspeicher ueberlebt keinen Neustart und keinen
--     zweiten Container.
--   - Die Daten, die man zum Zaehlen braucht, liegen ohnehin schon hier --
--     mieter_zugang protokolliert jede Anforderung mit Zeitstempel.
--
-- Begrenzt wird je Mietverhaeltnis, nicht je Absender-IP: Die IP sagt bei
-- Mobilfunk und hinter Cloudflare wenig aus, und geschuetzt werden soll das
-- Postfach, nicht der Server.
--
-- Wird die Grenze erreicht, gibt die Funktion nichts zurueck -- genau wie bei
-- einer unbekannten Adresse. Die aufrufende Schicht antwortet in beiden
-- Faellen gleich, und damit verraet auch die Begrenzung nicht, ob es die
-- Adresse gibt.
--
-- Zweite Aenderung in derselben Datei, weil es dieselbe Funktion ist: Der
-- Zugang beruecksichtigt jetzt den Status aus Migration 017.

BEGIN;

-- Fuenf Links pro Stunde. Wer sich dreimal vertippt und zweimal die Mail
-- nicht findet, kommt noch durch; ein Mailbombing ist damit beendet.
CREATE OR REPLACE FUNCTION mieter_zugang_anfordern(
    p_email      text,
    p_token_hash text,
    p_minuten    int DEFAULT 60
)
RETURNS TABLE (mandant_id uuid, mietverhaeltnis_id uuid, anzeigename text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    treffer record;
    zuletzt int;
BEGIN
    SELECT mv.id AS mv_id, mv.mandant_id AS m_id, k.anzeigename
      INTO treffer
      FROM kontakt_email ke
      JOIN kontakt k           ON k.id  = ke.kontakt_id
      JOIN mietverhaeltnis mv  ON mv.kontakt_id = k.id
     WHERE lower(ke.email) = lower(trim(p_email))
       AND mv.beginn <= current_date
       AND (mv.ende IS NULL OR mv.ende >= current_date)
       -- Seit Migration 017 gibt es einen Status. Ein verschickter, noch
       -- nicht unterschriebener Vertrag (status='vertrag_versendet') hat
       -- bereits ein beginn-Datum -- und haette ohne diese Bedingung ab
       -- diesem Tag Zugang zum Mieterbereich, obwohl niemand eingezogen
       -- ist. COALESCE, weil die Spalte in aelteren Staenden fehlt: dann
       -- gilt wie bisher allein beginn/ende.
       AND COALESCE(to_jsonb(mv) ->> 'status', 'aktiv')
           IN ('aktiv','gekuendigt')
     ORDER BY mv.beginn DESC
     LIMIT 1;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    SELECT count(*) INTO zuletzt
      FROM mieter_zugang mz
     WHERE mz.mietverhaeltnis_id = treffer.mv_id
       AND mz.angelegt_am > now() - interval '1 hour';

    IF zuletzt >= 5 THEN
        -- Bewusst keine eigene Fehlermeldung: Nach aussen ununterscheidbar
        -- von einer unbekannten Adresse.
        RAISE LOG 'Mieter-Anmeldelink begrenzt fuer Mietverhaeltnis %', treffer.mv_id;
        RETURN;
    END IF;

    -- Aeltere, noch offene Links derselben Person entwerten. Sonst sammeln
    -- sich bei mehrfachem Klicken gueltige Schluessel in alten Mails an.
    --
    -- Der Alias ist noetig, nicht Geschmack: Die Ausgabespalten dieser
    -- Funktion heissen genauso wie die Tabellenspalten, und plpgsql haelt
    -- ein unqualifiziertes mietverhaeltnis_id dann fuer mehrdeutig.
    UPDATE mieter_zugang mz
       SET ablauf = now()
     WHERE mz.mietverhaeltnis_id = treffer.mv_id
       AND mz.eingeloest_am IS NULL
       AND mz.ablauf > now();

    INSERT INTO mieter_zugang (mandant_id, mietverhaeltnis_id, token_hash, ablauf)
    VALUES (treffer.m_id, treffer.mv_id, p_token_hash,
            now() + make_interval(mins => greatest(5, least(p_minuten, 1440))));

    RETURN QUERY SELECT treffer.m_id, treffer.mv_id, treffer.anzeigename;
END;
$$;

REVOKE ALL ON FUNCTION mieter_zugang_anfordern(text, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mieter_zugang_anfordern(text, text, int) TO stig_app;

-- Der Zaehler fragt nach Zeitfenster je Mietverhaeltnis. Ohne diesen Index
-- wuerde jede Anforderung die ganze Tabelle lesen.
CREATE INDEX IF NOT EXISTS mieter_zugang_fenster_idx
    ON mieter_zugang (mietverhaeltnis_id, angelegt_am DESC);

COMMIT;
