import type { FristLage } from "@/lib/kennzahlen";
import { CockpitKarte, datum, euroGenau } from "@/components/CockpitKarte";

/**
 * Fristen, die zu verstreichen drohen -- die oberste Karte des Cockpits.
 *
 * Grund fuer den Platz: Drei Nebenkostenabrechnungen muessen den Mietern bis
 * zum 31.12.2026 ZUGEHEN, sonst sind Nachforderungen ausgeschlossen
 * (§ 556 Abs. 3 Satz 2 BGB). Zu spaet heisst hier nicht "spaeter", sondern
 * das Geld ist weg -- waehrend die Guthaben weiter auszuzahlen sind.
 *
 * "Zugehen" und nicht "fertig sein": Die Frist ist mit dem Versand nicht
 * erledigt, sondern mit dem Zugang. Der Postweg gehoert in die Restzeit
 * hinein, und deshalb steht es so im Hinweis.
 */

const WORTE: Record<FristLage["dringlichkeit"], string> = {
  verstrichen: "verstrichen",
  kritisch: "kritisch",
  knapp: "wird knapp",
  ruhig: "Zeit",
};

const SCHILD: Record<FristLage["dringlichkeit"], string | undefined> = {
  verstrichen: "fehl",
  kritisch: "fehl",
  knapp: "warn",
  ruhig: undefined,
};

function resttext(resttage: number): string {
  if (resttage < 0) return `seit ${-resttage} Tagen verstrichen`;
  if (resttage === 0) return "heute";
  if (resttage === 1) return "morgen";
  return `in ${resttage} Tagen`;
}

export function CockpitFristen({ fristen }: { fristen: FristLage[] }) {
  const dringend = fristen.filter(
    (f) => f.dringlichkeit === "verstrichen" || f.dringlichkeit === "kritisch",
  );

  return (
    <CockpitKarte
      titel="Fristen"
      zaehler={
        fristen.length === 0
          ? "keine offen"
          : `${fristen.length} offen, ${dringend.length} dringend`
      }
      hinweis={
        <>
          Eine Nebenkostenabrechnung muss dem Mieter bis zum Fristtag{" "}
          <strong>zugehen</strong> — § 556 Abs. 3 Satz 2 BGB. Danach ist die
          Nachforderung ausgeschlossen, die Guthaben bleiben zu zahlen. Der
          Postweg gehört also in die Restzeit hinein.
        </>
      }
    >
      {fristen.length === 0 ? (
        <div className="leer">
          <strong>Keine offene Frist eingetragen</strong>
          Fristen stehen in der Tabelle <code>frist</code>. Steht hier nichts,
          ist entweder alles erledigt — oder es hat nie jemand eingetragen.
        </div>
      ) : (
        <div className="register">
          {fristen.map((f) => {
            const scharf =
              f.dringlichkeit === "verstrichen" || f.dringlichkeit === "kritisch";
            return (
              // Das Ziel waere das Objekt (frist.objekt_id gibt es), aber
              // ladeFristen in lib/kennzahlen.ts liest die Spalte nicht mit.
              // Bis sie mitgelesen wird, ist die Zeile stumm statt
              // scheinbar klickbar.
              <div
                className="posten"
                data-still="ja"
                key={f.bezeichnung + f.faellig_am}
                data-heikel={scharf ? "ja" : "nein"}
              >
                <span className="nummer">
                  {f.resttage < 0 ? `−${-f.resttage}` : f.resttage}
                </span>
                <span className="betreff">{f.bezeichnung}</span>
                <span className="zeit">{datum(f.faellig_am)}</span>
                <span className="unterzeile">
                  <span className="marker" data-art={SCHILD[f.dringlichkeit]}>
                    {WORTE[f.dringlichkeit]}
                  </span>
                  <span>{resttext(f.resttage)}</span>
                  {f.betrag && (
                    <span className="betrag">{euroGenau(Number(f.betrag))}</span>
                  )}
                  {f.grundlage && <span>{f.grundlage}</span>}
                  {f.haengt_an && <span>hängt an: {f.haengt_an}</span>}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </CockpitKarte>
  );
}
