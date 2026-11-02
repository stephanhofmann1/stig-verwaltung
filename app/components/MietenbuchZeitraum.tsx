import Link from "next/link";

/**
 * Umschaltung des Ausschnitts: die letzten zwölf Monate oder ein
 * Kalenderjahr.
 *
 * Bewusst Verweise und kein Bedienfeld: Der Ausschnitt steht damit in der
 * Adresse, und ein Blick auf 2024 lässt sich weitergeben, speichern und
 * ausdrucken. Ein Umschalter im Browser könnte das nicht.
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
    <nav
      aria-label="Zeitraum"
      style={{
        display: "flex",
        gap: "0.375rem",
        flexWrap: "wrap",
        alignItems: "baseline",
      }}
    >
      <span className="kennzahl-schild" style={{ marginRight: "0.25rem" }}>
        Zeitraum
      </span>
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
