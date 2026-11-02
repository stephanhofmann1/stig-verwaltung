import type { MonatsGeld } from "@/lib/kennzahlen";
import {
  CockpitKarte,
  Kennzahlen,
  Verweis,
  euroGenau,
  monatsName,
} from "@/components/CockpitKarte";

/**
 * Geld im laufenden Monat.
 *
 * Die Zahlen kommen aus den Sollstellungen und den Zuordnungen, der Status
 * je Monat aus monatsStatus() in lib/mieter.ts. Dort steckt die
 * Unterscheidung, auf die es ankommt:
 *
 *   offen              faellig, Kontodaten vorhanden, nichts angekommen
 *   nicht abgeglichen  es gibt fuer diesen Monat keine Kontodaten
 *
 * Das zweite ist keine Aussage ueber Geld, sondern ueber Unterlagen. Als
 * "offen" angezeigt waere es eine Beschuldigung -- und bei uebernommenen
 * Altmietern eine falsche: Abgerechnet wird ab einem Monat, fuer den es
 * noch gar keine Kontoumsaetze gibt, weil die Mieten davor dem
 * Voreigentuemer zuflossen.
 *
 * Deshalb zeigt diese Karte lieber nichts an als eine Null. Ist der Monat
 * nicht abgeglichen, steht genau das an der Stelle, an der sonst der offene
 * Betrag stuende.
 */
export function CockpitMonat({
  monat,
  geld,
}: {
  monat: string;
  geld: MonatsGeld;
}) {
  // Noch keine Sollstellungen: Der Nachtlauf erzeugt sie. Eine Null waere
  // hier die Aussage "alles bezahlt", und die ist frei erfunden.
  if (geld.anzahl === 0) {
    return (
      <CockpitKarte titel={`Geld im ${monatsName(monat)}`} zaehler="keine Daten">
        <div className="leer">
          <strong>Noch keine Sollstellungen für diesen Monat</strong>
          Sie werden nachts erzeugt. Solange keine da sind, lässt sich über
          Soll, bezahlt und offen nichts sagen — eine Null wäre hier die
          Behauptung, es sei alles bezahlt.
        </div>
      </CockpitKarte>
    );
  }

  return (
    <CockpitKarte
      titel={`Geld im ${monatsName(monat)}`}
      zaehler={`${geld.anzahl} Sollstellungen`}
      hinweis={
        geld.belastbar ? (
          <>
            Offen heißt: fällig, Kontoumsätze liegen vor, es ist nichts
            angekommen. Monate ohne Kontodaten stehen getrennt und werden nicht
            dazugezählt.
          </>
        ) : (
          <>
            Für keinen dieser Posten liegen Kontodaten vor. Über offene Beträge
            ist damit keine Aussage möglich.
          </>
        )
      }
      mehr="/mietenbuch"
      mehrText="Mietenbuch"
    >
      <Kennzahlen
        posten={[
          { begriff: "Soll", wert: euroGenau(geld.soll) },
          {
            begriff: "davon bezahlt",
            wert: euroGenau(geld.bezahlt),
            dazu:
              geld.soll > 0
                ? `${Math.round((geld.bezahlt / geld.soll) * 100)} % des Solls`
                : undefined,
            art: geld.soll > 0 && geld.bezahlt >= geld.soll ? "gut" : undefined,
          },
          {
            begriff: "offen",
            // Der entscheidende Zweig: ohne Kontodaten keine Zahl.
            wert: geld.belastbar ? euroGenau(geld.offen) : null,
            dazu: geld.belastbar
              ? geld.offen > 0
                ? `${geld.offenBetroffen} ${
                    geld.offenBetroffen === 1
                      ? "Mietverhältnis"
                      : "Mietverhältnisse"
                  }`
                : "nichts fällig und unbezahlt"
              : "Monat nicht abgeglichen",
            art: !geld.belastbar
              ? undefined
              : geld.offen > 0
                ? "warn"
                : "gut",
          },
          {
            begriff: "noch nicht fällig",
            wert: euroGenau(geld.nochNichtFaellig),
            dazu: "Schonfrist bis zum 3. Werktag",
          },
        ]}
      />

      {geld.unabgeglichenAnzahl > 0 && (
        <div className="meldung" data-art="info">
          <strong>
            {euroGenau(geld.unabgeglichen)} aus {geld.unabgeglichenAnzahl} Posten
            ohne Kontodaten
          </strong>
          Das ist kein Rückstand, sondern eine fehlende Unterlage: Für diese
          Monate liegen keine Kontoauszüge vor. Objekte ohne eigenes Konto
          haben überhaupt keine — dort ist jeder Monat so. Ab welchem Tag die
          Kontodaten eines Objekts reichen, steht bei den Konten.{" "}
          <Verweis nach="/konten">Konten</Verweis>
        </div>
      )}
    </CockpitKarte>
  );
}
