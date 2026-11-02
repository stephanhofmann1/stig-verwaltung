import Link from "next/link";

/**
 * Das Gehaeuse einer Cockpit-Karte und die Formate, die alle Karten teilen.
 *
 * Gestaltet wird hier nichts: Die Karten benutzen die Klassen aus
 * globals.css -- karte, karten, kennzahl, kennzahl-schild, kennzahl-wert,
 * meldung, marker, register, posten, leer, hinweis, betrag. An der
 * Gestaltung arbeitet jemand anderes; eigene Farben und Abstaende hier
 * wuerden seine Arbeit ueberschreiben und beim naechsten Durchgang
 * auseinanderfallen.
 *
 * Die einzige Ausnahme ist `margin: 0` an den Ueberschriften: globals.css
 * nullt den Abstand nur fuer `.titelzeile h1`, und die Karten tragen h2 --
 * zwei h1 auf einer Seite waeren fuer einen Screenreader zwei Seiten.
 */

export const euro = (w: number) =>
  new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(w);

export const euroGenau = (w: number) =>
  new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(w);

/** "November 2026" aus "2026-11-01" oder "2026-11". */
export const monatsName = (iso: string) =>
  new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(
    new Date(iso.slice(0, 7) + "-01T12:00:00Z"),
  );

/** "Nov 26" -- fuer Achsenbeschriftungen. */
export const monatKurz = (iso: string) =>
  new Intl.DateTimeFormat("de-DE", { month: "short", year: "2-digit" }).format(
    new Date(iso.slice(0, 7) + "-01T12:00:00Z"),
  );

export const datum = (iso: string | null) =>
  iso === null
    ? "—"
    : new Intl.DateTimeFormat("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }).format(new Date(iso.slice(0, 10) + "T12:00:00Z"));

/** Verweis als Schild — ein Link ohne Unterstreichung waere kein Link. */
export function Verweis({ nach, children }: { nach: string; children: React.ReactNode }) {
  return (
    <Link href={nach} className="marker" data-art="info">
      {children}
    </Link>
  );
}

export function CockpitKarte({
  titel,
  zaehler,
  hinweis,
  mehr,
  mehrText,
  children,
}: {
  titel: string;
  /** Rechts in der Titelzeile: die eine Zahl, auf die es ankommt. */
  zaehler?: string;
  /** Ein Satz darunter — was die Karte zeigt und was sie nicht zeigt. */
  hinweis?: React.ReactNode;
  mehr?: string;
  mehrText?: string;
  children: React.ReactNode;
}) {
  const id = "karte-" + titel.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return (
    <section aria-labelledby={id}>
      <div className="titelzeile">
        <h2 id={id} style={{ margin: 0 }}>
          {titel}
        </h2>
        {zaehler && <span className="zaehler">{zaehler}</span>}
      </div>
      {hinweis && <p className="hinweis">{hinweis}</p>}
      {children}
      {mehr && (
        <p className="hinweis">
          <Verweis nach={mehr}>{mehrText ?? "ansehen"}</Verweis>
        </p>
      )}
    </section>
  );
}

export type Art = "gut" | "warn" | "fehl" | undefined;

export interface Kennzahl {
  begriff: string;
  /** null = keine Zahl. Steht dort ein Gedankenstrich, ist das die Aussage. */
  wert: string | null;
  dazu?: string;
  art?: Art;
}

/**
 * Eine Reihe Kennzahlen.
 *
 * `dl` und nicht `table`: Das sind Begriff und Wert, keine Matrix. Ein Wert
 * darf null sein -- dann steht dort ein Gedankenstrich, und das ist die
 * ehrlichere Angabe als eine Null, die als "nichts offen" gelesen wuerde.
 */
export function Kennzahlen({ posten }: { posten: Kennzahl[] }) {
  return (
    <dl className="karten">
      {posten.map((p) => (
        <div className="karte kennzahl" key={p.begriff}>
          <dt className="kennzahl-schild">{p.begriff}</dt>
          <dd className="kennzahl-wert" data-art={p.art} style={{ margin: 0 }}>
            {p.wert ?? "—"}
          </dd>
          {p.dazu && (
            <dd className="hinweis" style={{ margin: 0 }}>
              {p.dazu}
            </dd>
          )}
        </div>
      ))}
    </dl>
  );
}
