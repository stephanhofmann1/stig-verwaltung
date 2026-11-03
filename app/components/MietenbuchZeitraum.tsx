import Link from "next/link";
import {
  leererFilter,
  mietenbuchAdresse,
  type Mietenbuchfilter,
} from "@/lib/mietenbuch";

/**
 * Umschaltung des Ausschnitts: die letzten zwölf Monate oder ein
 * Kalenderjahr.
 *
 * Bewusst Verweise und kein Bedienfeld: Der Ausschnitt steht damit in der
 * Adresse, und ein Blick auf 2024 lässt sich weitergeben, speichern und
 * ausdrucken. Ein Umschalter im Browser könnte das nicht.
 *
 * Die Verweise nehmen den gesetzten Filter mit. Täten sie es nicht, würde
 * ein Klick auf 2024 den Ausschnitt still auf "alles" zurückstellen -- und
 * man vergliche dann einen Jahresblick über alle Häuser mit dem Ausschnitt,
 * den man eben noch vor sich hatte.
 *
 * Die Maße stehen in app/raster.css (.mb-zeitraum). Vorher waren sie
 * Inline-Stile -- und damit außerhalb des Gestaltungssystems.
 */
export function MietenbuchZeitraum({
  jahr,
  jahre,
  filter = leererFilter(),
}: {
  /** Das gewählte Kalenderjahr, oder null für die letzten zwölf Monate. */
  jahr: number | null;
  /** Die Jahre, für die es Daten geben kann. */
  jahre: number[];
  /** Der gesetzte Filter -- bleibt beim Wechsel des Zeitraums stehen. */
  filter?: Mietenbuchfilter;
}) {
  return (
    <nav aria-label="Zeitraum" className="mb-zeitraum">
      <span className="kennzahl-schild mb-zeitraum-schild">Zeitraum</span>
      <Link
        href={mietenbuchAdresse(filter, null)}
        className="schild"
        data-art={jahr === null ? "info" : undefined}
        aria-current={jahr === null ? "page" : undefined}
      >
        letzte 12 Monate
      </Link>
      {jahre.map((j) => (
        <Link
          key={j}
          href={mietenbuchAdresse(filter, j)}
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
