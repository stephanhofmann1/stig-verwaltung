import Link from "next/link";

/**
 * Das Gehaeuse einer Cockpit-Karte und die Formate, die alle Karten teilen.
 *
 * Gestaltet wird hier nichts: Die Karten benutzen die Klassen aus
 * globals.css -- karte, karten, kennzahl, kennzahl-schild, kennzahl-wert,
 * erklaerung, zeile-frist, verweis, meldung, marker, register, posten, leer,
 * hinweis, betrag. An der
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

/**
 * Verweis als eigene Form -- `marker` war die falsche: Damit sind sonst
 * Zustaende gekennzeichnet ("kritisch", "bezahlt"). Der Kartenfuss las sich
 * dadurch wie eine Reihe Etiketten und nicht wie eine Reihe Wege.
 */
export function Verweis({ nach, children }: { nach: string; children: React.ReactNode }) {
  return (
    <Link href={nach} className="verweis">
      {children}
    </Link>
  );
}

/**
 * Ein langer Erklaertext, zugeklappt.
 *
 * Die Begruendungen auf dieser Seite sind nicht ueberfluessig -- ohne sie
 * liest jemand `offen` als "unbezahlt" und schreibt einem puenktlichen
 * Altmieter eine Mahnung. Sie sind nur nicht das, was man morgens liest.
 * Deshalb bleiben sie wortgleich stehen und wandern hinter ein summary.
 *
 * Die eine Regel dazu: **Das summary muss fuer sich stehen.** Zugeklappt ist
 * es der Satz, aufgeklappt der Beweis. "Mehr erfahren" waere keiner von
 * beidem -- dann muesste man aufklappen, um zu wissen, ob es sich lohnt, und
 * genau das kostet die zwei Sekunden, um die es hier geht.
 */
export function Erklaerung({
  satz,
  children,
}: {
  /** Zugeklappt lesbar, ohne den Rest zu kennen. */
  satz: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <details className="erklaerung">
      <summary>{satz}</summary>
      {children}
    </details>
  );
}

export function CockpitKarte({
  titel,
  zaehler,
  hinweis,
  erklaerung,
  mehr,
  mehrText,
  children,
}: {
  titel: string;
  /** Rechts in der Titelzeile: die eine Zahl, auf die es ankommt. */
  zaehler?: string;
  /** Ein Satz darunter — was die Karte zeigt und was sie nicht zeigt. */
  hinweis?: React.ReactNode;
  /**
   * Die lange Begruendung, zugeklappt. Steht auf jeder Karte an derselben
   * Stelle -- direkt unter dem Hinweis --, damit man sie nicht sucht.
   */
  erklaerung?: React.ReactNode;
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
      {erklaerung}
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
/**
 * Die Kennzahlenzeile der Seite -- vier bis fuenf Zahlen, ganz oben.
 *
 * Dieselbe Zeile wie im Mietenbuch (app/mietenbuch/page.tsx), bis auf die
 * Zahlen: `div.karten` mit `div.karte.kennzahl`, Schild, Wert, Nebensatz.
 * Zwei verschiedene Kennzahlenzeilen in einer Anwendung lernt niemand lesen.
 *
 * Darum hier `div` und nicht das `dl` von `Kennzahlen` weiter unten: Das
 * `dl` gehoert in eine Karte, wo Begriff und Wert paarweise gelesen werden.
 * Die Zeile ueber der Seite ist kein Begriffsverzeichnis, sondern ein Blick.
 */
export function KennzahlenZeile({ posten }: { posten: Kennzahl[] }) {
  return (
    <div className="karten">
      {posten.map((p) => (
        <div className="karte kennzahl" key={p.begriff}>
          <span className="kennzahl-schild">{p.begriff}</span>
          {/* Kein `?? 0`: Ein Gedankenstrich heisst "wir wissen es nicht",
              eine Null heisst "es ist nichts". Das ist auf dieser Seite der
              Unterschied zwischen einer Mahnung und keiner Mahnung. */}
          <span className="kennzahl-wert" data-art={p.art}>
            {p.wert ?? "—"}
          </span>
          {p.dazu && (
            <span className="hinweis" style={{ margin: 0, maxWidth: "none" }}>
              {p.dazu}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

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
