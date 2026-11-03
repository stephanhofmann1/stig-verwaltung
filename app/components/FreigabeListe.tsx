import Link from "next/link";
import { query } from "@/lib/db";
import { EntwurfKarte } from "@/components/EntwurfKarte";
import { Erklaerung } from "@/components/CockpitKarte";
import { aktenzeichen, seit } from "@/lib/formate";

/**
 * Die Freigabe-Warteschlange.
 *
 * Bis zum 02.11.2026 war das die ganze Startseite. Sie ist jetzt eine Karte
 * im Cockpit, inhaltlich unveraendert: dieselben zwei Abfragen, dieselben
 * Entwurfskarten, dieselbe Liste der Vorgaenge ohne Entwurf. Nichts
 * verschickt sich von selbst -- gesendet wird nur, was hier freigegeben
 * wird, und das bleibt so.
 *
 * Die Ueberschriften sind h2 statt h1: Die Seite hat jetzt eine eigene h1,
 * und zwei h1 nebeneinander waeren fuer einen Screenreader zwei Seiten.
 */

interface Entwurf {
  id: string;
  betreff: string;
  koerper_text: string;
  an_emails: string[];
  verfasst_von: "agent" | "mensch" | null;
  agent_notiz: string | null;
  vorgang_id: string;
  vorgang_nummer: number;
  vorgang_betreff: string;
}

interface Wartend {
  id: string;
  nummer: number;
  betreff: string;
  kontakt_name: string | null;
  geaendert_am: string;
  heikel: boolean;
}

export async function FreigabeListe() {
  const entwuerfe = await query<Entwurf>(`
    SELECT n.id, n.betreff, n.koerper_text, n.an_emails,
           n.verfasst_von, n.agent_notiz,
           v.id AS vorgang_id, v.nummer AS vorgang_nummer,
           v.betreff AS vorgang_betreff
      FROM nachricht n
      JOIN vorgang v ON v.id = n.vorgang_id
     WHERE n.status = 'entwurf'
     ORDER BY n.angelegt_am ASC
  `);

  // Vorgänge, die offen sind und auf die noch niemand geantwortet hat.
  const unbeantwortet = await query<Wartend>(`
    SELECT v.id, v.nummer, v.betreff, v.heikel, v.geaendert_am,
           k.anzeigename AS kontakt_name
      FROM vorgang v
      LEFT JOIN kontakt k ON k.id = v.kontakt_id
     WHERE v.status = 'offen'
       AND NOT EXISTS (
         SELECT 1 FROM nachricht n
          WHERE n.vorgang_id = v.id AND n.status IN ('entwurf','gesendet'))
     ORDER BY v.geaendert_am ASC
     LIMIT 50
  `);

  return (
    <section aria-labelledby="freigabe-titel">
      <div className="titelzeile">
        <h2 id="freigabe-titel" style={{ margin: 0 }}>
          Freigabe
        </h2>
        <span className="zaehler ziffern">
          {entwuerfe.length} {entwuerfe.length === 1 ? "Entwurf" : "Entwürfe"}
        </span>
      </div>
      {/* Der kurze Satz bleibt stehen: Er ist die Zusage, auf der die ganze
          Automatik ruht, und steht ueber der ersten Handlung der Seite. */}
      <p className="hinweis">
        Nichts verlässt das Haus, ohne dass du hier geklickt hast.
      </p>

      {entwuerfe.length === 0 ? (
        <div className="leer">
          <strong>Nichts zum Freigeben</strong>
          Sobald eine Mail ankommt, die sich beantworten lässt, liegt der
          Entwurf hier.
        </div>
      ) : (
        entwuerfe.map((e) => (
          <EntwurfKarte
            key={e.id}
            id={e.id}
            betreff={e.betreff}
            koerper={e.koerper_text}
            empfaenger={e.an_emails}
            verfasstVon={e.verfasst_von}
            notiz={e.agent_notiz}
            vorgang={{
              id: e.vorgang_id,
              nummer: e.vorgang_nummer,
              betreff: e.vorgang_betreff,
            }}
          />
        ))
      )}

      {unbeantwortet.length > 0 && (
        <>
          <div className="titelzeile">
            <h2 style={{ margin: 0 }}>Ohne Entwurf</h2>
            <span className="zaehler ziffern">{unbeantwortet.length}</span>
          </div>
          <Erklaerung satz="Diese Vorgänge hat der Agent nicht beantwortet — hier gibt es nichts freizugeben, sondern zu schreiben">
            <p className="hinweis">
              Entweder gelten sie als heikel, oder der Agent war sich nicht
              sicher. In beiden Fällen liegt der Vorgang offen und wartet auf
              eine Antwort von Hand; ein Entwurf entsteht dazu nicht mehr von
              selbst.
            </p>
          </Erklaerung>
          <div className="register">
            {unbeantwortet.map((v) => (
              <Link
                key={v.id}
                href={`/vorgang/${v.id}`}
                className="posten"
                data-heikel={v.heikel ? "ja" : "nein"}
              >
                <span className="nummer ziffern">{aktenzeichen(v.nummer)}</span>
                <span className="betreff">{v.betreff}</span>
                <span className="zeit">{seit(v.geaendert_am)}</span>
                <span className="unterzeile">
                  <span>{v.kontakt_name ?? "Unbekannt"}</span>
                  {v.heikel && (
                    <span className="marker" data-art="heikel">
                      heikel
                    </span>
                  )}
                </span>
              </Link>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
