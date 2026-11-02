import { CockpitKarte, Kennzahlen, euroGenau } from "@/components/CockpitKarte";

/**
 * Unzugeordnete Zahlungseingaenge.
 *
 * Die unscheinbarste Karte mit der groessten Hebelwirkung: Ein Eingang ohne
 * Zuordnung ist genau der Fall, in dem das Geld da ist und die Verwaltung es
 * nicht sieht. Die Miete gilt dann als offen, der Mieter als saeumig -- und
 * am Ende geht ein Schreiben an jemanden, der gezahlt hat.
 *
 * Deshalb steht hier die Anzahl und nicht nur die Summe: Hundert Euro auf
 * einem Eingang sind eine Kleinigkeit, hundert Eingaenge sind der Grund,
 * warum das Mahnwesen gesperrt bleibt.
 */
export function CockpitZahlungen({
  lage,
}: {
  lage: {
    anzahl: number;
    anzahlMietgross: number;
    summeMietgross: number;
    anzahlGross: number;
    summeGross: number;
    grenze: number;
  };
}) {
  const { anzahl } = lage;
  return (
    <CockpitKarte
      titel="Unzugeordnete Zahlungseingänge"
      zaehler={anzahl === 0 ? "keine" : String(anzahl)}
      hinweis={
        anzahl === 0 ? (
          <>
            Jeder Eingang ist einer Sollstellung zugeordnet. Das ist die
            Voraussetzung dafür, dass „offen“ überhaupt etwas bedeutet.
          </>
        ) : (
          <>
            Ein Eingang ohne Zuordnung gilt als nicht gezahlt. Getrennt wird
            an der höchsten vereinbarten Monatsmiete: Was darüber liegt, kann
            keine einzelne Monatsmiete sein — die Darlehensauszahlung und die
            Einlagen stehen deshalb für sich und nicht in der Arbeitsmenge.
            Eine Sammelzahlung über mehrere Monate kann allerdings auch
            darüber liegen.
          </>
        )
      }
      mehr="/zahlungen"
      mehrText="Zahlungen zuordnen"
    >
      <Kennzahlen
        posten={[
          {
            begriff: "Eingänge",
            wert: String(anzahl),
            art: anzahl > 0 ? "warn" : "gut",
          },
          {
            begriff: "könnte eine Miete sein",
            wert: euroGenau(lage.summeMietgross),
            dazu: `${lage.anzahlMietgross} Eingänge bis ${euroGenau(
              lage.grenze,
            )} — hier liegt die Arbeit`,
            art: lage.anzahlMietgross > 0 ? "warn" : "gut",
          },
          ...(lage.anzahlGross > 0
            ? [
                {
                  begriff: "größer als jede Monatsmiete",
                  wert: euroGenau(lage.summeGross),
                  dazu:
                    `${lage.anzahlGross} Eingänge über ` +
                    `${euroGenau(lage.grenze)} — Darlehen, Einlagen, ` +
                    "Übertrag. Keine einzelne Monatsmiete.",
                },
              ]
            : []),
        ]}
      />
    </CockpitKarte>
  );
}
