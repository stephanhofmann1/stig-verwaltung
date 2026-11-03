import Link from "next/link";

/**
 * Umschaltung des Ausschnitts: die letzten zwölf Monate oder ein
 * Kalenderjahr.
 *
 * Bewusst Verweise und kein Bedienfeld: Der Ausschnitt steht damit in der
 * Adresse, und ein Blick auf 2024 lässt sich weitergeben, speichern und
 * ausdrucken. Ein Umschalter im Browser könnte das nicht.
 *
 * Die Maße stehen in app/raster.css (.mb-zeitraum). Vorher waren sie
 * Inline-Stile -- und damit außerhalb des Gestaltungssystems.
 */
export function MietenbuchZeitraum({
  jahr,
  jahre,
}: {
  /** Das gewählte Kalenderjahr, oder null für die letzten zwölf Monate. */
  jahr: number | null;
  /** Die Jahre, für die es Daten geben kann. */
  jahre: number[];
}) {
  return (
    <nav aria-label="Zeitraum" className="mb-zeitraum">
      <span className="kennzahl-schild mb-zeitraum-schild">Zeitraum</span>
      <Link
        href="/mietenbuch"
        className="schild"
        data-art={jahr === null ? "info" : undefined}
        aria-current={jahr === null ? "page" : undefined}
      >
        letzte 12 Monate
      </Link>
      {jahre.map((j) => (
        <Link
          key={j}
          href={`/mietenbuch?jahr=${j}`}
          className="schild"
          data-art={jahr === j ? "info" : undefined}
          aria-current={jahr === j ? "page" : undefined}
        >
          {j}
        </Link>
      ))}
    </nav>
  );
}
