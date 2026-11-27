import type { LeerstandsLage } from "@/lib/kennzahlen";
import {
  CockpitKarte,
  Erklaerung,
  Kennzahlen,
  datum,
} from "@/components/CockpitKarte";

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
 *
 * Am 03.11.2026 behoben: Bei `gesamt === 0` stand im Zaehler "keine Daten"
 * und darunter trotzdem "frei 0 · frei in 3 Monaten 0 · belegt 0". Drei
 * Nullen sind drei Behauptungen -- und die mittlere ("in drei Monaten laeuft
 * nichts aus") ist die, nach der man keinen Nachmieter sucht. Wo nichts
 * gelesen wurde, steht jetzt keine Zahl.
 */
export function CockpitLeerstand({ lage }: { lage: LeerstandsLage }) {
  const liste = [
    ...lage.frei.map((e) => ({ ...e, art: "frei" as const })),
    ...lage.bald.map((e) => ({ ...e, art: "bald" as const })),
  ];

  if (lage.gesamt === 0) {
    return (
      <CockpitKarte titel="Leerstand" zaehler="keine Daten">
        <div className="leer">
          <strong>Es konnten keine Einheiten gelesen werden</strong>
          Über frei, bald frei und belegt ist deshalb nichts bekannt. Zu
          prüfen unter Einheiten &amp; Mieter.
        </div>
      </CockpitKarte>
    );
  }

  return (
    <CockpitKarte
      titel="Leerstand"
      zaehler={`${lage.frei.length} frei, ${lage.bald.length} bald frei`}
      hinweis={`Bezogen auf ${lage.gesamt} vermarktbare Einheiten.`}
      erklaerung={
        <Erklaerung satz="Wie gezählt wird">
          <p className="hinweis">
            Gezählt werden nur Einheiten, die vermietet werden. Nicht dabei
            sind Gemeinschaftsflächen, Flächen, die nicht angeboten werden
            (etwa das Gewerbe), und die WG-Etagen selbst, die ihre Zimmer
            unter sich haben.
          </p>
          <p className="hinweis">
            Aus fehlenden Daten entsteht nie „frei“: Eine Einheit ohne
            gepflegte Belegung zählt als belegt. Lieber ein freies Zimmer nicht
            anbieten als ein bewohntes.
          </p>
        </Erklaerung>
      }
    >
      <Kennzahlen
        posten={[
          {
            begriff: "Frei",
            wert: String(lage.frei.length),
            art: lage.frei.length > 0 ? "warn" : "gut",
          },
          {
            begriff: "Frei in 3 Monaten",
            wert: String(lage.bald.length),
            dazu: "aus Kündigung oder Mietende",
          },
          { begriff: "Belegt", wert: String(lage.belegt) },
        ]}
      />

      {liste.length === 0 ? (
        <p className="hinweis">
          Alles vermietet, und in den nächsten drei Monaten läuft nichts aus.
        </p>
      ) : (
        <div className="register">
          {liste.map((e) => (
            // Ziel waere die Einheit, aber verfuegbarkeit() liefert nur
            // Namen, keine Kennung -- dieselbe Antwort geht an die
            // Objektwebsite, und dort hat eine Kennung nichts zu suchen.
            // Ein freies Zimmer verlangt eine Handlung -- die Kante links
            // sagt das (data-urteil, globals.css). Was erst bald frei wird,
            // bleibt unmarkiert, solange ein Termin zugesagt ist.
            <div
              className="posten"
              data-still="ja"
              key={e.objekt + e.einheit}
              data-urteil={
                e.art === "frei"
                  ? "handlung"
                  : e.frei_ab === null
                    ? "warn"
                    : undefined
              }
            >
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
