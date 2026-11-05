import type { AutomatikPosten, LageberichtLage, LaufLage } from "@/lib/kennzahlen";
import { CockpitKarte, Erklaerung } from "@/components/CockpitKarte";

/**
 * Zustand der Automatik.
 *
 * Der Grund, warum das aufs Cockpit gehoert und nicht nur unter /laeufe: Ein
 * Lauf, der seit drei Wochen an einem abgelaufenen Token scheitert, verhaelt
 * sich nach aussen genauso wie einer, der nichts zu tun hatte -- beide
 * schweigen. Auffallen wuerde es erst, wenn sich ein Mieter beschwert, dass
 * niemand auf seine Mail geantwortet hat.
 *
 * Zwei Zustaende sind besonders hinterhaeltig und stehen deshalb
 * ausdruecklich da:
 *
 *   "steht"   Der letzte Lauf meldet ok, ist aber von vorgestern. Dann sind
 *             auch alle anderen Zahlen dieser Seite von vorgestern.
 *   Serie     Mehrere Fehllaeufe hintereinander. Ein einmaliger Umfaller ist
 *             kein Grund, etwas zu tun; eine Serie schon.
 */

const WORTE: Record<LaufLage, string> = {
  nie: "noch nie gelaufen",
  steht: "steht",
  gescheitert: "gescheitert",
  hinweise: "mit Hinweis",
  ok: "ok",
};

const PUNKT: Record<LaufLage, string> = {
  nie: "fehl",
  steht: "fehl",
  gescheitert: "fehl",
  hinweise: "warn",
  ok: "gut",
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
          Die nächtlichen Läufe aus der Tabelle <code>lauf</code>.
        </>
      }
      erklaerung={
        <Erklaerung satz="Ein „ok“ von vorgestern ist kein ok — dann sind auch alle anderen Zahlen dieser Seite von vorgestern">
          <p className="hinweis">
            Ein Lauf, der seit drei Wochen an einem abgelaufenen Token
            scheitert, verhält sich nach außen genauso wie einer, der nichts zu
            tun hatte: Beide schweigen. Auffallen würde es erst, wenn sich ein
            Mieter beschwert, dass niemand auf seine Mail geantwortet hat.
          </p>
          <p className="hinweis">
            Zwei Zustände sind deshalb ausdrücklich benannt.{" "}
            <strong>Steht</strong> heißt: Der letzte Lauf meldet ok, ist aber
            älter als 26 Stunden — dann erreicht der Zeitplaner die Anwendung
            nicht. Eine <strong>Serie</strong> sind mehrere Fehlläufe
            hintereinander; ein einmaliger Umfaller ist kein Grund, etwas zu
            tun, eine Serie schon.
          </p>
        </Erklaerung>
      }
      mehr="/laeufe"
      mehrText="Läufe im Verlauf"
    >
      {dauerhaft.length > 0 && (
        <div className="meldung" data-art="fehler">
          <strong>Das scheitert nicht einmal, das scheitert dauerhaft</strong>
          {dauerhaft
            .map((p) =>
              p.lage === "nie"
                ? `${p.name} ist noch nie gelaufen`
                : `${p.name} scheitert ${p.serie} Läufe hintereinander`,
            )
            .join("; ")}
          .
        </div>
      )}

      <div className="register">
        {posten.map((p) => {
          return (
            // Ein Lauf ist eine Meldung, kein Ort. Der Weg in den Verlauf
            // steht einmal unter der Karte und nicht in jeder Zeile.
            //
            // data-urteil statt data-heikel: Die Kante links traegt die Farbe
            // des Urteils (globals.css), und ein Lauf hat genau das --
            // gescheitert, mit Hinweis, ok. "Heikel" ist eine Eigenschaft von
            // Vorgaengen, nicht von Laeufen.
            <div
              className="posten"
              data-still="ja"
              key={p.name}
              data-urteil={PUNKT[p.lage]}
            >
              {/* Nur Farbe, kein Inhalt: Das Wort steht als Schild in der
                  Unterzeile und wird vorgelesen. */}
              <span className="nummer" aria-hidden="true">
                <span className="punkt" data-art={PUNKT[p.lage]} />
              </span>
              <span className="betreff">{p.name}</span>
              <span className="zeit">
                {p.begonnen_am ? zeitpunkt(p.begonnen_am) : "nie"}
              </span>
              <span className="unterzeile">
                <span className="marker" data-art={PUNKT[p.lage]}>
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
          Zeitplaner ist grün, auf dem Telefon kommt nichts an. */}
      {lagebericht.versendet ? (
        <p className="hinweis">
          <strong>Lagebericht heute:</strong> verschickt
          {lagebericht.begonnen_am
            ? ` um ${zeitpunkt(lagebericht.begonnen_am)}`
            : ""}
          .
        </p>
      ) : (
        <div className="meldung" data-art="warnung">
          <strong>
            Lagebericht heute:{" "}
            {lagebericht.gelaufen ? "nicht verschickt" : "noch nicht gelaufen"}
          </strong>
          {lagebericht.gelaufen ? (
            <>
              Der Lauf hat sich gemeldet
              {lagebericht.begonnen_am
                ? ` (${zeitpunkt(lagebericht.begonnen_am)})`
                : ""}
              , die Nachricht nicht. Auf dem Telefon kommt heute nichts an.
            </>
          ) : (
            <>
              Steht das abends noch so da, kam heute keine Meldung — und das
              Ausbleiben einer Meldung sieht aus wie „alles ruhig“.
            </>
          )}
        </div>
      )}
    </CockpitKarte>
  );
}
