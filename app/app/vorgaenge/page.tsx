import Link from "next/link";
import { query } from "@/lib/db";
import { objektSicht } from "@/lib/objektsicht";
import { KATEGORIE_LABEL, STATUS_LABEL, type Kategorie, type VorgangStatus } from "@/lib/typen";
import { aktenzeichen, seit } from "@/lib/formate";

export const dynamic = "force-dynamic";

interface Zeile {
  id: string;
  nummer: number;
  betreff: string;
  kategorie: Kategorie;
  status: VorgangStatus;
  heikel: boolean;
  geaendert_am: string;
  kontakt_name: string | null;
  anzahl_nachrichten: number;
  offene_entwuerfe: number;
}

export default async function Vorgaenge() {
  const { gewaehlt } = await objektSicht();

  const zeilen = await query<Zeile>(
    `
    SELECT v.id, v.nummer, v.betreff, v.kategorie, v.status, v.heikel,
           v.geaendert_am,
           k.anzeigename AS kontakt_name,
           (SELECT count(*) FROM nachricht n
             WHERE n.vorgang_id = v.id AND n.status <> 'verworfen')::int
             AS anzahl_nachrichten,
           (SELECT count(*) FROM nachricht n
             WHERE n.vorgang_id = v.id AND n.status = 'entwurf')::int
             AS offene_entwuerfe
      FROM vorgang v
      LEFT JOIN kontakt k ON k.id = v.kontakt_id
     -- Vorgaenge OHNE Objekt bleiben stehen, wie im Cockpit und in der
     -- Ablage: "ohne Objekt" heisst nicht "gehoert einem anderen Haus",
     -- sondern "noch keinem zugeordnet" -- und das ist meist die
     -- frischeste Post, also die, die am ehesten Arbeit macht.
     WHERE ($1::uuid IS NULL OR v.objekt_id = $1 OR v.objekt_id IS NULL)
     ORDER BY (v.status = 'erledigt'), v.geaendert_am DESC
     LIMIT 200
  `,
    [gewaehlt?.id ?? null],
  );

  const offen = zeilen.filter((z) => z.status !== "erledigt").length;

  return (
    <>
      <div className="titelzeile">
        <h1>{gewaehlt ? `Vorgänge — ${gewaehlt.name}` : "Vorgänge"}</h1>
        <span className="zaehler ziffern">
          {offen} offen · {zeilen.length} gesamt
        </span>
      </div>

      {zeilen.length === 0 ? (
        <div className="leer">
          <strong>Noch keine Vorgänge</strong>
          Sobald die erste Mail an verwaltung@stig-immobilien.de ankommt,
          legt sie sich hier als Akte ab.
        </div>
      ) : (
        <div className="register">
          {zeilen.map((z) => (
            <Link
              key={z.id}
              href={`/vorgang/${z.id}`}
              className="posten"
              data-heikel={z.heikel ? "ja" : "nein"}
            >
              <span className="nummer ziffern">{aktenzeichen(z.nummer)}</span>
              <span className="betreff">{z.betreff}</span>
              <span className="zeit">{seit(z.geaendert_am)}</span>
              <span className="unterzeile">
                <span>{z.kontakt_name ?? "Unbekannt"}</span>
                <span>{KATEGORIE_LABEL[z.kategorie]}</span>
                <span className="ziffern">
                  {z.anzahl_nachrichten}{" "}
                  {z.anzahl_nachrichten === 1 ? "Nachricht" : "Nachrichten"}
                </span>
                <span>{STATUS_LABEL[z.status]}</span>
                {z.heikel && (
                  <span className="marker" data-art="heikel">
                    heikel
                  </span>
                )}
                {z.offene_entwuerfe > 0 && (
                  <span className="marker" data-art="agent">
                    Entwurf wartet
                  </span>
                )}
              </span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
