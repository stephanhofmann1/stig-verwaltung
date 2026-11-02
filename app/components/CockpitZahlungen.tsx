import { CockpitKarte, Kennzahlen, euroGenau } from "@/components/CockpitKarte";

/**
 * Unzugeordnete Zahlungseingaenge.
 *
 * Die unscheinbarste Karte und die mit der groessten Hebelwirkung: Ein
 * Eingang ohne Zuordnung ist genau der Fall, in dem das Geld da ist und die
 * Verwaltung es nicht sieht. Die Miete gilt dann als offen, der Mieter als
 * saeumig -- und am Ende geht ein Schreiben an jemanden, der gezahlt hat.
 *
 * Deshalb steht hier die Anzahl und nicht nur die Summe: Hundert Euro auf
 * einem Eingang sind eine Kleinigkeit, hundert Eingaenge sind der Grund,
 * warum das Mahnwesen gesperrt bleibt.
 */
export function CockpitZahlungen({
  anzahl,
  summe,
}: {
  anzahl: number;
  summe: number;
}) {
  return (
    <CockpitKarte
      titel="Unzugeordnete Zahlungseingänge"
      zaehler={anzahl === 0 ? "keine" : `${anzahl}`}
      hinweis={
        anzahl === 0 ? (
          <>
            Jeder Eingang ist einer Sollstellung zugeordnet. Das ist die
            Voraussetzung dafür, dass „offen“ überhaupt etwas bedeutet.
          </>
        ) : (
          <>
            Jeder einzelne davon kann eine Miete sein, die ohne Zuordnung als
            Rückstand gilt. Zuordnen, bevor irgendetwas gemahnt wird.
          </>
        )
      }
      mehr="/zahlungen"
      mehrText="Zahlungen zuordnen"
    >
      <Kennzahlen
        posten={[
          { begriff: "Eingänge", wert: String(anzahl) },
          {
            begriff: "noch nicht zugeordnet",
            wert: euroGenau(summe),
            dazu: "Restbetrag der offenen Eingänge",
          },
        ]}
      />
    </CockpitKarte>
  );
}
