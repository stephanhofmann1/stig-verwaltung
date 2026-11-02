import type { LeerstandsLage } from "@/lib/kennzahlen";
import { CockpitKarte, Kennzahlen, datum } from "@/components/CockpitKarte";

/**
 * Leerstand und was in den naechsten drei Monaten frei wird.
 *
 * Die Belegung kommt aus verfuegbarkeit() in lib/oeffentlich.ts -- aus
 * derselben Ableitung, die auch die Objektwebsite speist. Zwei
 * Belegungslogiken laufen auseinander, und im September 2026 hat genau das
 * vermietete Zimmer oeffentlich als frei angeboten.
 *
 * Zwei Dinge gehoeren deshalb in den Hinweis:
 *
 *   1. Gezaehlt werden nur vermarktbare Einheiten. Gemeinschaftsflaechen,
 *      die Gewerbeflaeche (vermarktung = 'nicht_anbieten') und die
 *      WG-Etagen selbst (sie haben Zimmer unter sich) sind nicht dabei --
 *      die Zahl ist also kleiner als die Zahl aller Einheiten.
 *   2. Aus fehlenden Daten entsteht nie "frei". Eine Einheit ohne gepflegte
 *      Belegung gilt als belegt. Der Leerstand ist damit eher zu niedrig als
 *      zu hoch, und das ist die gewollte Richtung.
 */
export function CockpitLeerstand({ lage }: { lage: LeerstandsLage }) {
  const liste = [
    ...lage.frei.map((e) => ({ ...e, art: "frei" as const })),
    ...lage.bald.map((e) => ({ ...e, art: "bald" as const })),
  ];

  return (
    <CockpitKarte
      titel="Leerstand"
      zaehler={
        lage.gesamt === 0
          ? "keine Daten"
          : `${lage.frei.length} frei, ${lage.bald.length} bald frei`
      }
      hinweis={
        <>
          Bezogen auf {lage.gesamt} vermarktbare Einheiten — ohne
          Gemeinschaftsflächen, ohne die Gewerbefläche und ohne die WG-Etagen
          selbst. Eine Einheit, deren Belegung nicht gepflegt ist, zählt als
          belegt: Lieber ein freies Zimmer nicht anbieten als ein bewohntes.
        </>
      }
    >
      <Kennzahlen
        posten={[
          {
            begriff: "frei",
            wert: String(lage.frei.length),
            art: lage.frei.length > 0 ? "warn" : "gut",
          },
          {
            begriff: "frei in 3 Monaten",
            wert: String(lage.bald.length),
            dazu: "aus Kündigung oder Mietende",
          },
          { begriff: "belegt", wert: String(lage.belegt) },
        ]}
      />

      {liste.length === 0 ? (
        <p className="hinweis">
          {lage.gesamt === 0
            ? "Es konnten keine Einheiten gelesen werden."
            : "Alles vermietet, und in den nächsten drei Monaten läuft nichts aus."}
        </p>
      ) : (
        <div className="register">
          {liste.map((e) => (
            <div className="posten" key={e.objekt + e.einheit}>
              <span className="nummer">{e.art === "frei" ? "frei" : "bald"}</span>
              <span className="betreff">{e.einheit}</span>
              <span className="zeit">
                {e.art === "frei"
                  ? "ab sofort"
                  : e.frei_ab
                    ? `ab ${datum(e.frei_ab)}`
                    : "Termin offen"}
              </span>
              <span className="unterzeile">
                <span>{e.objekt}</span>
                {/* Woertlich der Text aus vermarktungshinweis -- er geht auch
                    in die Anschreiben der Lead-Automation. */}
                {e.hinweis && <span>{e.hinweis}</span>}
                {e.art === "bald" && e.frei_ab === null && (
                  <span className="marker" data-art="warn">
                    kein Datum zugesagt
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </CockpitKarte>
  );
}
