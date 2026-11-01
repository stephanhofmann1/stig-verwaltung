import Link from "next/link";
import { query } from "@/lib/db";
import { EntwurfKarte } from "@/components/EntwurfKarte";
import { aktenzeichen, seit } from "@/lib/formate";

export const dynamic = "force-dynamic";

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

export default async function Freigabe() {
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
    <>
      <div className="titelzeile">
        <h1>Freigabe</h1>
        <span className="zaehler ziffern">
          {entwuerfe.length} {entwuerfe.length === 1 ? "Entwurf" : "Entwürfe"}
        </span>
      </div>
      <p className="hinweis">
        Vorbereitete Antworten. Lies drüber, ändere was du willst, und sende.
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
            <h1>Ohne Entwurf</h1>
            <span className="zaehler ziffern">{unbeantwortet.length}</span>
          </div>
          <p className="hinweis">
            Diese Vorgänge hat der Agent nicht beantwortet — entweder weil sie
            als heikel gelten oder weil er sich nicht sicher war.
          </p>
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
    </>
  );
}
