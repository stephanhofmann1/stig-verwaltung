"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { istAktiv, type Punkt } from "./Navi";

/**
 * Die Fußnavigation — die Navigation für das Telefon.
 *
 * Warum es sie gibt, obwohl die Kopfnavigation einen Menüknopf hat:
 * Ein eingeklapptes Menü kostet zwei Berührungen je Wechsel (öffnen,
 * wählen) und verdeckt dabei die Seite, von der man kommt. Eine Leiste am
 * unteren Rand kostet eine Berührung und verdeckt nichts. Dazu kommt, wo
 * die Hand ist: Wer ein Telefon einhändig hält, erreicht den unteren
 * Rand mit dem Daumen und den oberen nicht — der Menüknopf sitzt an der
 * Stelle des Bildschirms, die am schwersten zu treffen ist.
 *
 * Die Kopfnavigation bleibt unverändert. Auf breiten Geräten stehen dort
 * alle vier Gruppen offen, und diese Leiste wird von globals.css
 * ausgeblendet.
 *
 * Wichtig für die Regel in globals.css: Auf breiten Geräten muss die
 * Leiste mit `display: none` verschwinden und nicht mit visibility,
 * opacity oder einem Versatz aus dem Bild. Sonst steht die
 * Vorlesesoftware vor zwei Navigationen mit denselben Zielen, von denen
 * eine unsichtbar ist.
 */

/**
 * Die Ziele der Leiste.
 *
 * Fünf statt der elf aus der Kopfnavigation, und die Auswahl folgt einer
 * Frage: Was tut ein Vermieter, während er nicht am Schreibtisch sitzt?
 *
 *   Cockpit      Der Weg zurück. Eine Leiste ohne Heimweg ist eine Falle;
 *                außerdem ist es die Seite, die die Frage beantwortet,
 *                mit der man das Telefon überhaupt herausholt ("bleibt
 *                heute etwas liegen?").
 *   Mietenbuch   Die Frage "hat der gezahlt?" wird am Mietenbuch
 *                beantwortet und nicht am Schreibtisch nachgeschlagen.
 *                Das Raster ist die dichteste Tabelle der Anwendung --
 *                dass es auf dem Telefon trotzdem zu bedienen ist, ist
 *                die Leistung der Filterleiste und der schmalen Regeln in
 *                raster.css, nicht meine. Ohne die beiden gehörte es
 *                hier nicht her.
 *   Vorgänge     Der stärkste Fall für das Telefon: Ein Vorgang beginnt
 *                mit einer Nachricht eines Mieters und wird oft genau
 *                dort gelesen, wo er entsteht -- im Treppenhaus, beim
 *                Handwerker, zwischen zwei Terminen.
 *   Rückstände   Was das Mietenbuch zeigt, sortiert nach dem, was fehlt.
 *                Der Anlass für einen Anruf, und ein Anruf passiert
 *                selten am Schreibtisch.
 *   Belege       Die einzige Stelle der Anwendung, an der das Telefon
 *                mehr kann als der Rechner: Es hat eine Kamera. Eine
 *                Handwerkerrechnung wird abfotografiert, wo sie
 *                übergeben wird.
 *
 * Die Reihenfolge ist die der Kopfnavigation (Übersicht, Vermietung,
 * Geld). Wer beide kennt, muss nicht umlernen, und wer nur die Leiste
 * kennt, merkt nichts davon.
 *
 * Bewusst nicht in der Leiste:
 *   Einheiten & Mieter  fachlich ein guter Kandidat, aber der Name passt
 *                     nicht in ein Fünftel der Gerätebreite, und ihn
 *                     für die Leiste zu kürzen hieße, denselben Ort an
 *                     zwei Stellen verschieden zu nennen. Das ist in
 *                     dieser Anwendung eine ausdrückliche Regel (siehe
 *                     die Namensbegründungen in Navi.tsx).
 *   Zahlungen, Konten, Bank, Objekte, Automatik
 *                     Arbeit am Schreibtisch: Abgleichen, Einrichten,
 *                     Nachsehen. Nichts davon beginnt unterwegs.
 *
 * Mehr als fünf gehen nicht: Bei 390 px Gerätebreite bleiben dann unter
 * 70 px je Punkt, und darin steht kein Wort mehr, das man lesen kann.
 *
 * Die Pfade und die Namen stehen wortgleich so in Navi.tsx. Das ist keine
 * Bequemlichkeit, sondern die Regel: ein Ort, ein Name, überall derselbe.
 * tests/webapp.test.ts prüft, dass jeder Weg hier auch in Navi.tsx steht --
 * ein Weg, der nur hier existiert, wäre ein toter Link, den niemand
 * bemerkt, weil er auf breiten Geräten unsichtbar ist.
 */
const ZIELE: Punkt[] = [
  { href: "/cockpit", text: "Cockpit" },
  { href: "/mietenbuch", text: "Mietenbuch" },
  { href: "/vorgaenge", text: "Vorgänge", auch: ["/vorgang"] },
  { href: "/mahnwesen", text: "Rückstände" },
  { href: "/belege", text: "Belege" },
];

/**
 * Die Zeichen.
 *
 * Inline-SVG und kein Zeichensatz: Ein Icon-Paket wäre eine Abhängigkeit
 * für vier Bilder, und ein Zeichensatz, der nicht lädt, hinterlässt vier
 * leere Felder.
 *
 * currentColor und sonst keine Farbe im Markup — die Leiste färbt sich
 * über color, und damit laufen heller und dunkler Modus mit, ohne dass
 * hier ein zweiter Satz Werte gepflegt wird.
 *
 * width/height stehen als Attribute und nicht als Stil. Sie sind die
 * Rückfallgröße: Eine CSS-Regel auf .navi-boden-zeichen schlägt sie ohne
 * weiteres, aber solange es die Regel nicht gibt, erscheint das SVG in
 * seiner Standardgröße von 300×150 px und sprengt die Leiste.
 *
 * Alle vier auf demselben 24er-Raster, dieselbe Strichstärke, dieselben
 * runden Enden: Vier Bilder in vier Handschriften liest man einzeln, vier
 * in einer liest man als Leiste.
 */

/** Gemeinsame Merkmale aller vier Zeichen. */
const ZEICHEN = {
  className: "navi-boden-zeichen",
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  /* Das Wort daneben sagt dasselbe. Zweimal vorgelesen wäre es doppelt. */
  "aria-hidden": true,
  focusable: false,
} as const;

/**
 * Cockpit: ein Haus.
 *
 * Kein Zifferblatt und kein Tachometer, obwohl die Seite Cockpit heisst:
 * Das Zeichen muss sagen, wohin es fuehrt, und das ist hier zugleich der
 * Anfang und der Gegenstand der ganzen Anwendung. Ein Haus liest sich
 * ausserdem als "zurueck zum Anfang", was der zweite Zweck des Punktes
 * ist.
 */
function ZeichenCockpit() {
  return (
    <svg {...ZEICHEN}>
      <path d="M3.5 10.25 12 3.5l8.5 6.75" />
      <path d="M5.5 9v10.75a.75.75 0 0 0 .75.75h11.5a.75.75 0 0 0 .75-.75V9" />
      <path d="M10 20.5v-5h4v5" />
    </svg>
  );
}

/**
 * Mietenbuch: ein Raster.
 *
 * Genau das ist die Seite -- Zeilen (Mietverhaeltnisse) ueber Spalten
 * (Monate). Das Zeichen zeigt die Form der Seite und nicht ihr Thema;
 * Geld kommt auf drei weiteren Seiten vor, dieses Raster nur hier.
 */
function ZeichenMietenbuch() {
  return (
    <svg {...ZEICHEN}>
      <rect x="3" y="4.25" width="18" height="15.5" rx="1.75" />
      <path d="M3 9.5h18" />
      <path d="M9.5 9.5v10.25" />
    </svg>
  );
}

/** Vorgänge: eine Sprechblase — ein Vorgang ist ein Schriftwechsel. */
function ZeichenVorgaenge() {
  return (
    <svg {...ZEICHEN}>
      <path d="M20.5 12.5a7.5 7.5 0 0 1-10.8 6.7L4 20.5l1.4-5.2A7.5 7.5 0 1 1 20.5 12.5Z" />
      <path d="M8.75 11.5h6.5" />
      <path d="M8.75 14.75h4" />
    </svg>
  );
}

/**
 * Rückstände: ein Ausrufezeichen im Kreis.
 *
 * Kein Geldschein und kein Euro: Die Gruppe "Geld" hat fünf Seiten, auf
 * denen Geld vorkommt. Was diese Seite von den anderen unterscheidet,
 * ist nicht das Geld, sondern dass etwas fehlt.
 */
function ZeichenRueckstaende() {
  return (
    <svg {...ZEICHEN}>
      <circle cx="12" cy="12" r="8.75" />
      <path d="M12 7.5v5" />
      <path d="M12 16.25h.01" />
    </svg>
  );
}

/** Belege: ein Zettel mit gezacktem unterem Rand — ein Kassenbon. */
function ZeichenBelege() {
  return (
    <svg {...ZEICHEN}>
      <path d="M5.25 3.25h13.5v17.5l-2.25-1.5-2.25 1.5-2.25-1.5-2.25 1.5-2.25-1.5-2.25 1.5V3.25Z" />
      <path d="M8.75 8h6.5" />
      <path d="M8.75 11.75h6.5" />
    </svg>
  );
}

/** Zu jedem Weg das Zeichen. Getrennt von ZIELE, damit die Liste oben
 *  lesbar bleibt — dort steht die Entscheidung, hier die Zeichnung. */
const ZEICHEN_ZU_WEG: Record<string, () => React.ReactElement> = {
  "/cockpit": ZeichenCockpit,
  "/mietenbuch": ZeichenMietenbuch,
  "/vorgaenge": ZeichenVorgaenge,
  "/mahnwesen": ZeichenRueckstaende,
  "/belege": ZeichenBelege,
};

export function NaviBoden({ benutzer }: { benutzer: string | null }) {
  const pfad = usePathname();

  // Wer nicht angemeldet ist, hat keine dieser Seiten. Eine Leiste mit
  // fünf Wegen, die alle auf die Anmeldung umleiten, ist kein Angebot.
  if (!benutzer) return null;
  if (pfad === "/anmelden") return null;

  /* Derselbe Schnitt wie in Navi.tsx: Der Mieterbereich ist nicht die
     Verwaltung. Wer als Mieter angemeldet ist, sieht unter /mieter seine
     eigene Wohnung — Rückstände und Belege des Vermieters gehen ihn
     nichts an. Gesperrt sind die Seiten ohnehin in proxy.ts; eine
     Leiste, die fünf verbotene Wege anbietet, ist trotzdem falsch, und
     am unteren Rand wäre sie der am leichtesten zu treffende Fehler der
     Anwendung. */
  if (pfad === "/mieter" || pfad.startsWith("/mieter/")) return null;

  return (
    /* aria-label trennt diese Navigation von der Hauptnavigation in der
       Kopfzeile. Benannt nach dem Zweck und nicht nach der Lage: "unten"
       sagt jemandem, der die Seite vorgelesen bekommt, nichts. */
    <nav className="navi-boden" aria-label="Schnellzugriff">
      {ZIELE.map((z) => {
        const Zeichen = ZEICHEN_ZU_WEG[z.href];
        const aktiv = istAktiv(z, pfad);
        return (
          <Link
            key={z.href}
            href={z.href}
            className="navi-boden-punkt"
            /* Das Merkmal für die Gestaltung, wie bei .navi a — welche
               Form das Aktivsein annimmt, entscheidet globals.css. */
            data-aktiv={aktiv ? "ja" : "nein"}
            /* Dasselbe noch einmal, nur hörbar. */
            aria-current={aktiv ? "page" : undefined}
          >
            <Zeichen />
            {/* Zeichen ohne Wort ist eine Ratefrage: Ein Ausrufezeichen
                im Kreis heißt "Rückstände", "Fehler" oder "Hinweis", je
                nachdem, wer hinsieht. */}
            <span className="navi-boden-wort">{z.text}</span>
          </Link>
        );
      })}
    </nav>
  );
}
