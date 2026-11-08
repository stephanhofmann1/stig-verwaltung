import {
  balkenGruppe,
  zeichenbreite,
  flaechePfad,
  linienPfad,
  reihenPunkte,
  ringAnteil,
  skala,
  stapel,
  type Skala,
} from "@/lib/diagramm";

/**
 * Der Diagramm-Baukasten.
 *
 * Server-Komponenten: kein "use client", kein useState, keine Animation per
 * JavaScript. „Dynamischer“ heisst hier nicht interaktiv-animiert, sondern:
 * die Daten bestimmen die Form, und man sieht einen Verlauf statt einer
 * Momentaufnahme.
 *
 * Vorbild und Vorgabe ist CockpitCashflow in seiner ersten Fassung. Vier
 * Eigenschaften sind nicht verhandelbar und gelten fuer jeden Baustein hier:
 *
 *   1. **`role="img"` mit einem `aria-label`, das die Aussage nennt.** Nicht
 *      „Balkendiagramm“ -- sondern was man darin sieht. Ein Bild, das ohne
 *      Augen nichts sagt, ist in dieser Anwendung ein Fehler.
 *   2. **`<title>` je Element.** Der Zeigerhinweis nennt den Betrag, nicht
 *      die Kategorie.
 *   3. **Eine Begleittabelle**, zugeklappt in `<details className="erklaerung">`
 *      mit derselben Information als echte Tabelle. Eine Zahl, die man nur
 *      noch als Balkenhoehe hat, ist verloren.
 *   4. **Keine Farbe im Markup.** Ausschliesslich `currentColor` mit
 *      `fillOpacity`/`strokeOpacity`, und `color` ueber die CSS-Marken
 *      --akzent, --gut, --warn, --fehl, --linie, --fg-leise. Der Dunkelmodus
 *      kippt die Marken; ein festes Blau im `fill` waere dort unlesbar.
 *
 * Gestaltet wird hier nichts. Die Klassen (.diagramm, .diagramm-flaeche,
 * .diagramm-gitter, .diagramm-achse, .diagramm-legende, .diagramm-marke,
 * .diagramm-leer, .sparkline, .streifen, .ring) kommen aus globals.css; an
 * der Gestaltung arbeitet jemand anderes.
 *
 * Gerechnet wird ebenfalls nichts: Skalen, Stapel und Pfade stehen in
 * lib/diagramm.ts und haben dort Tests. Eine Skala, die mitten in einer
 * Komponente entsteht, laesst sich nur im Browser pruefen.
 */

// ---------------------------------------------------------------------------
// Farben
// ---------------------------------------------------------------------------

export type Diagrammart = "akzent" | "gut" | "warn" | "fehl" | "leise" | "linie";

/**
 * Die einzige Stelle, an der eine Farbe benannt wird -- und zwar als Marke,
 * nicht als Wert. Alles darunter zeichnet mit `currentColor`.
 */
const MARKE: Record<Diagrammart, string> = {
  akzent: "var(--akzent)",
  gut: "var(--gut)",
  warn: "var(--warn)",
  fehl: "var(--fehl)",
  leise: "var(--fg-leise)",
  linie: "var(--linie)",
};

const farbe = (art: Diagrammart | undefined) => ({
  color: MARKE[art ?? "akzent"],
});

// ---------------------------------------------------------------------------
// Huelle
// ---------------------------------------------------------------------------

export interface Begleitung {
  /**
   * Die Aussage in Worten. Wird das `aria-label` des SVG und ist damit fuer
   * jemanden ohne Bild die einzige Zusammenfassung -- sie muss das Ergebnis
   * nennen, nicht die Darstellungsform.
   */
  aussage: string;
  /**
   * Die Begleittabelle: dieselbe Information als echte Tabelle, zugeklappt.
   * Ohne sie ist die Zahl nach dem Zeichnen verloren.
   */
  tabelle?: React.ReactNode;
  /** Zugeklappt lesbar, ohne den Rest zu kennen. */
  tabelleTitel?: string;
  /** Ein Satz unter dem Bild -- was man darin sieht, und was nicht. */
  hinweis?: React.ReactNode;
}

function Huelle({
  tabelle,
  tabelleTitel = "Zahlen zur Grafik",
  hinweis,
  children,
}: Begleitung & { children: React.ReactNode }) {
  return (
    <div className="diagramm">
      {children}
      {hinweis && <p className="hinweis">{hinweis}</p>}
      {tabelle && (
        <details className="erklaerung">
          <summary>{tabelleTitel}</summary>
          <div className="tabelle-rolle">{tabelle}</div>
        </details>
      )}
    </div>
  );
}

/**
 * Der Leerzustand.
 *
 * Nicht ein leeres Koordinatensystem: Das liest sich wie „gemessen und
 * nichts gefunden“. Der Satz sagt, **wodurch** etwas zu sehen waere.
 */
export function DiagrammLeer({
  titel,
  children,
}: {
  titel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="diagramm-leer leer">
      <strong>{titel}</strong>
      {children}
    </div>
  );
}

/** Die Gitterlinien samt Beschriftung. Ein Bild ohne Mass ist ein Muster. */
function Gitter({
  s,
  breite,
  achsenbreite,
  beschriftung,
}: {
  s: Skala;
  breite: number;
  achsenbreite: number;
  beschriftung: (wert: number) => string;
}) {
  return (
    <g className="diagramm-gitter" style={farbe("linie")} aria-hidden="true">
      {s.gitter.map((wert) => {
        const y = s.y(wert);
        const istNull = Math.abs(wert) < 0.005;
        return (
          <g key={wert}>
            <line
              x1={achsenbreite}
              y1={y}
              x2={achsenbreite + breite}
              y2={y}
              stroke="currentColor"
              strokeOpacity={istNull ? 0.9 : 0.45}
            />
            <text
              className="diagramm-achse"
              x={achsenbreite - 5}
              y={y + 3}
              textAnchor="end"
              fontSize="9"
              fill="currentColor"
              fillOpacity="0.85"
              style={farbe("leise")}
            >
              {beschriftung(wert)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** Beschriftung unter der Spur. */
function Fussbeschriftung({
  namen,
  mitten,
  achsenbreite,
  y,
  leise,
}: {
  namen: string[];
  mitten: number[];
  achsenbreite: number;
  y: number;
  /** Indizes, deren Beschriftung blass bleibt -- dort fehlt die Aussage. */
  leise?: boolean[];
}) {
  return (
    <g className="diagramm-achse" style={farbe("leise")} aria-hidden="true">
      {namen.map((name, i) => (
        <text
          key={`${name}-${i}`}
          x={achsenbreite + (mitten[i] ?? 0)}
          y={y}
          textAnchor="middle"
          fontSize="9"
          fill="currentColor"
          fillOpacity={leise?.[i] ? 0.45 : 0.8}
        >
          {name}
        </text>
      ))}
    </g>
  );
}

/** Legende mit Farbtupfer. Eine Deckung allein ist kein Begriff. */
export function Legende({
  teile,
}: {
  teile: Array<{ name: string; art?: Diagrammart; deckung?: number }>;
}) {
  return (
    <ul className="diagramm-legende">
      {teile.map((t) => (
        <li key={t.name} className="diagramm-marke" style={farbe(t.art)}>
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            aria-hidden="true"
            focusable="false"
          >
            <rect
              width="10"
              height="10"
              fill="currentColor"
              fillOpacity={t.deckung ?? 0.85}
            />
          </svg>
          <span>{t.name}</span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Balken
// ---------------------------------------------------------------------------

export interface BalkenPosten {
  /** Achsenbeschriftung, z. B. "Nov 26". */
  name: string;
  /** `null` = Luecke. Es wird nichts gezeichnet und nicht auf 0 geklemmt. */
  wert: number | null;
  /** Der Zeigerhinweis: ganzer Satz mit Betrag. */
  titel: string;
  art?: Diagrammart;
}

/**
 * Balken mit Nulllinie, Achsenstufen und Monatsbeschriftung.
 *
 * Negative Werte haengen unter der Nulllinie, statt zu verschwinden -- ein
 * Monat mit mehr Ausgaben als Einnahmen ist eine Aussage.
 */
export function Balken({
  posten,
  hoehe = 120,
  spur = 88,
  achsen = 4,
  achsenbreite = 46,
  beschriftung = (w) => String(w),
  leerTitel = "Nichts zu zeichnen",
  leerSatz,
  ...begleitung
}: Begleitung & {
  posten: BalkenPosten[];
  hoehe?: number;
  spur?: number;
  achsen?: number;
  achsenbreite?: number;
  beschriftung?: (wert: number) => string;
  leerTitel?: string;
  leerSatz?: React.ReactNode;
}) {
  const breite = zeichenbreite(posten.length, spur);
  const { felder, skala: s } = balkenGruppe(
    posten.map((p) => p.wert),
    breite,
    hoehe,
    { stufen: achsen },
  );

  if (s.leer) {
    return <DiagrammLeer titel={leerTitel}>{leerSatz}</DiagrammLeer>;
  }

  const fuss = hoehe + 16;

  return (
    <Huelle {...begleitung}>
      <svg
        className="diagramm-flaeche"
        viewBox={`0 0 ${achsenbreite + breite} ${fuss + 6}`}
        width="100%"
        /* Die Obergrenze ist die Zeichenbreite in Pixeln. Damit ist der
           Massstab hoechstens 1:1 -- die 10px der Achsenbeschriftung
           bleiben 10px. Nach unten darf skaliert werden: Auf schmalen
           Geraeten schrumpft alles gleichmaessig mit. */
        style={{ maxWidth: `${achsenbreite + breite}px` }}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={begleitung.aussage}
      >
        <Gitter
          s={s}
          breite={breite}
          achsenbreite={achsenbreite}
          beschriftung={beschriftung}
        />
        {felder.map((f, i) => {
          const p = posten[i];
          if (f.luecke) {
            return (
              <g key={`${p.name}-${i}`} style={farbe("leise")}>
                <title>{p.titel}</title>
                {/* Die Luecke wird gezeigt, nicht uebergangen: ein blasses
                    Band ueber die ganze Hoehe, damit sie nicht wie eine
                    Null aussieht. */}
                <rect
                  x={achsenbreite + f.x}
                  y={0}
                  width={f.breite}
                  height={hoehe}
                  fill="currentColor"
                  fillOpacity="0.08"
                />
              </g>
            );
          }
          return (
            <g key={`${p.name}-${i}`} style={farbe(p.art)}>
              <title>{p.titel}</title>
              <rect
                x={achsenbreite + f.x}
                y={f.y}
                width={f.breite}
                height={f.hoehe}
                fill="currentColor"
                fillOpacity={f.negativ ? 0.35 : 0.85}
              />
            </g>
          );
        })}
        <Fussbeschriftung
          namen={posten.map((p) => p.name)}
          mitten={felder.map((f) => f.mitte)}
          achsenbreite={achsenbreite}
          y={fuss}
          leise={felder.map((f) => f.luecke)}
        />
      </svg>
    </Huelle>
  );
}

// ---------------------------------------------------------------------------
// Stapelbalken
// ---------------------------------------------------------------------------

export interface StapelPosten {
  name: string;
  titel: string;
  teile: Array<{ name: string; wert: number | null; art?: Diagrammart }>;
}

/**
 * Gestapelte Balken mit Legende.
 *
 * Die Segmente kommen aus `stapel()` und ergeben zusammen genau die
 * Balkenhoehe -- rechnete jede Komponente ihre Hoehen selbst, bliebe am Ende
 * eine Luecke von einem halben Pixel, und die sieht aus wie ein Posten, den
 * es nicht gibt.
 */
export function Stapelbalken({
  posten,
  gegen,
  hoehe = 120,
  spur = 88,
  achsen = 4,
  achsenbreite = 46,
  beschriftung = (w) => String(w),
  legende,
  leerTitel = "Nichts zu zeichnen",
  leerSatz,
  ...begleitung
}: Begleitung & {
  posten: StapelPosten[];
  /**
   * Eine Gegenreihe, die unter der Nulllinie als Umriss erscheint (Ausgaben
   * gegen Einnahmen). Die Werte sind positiv; nach unten gezeichnet werden
   * sie hier. Ohne Gegenreihe bleibt die Nulllinie der untere Rand.
   */
  gegen?: {
    name: string;
    werte: Array<number | null>;
    art?: Diagrammart;
  };
  hoehe?: number;
  spur?: number;
  achsen?: number;
  achsenbreite?: number;
  beschriftung?: (wert: number) => string;
  /** Die Begriffe der Segmente, in derselben Reihenfolge wie `teile`. */
  legende?: Array<{ name: string; art?: Diagrammart }>;
  leerTitel?: string;
  leerSatz?: React.ReactNode;
}) {
  const summen = posten.map((p) =>
    p.teile.reduce((s, t) => {
      const n = t.wert;
      return s + (n !== null && Number.isFinite(n) && n > 0 ? n : 0);
    }, 0),
  );
  const breite = zeichenbreite(posten.length, spur);
  // Die Gegenreihe geht negativ in die Skala ein, damit sie Platz unter der
  // Nulllinie bekommt -- sonst waere die Nulllinie der Rand und die Ausgaben
  // haetten keine Hoehe.
  const s = skala(
    [
      ...summen,
      ...(gegen?.werte ?? []).map((w) =>
        w === null || !Number.isFinite(w) ? null : -Math.abs(w),
      ),
    ],
    hoehe,
    achsen,
  );
  const { felder } = balkenGruppe(summen, breite, hoehe, { skala: s });

  if (s.leer) {
    return <DiagrammLeer titel={leerTitel}>{leerSatz}</DiagrammLeer>;
  }

  const fuss = hoehe + 16;

  return (
    <Huelle {...begleitung}>
      <svg
        className="diagramm-flaeche"
        viewBox={`0 0 ${achsenbreite + breite} ${fuss + 6}`}
        width="100%"
        /* Die Obergrenze ist die Zeichenbreite in Pixeln. Damit ist der
           Massstab hoechstens 1:1 -- die 10px der Achsenbeschriftung
           bleiben 10px. Nach unten darf skaliert werden: Auf schmalen
           Geraeten schrumpft alles gleichmaessig mit. */
        style={{ maxWidth: `${achsenbreite + breite}px` }}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={begleitung.aussage}
      >
        <Gitter
          s={s}
          breite={breite}
          achsenbreite={achsenbreite}
          beschriftung={beschriftung}
        />
        {posten.map((p, i) => {
          const feld = felder[i];
          const gestapelt = stapel(p.teile, feld.hoehe);
          return (
            <g key={`${p.name}-${i}`}>
              <title>{p.titel}</title>
              {gestapelt.segmente.map((seg, k) => (
                <rect
                  key={`${seg.name}-${k}`}
                  x={achsenbreite + feld.x}
                  // Von unten nach oben stapeln: der erste Posten sitzt auf
                  // der Nulllinie, wie in der Legende gelesen.
                  y={s.nulllinie - seg.versatz - seg.laenge}
                  width={feld.breite}
                  height={seg.laenge}
                  fill="currentColor"
                  fillOpacity="0.85"
                  style={farbe(p.teile[k]?.art)}
                />
              ))}
            </g>
          );
        })}

        {/* Die Gegenreihe als Umriss, nicht als Flaeche: Sie ist der
            Vergleichsmassstab und soll die Einnahmen nicht uebertoenen. */}
        {gegen?.werte.map((roh, i) => {
          const w = roh === null || !Number.isFinite(roh) ? null : Math.abs(roh);
          const feld = felder[i];
          if (w === null || feld === undefined) return null;
          const laenge = s.laenge(-w);
          if (!(laenge > 0)) return null;
          return (
            <g key={`gegen-${i}`} style={farbe(gegen.art ?? "leise")}>
              <title>{`${posten[i]?.name ?? ""}: ${gegen.name}`}</title>
              <rect
                x={achsenbreite + feld.x}
                y={s.nulllinie}
                width={feld.breite}
                height={laenge}
                fill="none"
                stroke="currentColor"
                strokeOpacity="0.7"
              />
            </g>
          );
        })}

        <Fussbeschriftung
          namen={posten.map((p) => p.name)}
          mitten={felder.map((f) => f.mitte)}
          achsenbreite={achsenbreite}
          y={fuss}
        />
      </svg>
      {legende && <Legende teile={legende} />}
    </Huelle>
  );
}

// ---------------------------------------------------------------------------
// Verlauf
// ---------------------------------------------------------------------------

export interface VerlaufSpalte {
  /** Achsenbeschriftung, z. B. "Nov 26". */
  name: string;
  /** true = ueber diesen Abschnitt laesst sich nichts sagen. */
  luecke?: boolean;
  /** Der Zeigerhinweis der Spalte -- bei einer Luecke ihr Grund. */
  titel?: string;
}

export interface VerlaufLinie {
  name: string;
  art?: Diagrammart;
  /** So lang wie `spalten`. `null` = Luecke, nicht 0. */
  werte: Array<number | null>;
  /** Flaeche unter der Linie fuellen. Sinnvoll nur fuer die untere. */
  flaeche?: boolean;
  /** Gestrichelt -- fuer das Soll, das eine Vorgabe und keine Messung ist. */
  gestrichelt?: boolean;
}

/**
 * Linienzug mit gefuellter Flaeche, fuer Monatsreihen. Zwei Linien
 * uebereinander sind der Regelfall (Soll gegen Ist).
 *
 * Eine Luecke trennt den Pfad: `linienPfad()` setzt dort ein neues `M`.
 * Wuerde die Linie durchgezogen, behauptete sie fuer den fehlenden Monat
 * einen Zwischenwert. Zusaetzlich steht ueber der Spalte ein blasses Band
 * mit eigenem Zeigerhinweis -- eine Luecke, die man nicht sieht, liest man
 * als Null.
 */
export function Verlauf({
  spalten,
  linien,
  hoehe = 140,
  spur = 88,
  achsen = 4,
  achsenbreite = 46,
  beschriftung = (w) => String(w),
  leerTitel = "Nichts zu zeichnen",
  leerSatz,
  ...begleitung
}: Begleitung & {
  spalten: VerlaufSpalte[];
  linien: VerlaufLinie[];
  hoehe?: number;
  spur?: number;
  achsen?: number;
  achsenbreite?: number;
  beschriftung?: (wert: number) => string;
  leerTitel?: string;
  leerSatz?: React.ReactNode;
}) {
  const breite = zeichenbreite(spalten.length, spur);
  const alle = linien.flatMap((l) => l.werte);
  const s = skala(alle, hoehe, achsen);

  if (s.leer) {
    return <DiagrammLeer titel={leerTitel}>{leerSatz}</DiagrammLeer>;
  }

  const fuss = hoehe + 16;
  const mitten = spalten.map((_, i) => (i + 0.5) * spur);

  return (
    <Huelle {...begleitung}>
      <svg
        className="diagramm-flaeche"
        viewBox={`0 0 ${achsenbreite + breite} ${fuss + 6}`}
        width="100%"
        /* Die Obergrenze ist die Zeichenbreite in Pixeln. Damit ist der
           Massstab hoechstens 1:1 -- die 10px der Achsenbeschriftung
           bleiben 10px. Nach unten darf skaliert werden: Auf schmalen
           Geraeten schrumpft alles gleichmaessig mit. */
        style={{ maxWidth: `${achsenbreite + breite}px` }}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={begleitung.aussage}
      >
        <Gitter
          s={s}
          breite={breite}
          achsenbreite={achsenbreite}
          beschriftung={beschriftung}
        />

        {/* Luecken zuerst, damit die Linien darueber liegen. */}
        {spalten.map((sp, i) =>
          sp.luecke ? (
            <g key={`luecke-${i}`} style={farbe("leise")}>
              <title>{sp.titel ?? `${sp.name}: keine Aussage möglich`}</title>
              <rect
                x={achsenbreite + i * spur}
                y={0}
                width={spur}
                height={hoehe}
                fill="currentColor"
                fillOpacity="0.08"
              />
            </g>
          ) : null,
        )}

        {linien.map((l) => {
          const punkte = reihenPunkte(l.werte, breite, s);
          const verschoben = punkte.map((p) =>
            p === null ? null : { x: p.x + achsenbreite, y: p.y },
          );
          return (
            <g key={l.name} style={farbe(l.art)}>
              {l.flaeche && (
                <path
                  d={flaechePfad(verschoben, s.nulllinie)}
                  fill="currentColor"
                  fillOpacity="0.14"
                  stroke="none"
                />
              )}
              <path
                d={linienPfad(verschoben)}
                fill="none"
                stroke="currentColor"
                strokeOpacity="0.9"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={l.gestrichelt ? "5 3" : undefined}
              />
              {verschoben.map((p, i) =>
                p === null ? null : (
                  <g key={`${l.name}-${i}`}>
                    <title>
                      {spalten[i]?.titel ??
                        `${spalten[i]?.name ?? ""}: ${l.name} ${l.werte[i]}`}
                    </title>
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r="2.5"
                      fill="currentColor"
                      fillOpacity="0.9"
                    />
                  </g>
                ),
              )}
            </g>
          );
        })}

        <Fussbeschriftung
          namen={spalten.map((sp) => sp.name)}
          mitten={mitten}
          achsenbreite={achsenbreite}
          y={fuss}
          leise={spalten.map((sp) => sp.luecke === true)}
        />
      </svg>
      <Legende
        teile={linien.map((l) => ({ name: l.name, art: l.art, deckung: 0.9 }))}
      />
    </Huelle>
  );
}

// ---------------------------------------------------------------------------
// Ring
// ---------------------------------------------------------------------------

/**
 * Eine Quote als Ring, mit der Zahl in der Mitte.
 *
 * Der Umfang steht als `pathLength` am Kreis. Damit muss der Radius
 * nirgends in die Rechnung, und ein geaenderter Radius verschiebt den Ring
 * nicht.
 *
 * `wert` ist ein Anteil zwischen 0 und 1 und wird in lib/diagramm.ts durch
 * `anteil()` geklemmt: `NaN` wird 0, Negatives wird 0, ueber 1 wird 1.
 */
export function Ring({
  wert,
  mitte,
  darunter,
  art = "akzent",
  ...begleitung
}: Begleitung & {
  wert: number | null;
  /** Was in der Mitte steht -- die fertig formatierte Zahl. */
  mitte: string;
  /** Kleine Zeile darunter, z. B. "von 9 Einheiten". */
  darunter?: string;
  art?: Diagrammart;
}) {
  const r = ringAnteil(wert);

  return (
    <Huelle {...begleitung}>
      <svg
        className="diagramm-flaeche ring"
        viewBox="0 0 120 120"
        width="100%"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={begleitung.aussage}
      >
        <g transform="rotate(-90 60 60)">
          <circle
            cx="60"
            cy="60"
            r="48"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.9"
            strokeWidth="12"
            style={farbe("linie")}
          />
          <g style={farbe(art)}>
            <title>{begleitung.aussage}</title>
            <circle
              cx="60"
              cy="60"
              r="48"
              fill="none"
              stroke="currentColor"
              strokeOpacity="0.9"
              strokeWidth="12"
              strokeLinecap="butt"
              pathLength={r.umfang}
              strokeDasharray={r.strokeDasharray}
              strokeDashoffset={r.strokeDashoffset}
            />
          </g>
        </g>
        <text
          className="ziffern"
          x="60"
          y={darunter ? 58 : 66}
          textAnchor="middle"
          fontSize="22"
          fill="currentColor"
          fillOpacity="0.95"
        >
          {mitte}
        </text>
        {darunter && (
          <text
            className="diagramm-achse"
            x="60"
            y="76"
            textAnchor="middle"
            fontSize="9"
            fill="currentColor"
            fillOpacity="0.8"
            style={farbe("leise")}
          >
            {darunter}
          </text>
        )}
      </svg>
    </Huelle>
  );
}

// ---------------------------------------------------------------------------
// Sparkline
// ---------------------------------------------------------------------------

/**
 * Winziger Verlauf ohne Achsen, fuer die Kennzahlenzeile.
 *
 * `tabelle` ist hier das einzige Mal freiwillig: Die Sparkline steht direkt
 * neben der Zahl, die sie zeigt, und die steht als Text daneben. Ein
 * zugeklapptes `<details>` in einer Kennzahlenkarte waere eine Schaltflaeche
 * in einer Zeile, die nur gelesen wird. Das `aria-label` nennt die Aussage
 * trotzdem -- und wer die Reihe braucht, bekommt sie ueber `tabelle`.
 */
export function Sparkline({
  werte,
  aussage,
  art = "akzent",
  breite = 96,
  hoehe = 24,
  flaeche = true,
  tabelle,
  tabelleTitel,
}: {
  werte: Array<number | null>;
  aussage: string;
  art?: Diagrammart;
  breite?: number;
  hoehe?: number;
  flaeche?: boolean;
  tabelle?: React.ReactNode;
  tabelleTitel?: string;
}) {
  const s = skala(werte, hoehe - 4, 1);
  if (s.leer) {
    // Kein leeres Kaestchen: Ein Strich auf Null hiesse „gemessen, nichts da“.
    return null;
  }
  const punkte = reihenPunkte(werte, breite, s).map((p) =>
    p === null ? null : { x: p.x, y: p.y + 2 },
  );

  const bild = (
    <svg
      className="sparkline"
      viewBox={`0 0 ${breite} ${hoehe}`}
      width="100%"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={aussage}
      style={farbe(art)}
    >
      <title>{aussage}</title>
      {flaeche && (
        <path
          d={flaechePfad(punkte, hoehe - 2)}
          fill="currentColor"
          fillOpacity="0.14"
          stroke="none"
        />
      )}
      <path
        d={linienPfad(punkte)}
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.9"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );

  if (!tabelle) return bild;
  return (
    <Huelle aussage={aussage} tabelle={tabelle} tabelleTitel={tabelleTitel}>
      {bild}
    </Huelle>
  );
}

// ---------------------------------------------------------------------------
// Streifen
// ---------------------------------------------------------------------------

export interface StreifenTeil {
  name: string;
  wert: number | null;
  art?: Diagrammart;
  /** Der Zeigerhinweis: ganzer Satz mit Betrag. */
  titel?: string;
}

/**
 * Ein waagerechter Anteilsbalken, gestapelt -- fuer eine Struktur.
 *
 * `bezug` ist der Wert, der die ganze Breite ausmacht (z. B. das gestellte
 * Soll). Erklaeren die Teile ihn nicht vollstaendig, bleibt der Rest
 * sichtbar leer, und genau das ist die Aussage. Ein Streifen, der sich
 * selbst auf 100 Prozent normiert, kann das nicht zeigen.
 */
export function Streifen({
  teile,
  bezug,
  hoehe = 26,
  legende = true,
  leerTitel = "Nichts zu zeichnen",
  leerSatz,
  ...begleitung
}: Begleitung & {
  teile: StreifenTeil[];
  bezug?: number;
  hoehe?: number;
  legende?: boolean;
  leerTitel?: string;
  leerSatz?: React.ReactNode;
}) {
  const BREITE = 320;
  const gestapelt = stapel(teile, BREITE, bezug);

  if (gestapelt.leer) {
    return <DiagrammLeer titel={leerTitel}>{leerSatz}</DiagrammLeer>;
  }

  return (
    <Huelle {...begleitung}>
      <svg
        className="diagramm-flaeche streifen"
        viewBox={`0 0 ${BREITE} ${hoehe}`}
        width="100%"
        preserveAspectRatio="none"
        role="img"
        aria-label={begleitung.aussage}
      >
        {/* Der Rahmen zeigt den Bezug: Was die Teile nicht erklaeren, bleibt
            als Luft darin stehen. */}
        <rect
          x="0"
          y="0"
          width={BREITE}
          height={hoehe}
          fill="currentColor"
          fillOpacity="0.9"
          style={farbe("linie")}
        />
        {gestapelt.segmente.map((seg, i) => (
          <g key={`${seg.name}-${i}`} style={farbe(teile[i]?.art)}>
            <title>{teile[i]?.titel ?? seg.name}</title>
            <rect
              x={seg.versatz}
              y="0"
              width={seg.laenge}
              height={hoehe}
              fill="currentColor"
              fillOpacity="0.85"
            />
          </g>
        ))}
      </svg>
      {legende && (
        <Legende
          teile={teile.map((t) => ({ name: t.name, art: t.art, deckung: 0.85 }))}
        />
      )}
      {gestapelt.ungueltig && (
        <p className="hinweis">
          Mindestens ein Posten war negativ oder keine Zahl und konnte nicht
          gezeichnet werden. Er steht in der Tabelle — geklemmt sähe die Grafik
          richtig aus, und der Fehler bliebe unentdeckt.
        </p>
      )}
    </Huelle>
  );
}
