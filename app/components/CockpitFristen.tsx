import type { FristLage } from "@/lib/kennzahlen";
import {
  CockpitKarte,
  Erklaerung,
  datum,
  euroGenau,
} from "@/components/CockpitKarte";

/**
 * Fristen, die zu verstreichen drohen.
 *
 * Grund fuer den Platz weit oben: Drei Nebenkostenabrechnungen muessen den
 * Mietern bis zum 31.12.2026 ZUGEHEN, sonst sind Nachforderungen
 * ausgeschlossen (§ 556 Abs. 3 Satz 2 BGB). Zu spaet heisst hier nicht
 * "spaeter", sondern das Geld ist weg -- waehrend die Guthaben weiter
 * auszuzahlen sind.
 *
 * Was sich am 03.11.2026 geaendert hat, und warum:
 *
 *   Der Gesetzestext stand als Absatz VOR der ersten Zahl. Er ist richtig und
 *   er ist wichtig -- aber er ist beim zweiten Lesen schon bekannt, und beim
 *   dreissigsten liest man ueber die Karte hinweg. Er steht jetzt wortgleich
 *   in der Erklaerung, deren summary die Aussage traegt.
 *
 *   Jede Frist war ein Block aus Nummer, Titel, Datum und einer Unterzeile
 *   mit Schild, Resttext, Betrag, Grundlage und "haengt an". Sechs Angaben
 *   ueber zwei Zeilen lassen sich nicht ueberfliegen. Aus dem Block ist eine
 *   Zeile geworden: Resttage, Titel, Betrag, Datum. Das "haengt an" ist kein
 *   Merkmal der Frist, sondern ihre Begruendung -- es steht unter der Liste in
 *   der Erklaerung, in der auch die Schwellen erklaert sind.
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
  // Fristen, die an einem Dritten haengen -- Versorger, WEG-Verwaltung. Sie
  // sind der Grund, warum eine Frist mit 50 Resttagen schon kritisch ist.
  const fremd = fristen.filter((f) => f.haengt_an);

  return (
    <CockpitKarte
      titel="Fristen"
      zaehler={
        fristen.length === 0
          ? "keine offen"
          : `${fristen.length} offen, ${dringend.length} dringend`
      }
      erklaerung={
        <Erklaerung satz="Eine Nebenkostenabrechnung muss dem Mieter bis zum Fristtag zugehen — danach ist die Nachforderung weg, das Guthaben bleibt zu zahlen">
          <p className="hinweis">
            § 556 Abs. 3 Satz 2 BGB: Nach Ablauf der Frist ist die
            Nachforderung ausgeschlossen, die Guthaben bleiben zu zahlen. Der
            Postweg gehört also in die Restzeit hinein — die Frist ist mit dem
            Versand nicht erledigt, sondern mit dem Zugang.
          </p>
          <p className="hinweis">
            Deshalb zählt eine Abrechnungsfrist ab 90 Tagen als knapp und nicht
            erst ab 30. Hängt sie zusätzlich an einem Dritten — einem Versorger,
            der Zahlen nachliefern muss, der WEG-Verwaltung —, gilt sie schon ab
            60 Tagen als kritisch: Sie lässt sich am letzten Tag nicht mehr
            selbst erledigen.
          </p>
          {fremd.length > 0 && (
            <ul className="hinweis">
              {fremd.map((f) => (
                <li key={f.bezeichnung + f.faellig_am}>
                  {f.bezeichnung} hängt an: {f.haengt_an}
                  {f.grundlage && <> · {f.grundlage}</>}
                </li>
              ))}
            </ul>
          )}
        </Erklaerung>
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
          {fristen.map((f) => (
            // Stumme Zeile, kein Link: Das Ziel waere das Objekt
            // (frist.objekt_id gibt es), aber ladeFristen in
            // lib/kennzahlen.ts liest die Spalte nicht mit. Bis sie
            // mitgelesen wird, ist die Zeile stumm statt scheinbar klickbar.
            //
            // Genau vier Kinder, in dieser Reihenfolge: .zeile-frist ist ein
            // Raster aus vier Spalten (globals.css), und auf dem Telefon
            // rutscht das Datum unter den Titel. Ein fuenftes Kind -- etwa
            // ein Schild mit dem Wort "kritisch" -- wuerde das Raster
            // sprengen; das Wort steht deshalb im aria-label der Restzeit
            // und die Dringlichkeit zusaetzlich in data-urteil.
            <div
              className="zeile-frist"
              key={f.bezeichnung + f.faellig_am}
              data-urteil={SCHILD[f.dringlichkeit]}
            >
              {/* Resttage als Zahl, weil man eine Spalte Zahlen ueberfliegen
                  kann. Vorgelesen waere "minus drei" nicht zu verstehen --
                  deshalb der ganze Satz im Label. */}
              <span
                className="rest"
                aria-label={`${resttext(f.resttage)} — ${WORTE[f.dringlichkeit]}`}
                title={`${resttext(f.resttage)} — ${WORTE[f.dringlichkeit]}`}
              >
                {f.resttage < 0 ? `−${-f.resttage}` : f.resttage}
              </span>
              <span className="titel">{f.bezeichnung}</span>
              {/* Kein hinterlegter Betrag heisst nicht null Euro. */}
              <span className="betrag">
                {f.betrag ? euroGenau(Number(f.betrag)) : "—"}
              </span>
              <span className="datum">{datum(f.faellig_am)}</span>
            </div>
          ))}
        </div>
      )}
    </CockpitKarte>
  );
}
