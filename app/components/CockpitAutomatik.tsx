import type { AutomatikPosten, LageberichtLage, LaufLage } from "@/lib/kennzahlen";
import { CockpitKarte } from "@/components/CockpitKarte";

/**
 * Zustand der Automatik.
 *
 * Der Grund, warum das aufs Cockpit gehoert und nicht nur unter /laeufe:
 * Ein Lauf, der seit drei Wochen an einem abgelaufenen Token scheitert,
 * verhaelt sich nach aussen genauso wie einer, der nichts zu tun hatte --
 * beide schweigen. Auffallen wuerde es erst, wenn sich ein Mieter beschwert,
 * dass niemand auf seine Mail geantwortet hat.
 *
 * Zwei Zustaende sind besonders hinterhaeltig und stehen deshalb ausdruecklich
 * da:
 *
 *   "steht"      Der letzte Lauf meldet ok, ist aber von vorgestern. Dann
 *                sind auch alle anderen Zahlen dieser Seite von vorgestern.
 *   Serie        Mehrere Fehllaeufe hintereinander. Ein einmaliger Umfaller
 *                ist kein Grund, etwas zu tun; eine Serie schon.
 */

const WORTE: Record<LaufLage, string> = {
  nie: "noch nie gelaufen",
  steht: "steht",
  gescheitert: "gescheitert",
  hinweise: "mit Hinweis",
  ok: "ok",
};

const zeitpunkt = (iso: string) =>
  new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

export function CockpitAutomatik({
  posten,
  lagebericht,
}: {
  posten: AutomatikPosten[];
  lagebericht: LageberichtLage;
}) {
  const auffaellig = posten.filter((p) => p.lage !== "ok");
  const dauerhaft = posten.filter((p) => p.serie >= 2 || p.lage === "nie");

  return (
    <CockpitKarte
      titel="Automatik"
      zaehler={
        auffaellig.length === 0
          ? "alles gelaufen"
          : `${auffaellig.length} von ${posten.length} auffällig`
      }
      hinweis={
        <>
          Die nächtlichen Läufe aus der Tabelle <code>lauf</code>. Ein „ok“ von
          vorgestern ist kein ok — dann erreicht der Zeitplaner die Anwendung
          nicht, und alle anderen Zahlen auf dieser Seite sind ebenfalls von
          vorgestern.
        </>
      }
      mehr="/laeufe"
      mehrText="Läufe im Verlauf"
    >
      {dauerhaft.length > 0 && (
        <p className="hinweis">
          <span className="marker" data-art="heikel">
            dauerhaft
          </span>{" "}
          {dauerhaft
            .map((p) =>
              p.lage === "nie"
                ? `${p.name} ist noch nie gelaufen`
                : `${p.name} scheitert ${p.serie} Läufe hintereinander`,
            )
            .join("; ")}
          . Das ist kein Umfaller, sondern ein Zustand.
        </p>
      )}

      <div className="register">
        {posten.map((p) => {
          const scharf =
            p.lage === "nie" || p.lage === "steht" || p.lage === "gescheitert";
          return (
            <div
              className="posten"
              key={p.name}
              data-heikel={scharf ? "ja" : "nein"}
            >
              <span className="nummer">{scharf ? "!" : p.lage === "ok" ? "ok" : "·"}</span>
              <span className="betreff">{p.name}</span>
              <span className="zeit ziffern">
                {p.begonnen_am ? zeitpunkt(p.begonnen_am) : "nie"}
              </span>
              <span className="unterzeile">
                <span className="marker" data-art={scharf ? "heikel" : undefined}>
                  {WORTE[p.lage]}
                </span>
                {p.serie > 1 && <span>{p.serie} Fehlläufe in Folge</span>}
                {p.hinweis && <span>{p.hinweis}</span>}
              </span>
            </div>
          );
        })}
      </div>

      {/* Zwei Fragen, nicht eine: gelaufen und verschickt. Ein Lauf, der ok
          meldet und nichts verschickt hat, ist der stille Fall -- der
          Zeitplaner ist gruen, auf dem Telefon kommt nichts an. */}
      <p className="hinweis" style={{ marginTop: "1rem" }}>
        <strong>Lagebericht heute:</strong>{" "}
        {!lagebericht.gelaufen ? (
          <>
            noch nicht gelaufen. Steht er abends noch so da, kam heute keine
            Meldung — und das Ausbleiben einer Meldung sieht aus wie „alles
            ruhig“.
          </>
        ) : lagebericht.versendet ? (
          <>
            verschickt
            {lagebericht.begonnen_am
              ? ` um ${zeitpunkt(lagebericht.begonnen_am)}`
              : ""}
            .
          </>
        ) : (
          <>
            gelaufen
            {lagebericht.begonnen_am
              ? ` um ${zeitpunkt(lagebericht.begonnen_am)}`
              : ""}
            , aber <strong>nicht verschickt</strong>. Der Lauf meldet sich,
            die Nachricht nicht.
          </>
        )}
      </p>
    </CockpitKarte>
  );
}
