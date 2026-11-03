import {
  CockpitKarte,
  Erklaerung,
  Kennzahlen,
  euroGenau,
} from "@/components/CockpitKarte";

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
 *
 * Am 03.11.2026 behoben: Bei null Eingaengen stand "0 Eingänge bis 0 € —
 * hier liegt die Arbeit" auf der Karte. Der Satz gehoert zu einer
 * Arbeitsmenge; ohne Arbeitsmenge ist er Dekoration, und eine Karte, die
 * Dekoration zeigt, lernt man zu ueberlesen. Zweitens hiess ein Bestand ohne
 * jeden Kontoumsatz hier "jeder Eingang ist zugeordnet" -- eine Null, die
 * "nichts eingelesen" bedeutet, als Erfolg gemeldet.
 */
export function CockpitZahlungen({
  lage,
  umsaetze,
}: {
  lage: {
    anzahl: number;
    anzahlMietgross: number;
    summeMietgross: number;
    anzahlGross: number;
    summeGross: number;
    grenze: number;
  };
  /**
   * Liegen ueberhaupt Kontoumsaetze vor? Ohne sie ist `anzahl === 0` keine
   * Leistung, sondern eine fehlende Grundlage.
   */
  umsaetze: boolean;
}) {
  const { anzahl } = lage;

  if (!umsaetze) {
    return (
      <CockpitKarte
        titel="Unzugeordnete Zahlungseingänge"
        zaehler="keine Umsätze"
        mehr="/konten"
        mehrText="Konten und Bankabruf"
      >
        <div className="leer">
          <strong>
            In den letzten zwölf Monaten sind keine Kontoumsätze eingelesen
          </strong>
          Ohne Umsätze gibt es nichts zuzuordnen — und „0 unzugeordnet“ wäre
          hier kein erledigter Abgleich, sondern eine fehlende Grundlage. Auch
          jedes „offen“ und „bezahlt“ auf dieser Seite hängt daran.
        </div>
      </CockpitKarte>
    );
  }

  return (
    <CockpitKarte
      titel="Unzugeordnete Zahlungseingänge"
      zaehler={anzahl === 0 ? "keine" : String(anzahl)}
      hinweis={
        anzahl === 0
          ? "Jeder Eingang ist einer Sollstellung zugeordnet."
          : "Ein Eingang ohne Zuordnung gilt als nicht gezahlt."
      }
      erklaerung={
        anzahl === 0 ? (
          <Erklaerung satz="Warum diese Null die wichtigste der Seite ist">
            <p className="hinweis">
              Ein zugeordneter Eingang ist die Voraussetzung dafür, dass
              „offen“ überhaupt etwas bedeutet. Solange Eingänge unzugeordnet
              liegen, gilt gezahlte Miete als Rückstand — und am Ende geht ein
              Schreiben an jemanden, der gezahlt hat.
            </p>
          </Erklaerung>
        ) : (
          <Erklaerung satz="Getrennt wird an der höchsten vereinbarten Monatsmiete — was darüber liegt, kann keine einzelne Miete sein">
            <p className="hinweis">
              Auf dem Konto liegen neben Mieten auch die Darlehensauszahlung und
              Gesellschaftereinlagen. Zusammengerechnet stünde hier eine Summe
              in Millionenhöhe neben dem Satz „jeder einzelne davon kann eine
              Miete sein“ — für fast den ganzen Betrag falsch. Die Grenze von{" "}
              {euroGenau(lage.grenze)} ist deshalb nicht gewählt, sondern
              abgeleitet.
            </p>
            <p className="hinweis">
              Eine Sammelzahlung über mehrere Monate kann allerdings auch
              darüber liegen. Darum heißt die Spalte „könnte eine Miete sein“
              und nicht „ist keine“.
            </p>
          </Erklaerung>
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
            // "Hier liegt die Arbeit" nur, wenn es Arbeit gibt.
            dazu:
              lage.anzahlMietgross > 0
                ? `${lage.anzahlMietgross} Eingänge bis ${euroGenau(
                    lage.grenze,
                  )} — hier liegt die Arbeit`
                : `kein offener Eingang bis ${euroGenau(lage.grenze)}`,
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
