import { erzeugeSollstellungen, type SollLauf } from "@/lib/sollstellung";
import { uebernehmeSichere } from "@/lib/zuordnung";
import { fuerAlleMandanten, pruefeSchluessel } from "@/lib/aufgabenlauf";
import { query } from "@/lib/db";

/**
 * Monatslauf: stellt die fälligen Mieten und ordnet danach die
 * eindeutigen Eingänge zu. Läuft zusammen mit den anderen Aufgaben.
 */
export async function POST(req: Request) {
  return (
    pruefeSchluessel(req) ??
    fuerAlleMandanten(
      "sollstellungen",
      async () => {
        const soll = await erzeugeSollstellungen();
        const zuordnung = await uebernehmeSichere();
        // Altes Protokoll wegräumen. Hier und nicht in einem eigenen Lauf:
        // ein zusätzlicher Zeitplan-Eintrag für drei gelöschte Zeilen wäre
        // mehr Technik als Nutzen.
        const protokollWeg = await query<{ weg: number }>(
          "SELECT lauf_aufraeumen(90) AS weg",
        );
        return {
          soll,
          zuordnung,
          protokoll_aufgeraeumt: protokollWeg[0]?.weg ?? 0,
        };
      },
      hinweise,
    )
  );
}

/**
 * Was ein Mensch nach diesem Lauf ansehen muss, obwohl er geklappt hat.
 *
 * Eine Mietabweichung ist entweder ein Tippfehler in den Stammdaten oder
 * eine Mieterhöhung, die nur an einer Stelle nachgetragen wurde. Gestellt
 * wird die Zusage aus dem Vertrag — aber welcher der beiden Fälle vorliegt,
 * kann die Software nicht entscheiden, und stillschweigend weiterrechnen
 * heißt, den Fehler jeden Monat zu wiederholen.
 */
function hinweise(wert: {
  soll: SollLauf;
  zuordnung: unknown;
}): string[] {
  const euro = (n: number) =>
    new Intl.NumberFormat("de-DE", {
      style: "currency",
      currency: "EUR",
    }).format(n);

  return wert.soll.abweichungen.map(
    (a) =>
      `Miete weicht ab: ${a.kontakt_name}, ${a.einheit} — ` +
      `Vertrag ${euro(a.zugesagt)}, Einzelposten ${euro(a.summe_posten)}. ` +
      `Gestellt wurde ${euro(a.zugesagt)}.`,
  );
}
