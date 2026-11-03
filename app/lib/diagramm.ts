import { anteil } from "./kennzahlen";

/**
 * Das Rechnen hinter den Diagrammen.
 *
 * Reine Funktionen: kein React, keine Datenbank, kein `new Date()`. Der
 * Grund ist derselbe wie oben in lib/kennzahlen.ts -- eine Skala, die mitten
 * in einer Komponente gerechnet wird, laesst sich nur noch im Browser
 * pruefen, also praktisch nie.
 *
 * Die zwei Regeln, die hier ueber allem stehen:
 *
 *   1. **Aus keiner Zahl wird keine Null.** Fehlt ein Wert, ist das eine
 *      Luecke (`null`) und kein Nullwert. Eine Linie, die auf Null fällt,
 *      weil Daten fehlen, ist in dieser Anwendung der teuerste moegliche
 *      Fehler: Aus ihr entsteht ein Mahnschreiben an jemanden, der bezahlt
 *      hat. Jede Funktion hier gibt `null` weiter und klemmt nie auf 0.
 *   2. **Kein `NaN` kommt ins Markup.** `height="NaN"` laesst das SVG
 *      stumm verschwinden -- die Zahl fehlt dann, ohne dass es jemandem
 *      auffaellt. Darum geht jede Eingabe durch `endlich()`.
 *
 * `anteil()` wird aus lib/kennzahlen.ts importiert und nicht nachgebaut:
 * Zwei Fassungen derselben Klemmung laufen auseinander, und dann zeigt der
 * Ring etwas anderes als der Balken daneben.
 */

/** Auf zwei Stellen -- wie `runde` in lib/kennzahlen.ts. */
function runde2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Macht aus allem, was keine endliche Zahl ist, ein `null`.
 *
 * `NaN`, `Infinity`, `undefined` und Textmuell kommen alle aus derselben
 * Richtung: einer Spalte, die `numeric` ist und als Text gelesen wurde.
 * Sie duerfen bis ins Markup nicht durchkommen.
 */
export function endlich(w: number | null | undefined): number | null {
  if (w === null || w === undefined) return null;
  const n = typeof w === "number" ? w : Number(w);
  return Number.isFinite(n) ? n : null;
}

/**
 * Rundet einen Rohwert auf die naechste lesbare Stufe nach oben:
 * 1, 2, 2,5 oder 5 mal einer Zehnerpotenz.
 *
 * Ein Diagramm, dessen Achse bei 4.731 EUR endet, ist unlesbar; eines, das
 * bei 5.000 EUR endet, nicht. Niemand rechnet beim Lesen eines Balkens, er
 * vergleicht ihn mit der Gitterlinie darueber -- und die muss eine Zahl
 * sein, die man im Kopf behaelt.
 */
export function lesbareStufe(roh: number | null | undefined): number {
  const n = endlich(roh);
  if (n === null || !(n > 0)) return 0;
  const potenz = Math.pow(10, Math.floor(Math.log10(n)));
  const rest = n / potenz;
  for (const s of [1, 2, 2.5, 5]) {
    // Die Toleranz faengt den Fall ab, in dem log10 knapp unter der
    // Potenz landet (1000 -> 2,9999...) und der Rest dann 10,0000...1 ist.
    if (rest <= s + 1e-9) return runde2(s * potenz);
  }
  return runde2(10 * potenz);
}

// ---------------------------------------------------------------------------
// Skala
// ---------------------------------------------------------------------------

export interface Skala {
  /** Oberer Rand der Achse, auf eine lesbare Stufe gerundet. */
  max: number;
  /**
   * Unterer Rand. 0, solange kein Wert negativ ist -- ein negativer Wert
   * verschiebt ihn nach unten, statt auf 0 geklemmt zu werden. Ein Monat
   * mit mehr Ausgaben als Einnahmen ist eine Aussage, kein Nullwert.
   */
  min: number;
  hoehe: number;
  /** Pixelabstand vom oberen Rand bis zur Nulllinie. */
  nulllinie: number;
  /** Die Werte der Gitterlinien, von unten nach oben. */
  gitter: number[];
  /**
   * true = es gibt nichts zu zeichnen (keine Werte, oder alle 0). Dann ist
   * ein Leerzustand faellig und kein Diagramm mit Hoehe 0: Ein leeres
   * Koordinatensystem liest sich wie "gemessen und nichts gefunden".
   */
  leer: boolean;
  /** y-Pixel eines Werts, vom oberen Rand. Nie `NaN`. */
  y(wert: number | null | undefined): number;
  /** Balkenlaenge in Pixeln, von der Nulllinie aus. Immer >= 0. */
  laenge(wert: number | null | undefined): number;
}

/**
 * Die Abbildung Wert -> Pixel fuer eine Reihe von Werten.
 *
 * `null` in der Reihe wird uebersprungen und zieht die Skala nicht nach
 * unten -- ein Monat ohne Aussage darf die Achse der anderen nicht
 * veraendern.
 */
export function skala(
  werte: ReadonlyArray<number | null | undefined>,
  hoehe: number,
  stufen = 4,
): Skala {
  const sicher: number[] = [];
  for (const w of werte) {
    const n = endlich(w);
    if (n !== null) sicher.push(n);
  }

  const h = endlich(hoehe);
  const hoeheSicher = h !== null && h > 0 ? h : 0;

  let hoch = 0;
  let tief = 0;
  for (const w of sicher) {
    if (w > hoch) hoch = w;
    if (w < tief) tief = w;
  }

  const max = lesbareStufe(hoch);
  // Negative Werte werden nicht geklemmt, sondern bekommen Platz unter der
  // Nulllinie -- gerundet auf dieselbe lesbare Stufe.
  const min = tief < 0 ? -lesbareStufe(-tief) : 0;
  const spanne = runde2(max - min);
  const leer = sicher.length === 0 || !(spanne > 0);

  const nulllinie = leer ? hoeheSicher : runde2((hoeheSicher * max) / spanne);

  const y = (wert: number | null | undefined): number => {
    if (leer) return nulllinie;
    const n = endlich(wert);
    if (n === null) return nulllinie;
    const geklemmt = Math.min(max, Math.max(min, n));
    return runde2((hoeheSicher * (max - geklemmt)) / spanne);
  };

  return {
    max,
    min,
    hoehe: hoeheSicher,
    nulllinie,
    gitter: leer ? [] : waehleGitter(max, min, stufen),
    leer,
    y,
    laenge: (wert) => {
      const n = endlich(wert);
      if (n === null || leer) return 0;
      return runde2(Math.abs(y(n) - nulllinie));
    },
  };
}

/**
 * Waehlt die Gitterlinien so, dass **der Abstand selbst eine lesbare Stufe
 * ist** -- und nicht nur der Hoechstwert.
 *
 * Der Hoechstwert allein genuegt nicht. Eine Achse bis 2.500.000 EUR in vier
 * Abschnitten hat Linien bei 625.000 und 1.875.000: vier geltende Stellen,
 * die niemand im Kopf behaelt. In fuenf Abschnitten liegen sie bei 500.000,
 * 1.000.000, 1.500.000 -- dieselbe Achse, lesbar.
 *
 * Darum wird nicht die Abschnittszahl festgeschrieben, sondern gesucht: die
 * gewuenschte zuerst, dann die Nachbarn. Angenommen wird die erste, bei der
 * der Abstand eine Stufe aus 1, 2, 2,5 oder 5 mal einer Zehnerpotenz ist und
 * bei der die Null auf einer Linie liegt. Eine Nulllinie ohne Zahl daneben
 * ist die einzige Linie, die man nicht ablesen kann -- und die wichtigste.
 *
 * Das ist kein Geschmack, sondern Mehrmandantenfaehigkeit: Dieselbe Funktion
 * bedient Monatsmieten von 400 EUR und ein Gewerbeobjekt von 80.000 EUR. Eine
 * auf einen Betragsbereich geeichte Achse faellt erst beim naechsten Kunden
 * auf, und dort als unbrauchbares Diagramm.
 */
function waehleGitter(max: number, min: number, wunsch: number): number[] {
  if (!(max - min > 0)) return [];
  const n0 = Math.max(1, Math.floor(wunsch));
  // Bei rein negativen Reihen ist `max` 0; dann gibt die Gegenseite das Mass.
  const bezug = max > 0 ? max : -min;
  const gegen = max > 0 ? -min : max;

  for (const n of [n0, n0 + 1, n0 - 1, n0 + 2, n0 + 3, 2, 1]) {
    if (!(n >= 1)) continue;
    const schritt = bezug / n;
    if (!(schritt > 0)) continue;
    // Ist der Abstand selbst eine lesbare Stufe?
    if (Math.abs(lesbareStufe(schritt) - schritt) > schritt * 1e-9) continue;
    // Liegt die Null auf einer Linie?
    if (
      gegen !== 0 &&
      Math.abs(gegen / schritt - Math.round(gegen / schritt)) > 1e-9
    )
      continue;
    const linien = (max - min) / schritt;
    // Mehr als ein Dutzend Linien ist kein Gitter mehr, sondern Schraffur.
    if (linien > 12 + 1e-9) continue;
    return achsenstufen(max, Math.round(linien), min);
  }

  // Keine Teilung war lesbar (eine Reihe, die weit ins Negative reicht und
  // knapp darueber endet). Dann die gleichmaessige Teilung -- lieber eine
  // unrunde Zahl an der Linie als keine Linie.
  return achsenstufen(max, n0, min);
}

/**
 * Die Werte der Gitterlinien: `anzahl` Abschnitte, also `anzahl + 1` Werte
 * von `min` bis `max`, beide einschliesslich.
 *
 * Gerundet auf zwei Stellen, damit nicht `1666.6666666666667` in der
 * Beschriftung steht.
 */
export function achsenstufen(
  max: number | null | undefined,
  anzahl = 4,
  min: number | null | undefined = 0,
): number[] {
  const hi = endlich(max) ?? 0;
  const lo = endlich(min) ?? 0;
  const n = Math.max(1, Math.floor(endlich(anzahl) ?? 4));
  if (!(hi - lo > 0)) return [];
  const aus: number[] = [];
  for (let i = 0; i <= n; i++) aus.push(runde2(lo + ((hi - lo) * i) / n));
  return aus;
}

// ---------------------------------------------------------------------------
// Balken
// ---------------------------------------------------------------------------

export interface BalkenFeld {
  index: number;
  /** Linke Kante des Balkens. */
  x: number;
  breite: number;
  /** Oberer Rand des Rechtecks. Bei negativem Wert die Nulllinie. */
  y: number;
  hoehe: number;
  /** Mitte der Spur -- fuer die Beschriftung unter dem Balken. */
  mitte: number;
  /** Der Wert, unveraendert. `null` heisst Luecke, nicht 0. */
  wert: number | null;
  /** true = nichts zu zeichnen, weil kein Wert vorliegt. */
  luecke: boolean;
  /** true = Wert unter 0, das Rechteck haengt unter der Nulllinie. */
  negativ: boolean;
}

export interface BalkenOptionen {
  /** Eine fertige Skala, wenn mehrere Reihen dieselbe teilen sollen. */
  skala?: Skala;
  /** Anteil der Spur, der Luft bleibt. 0 = Balken stossen aneinander. */
  luft?: number;
  stufen?: number;
}

/**
 * Rechtecke fuer eine Balkenreihe.
 *
 * Die Spurbreite ergibt sich aus der Gesamtbreite, nicht umgekehrt: Zwoelf
 * Monate muessen in dasselbe Feld wie drei, sonst laeuft das Diagramm aus
 * der Karte heraus.
 */
export function balkenGruppe(
  reihe: ReadonlyArray<number | null | undefined>,
  breite: number,
  hoehe: number,
  optionen: BalkenOptionen = {},
): { felder: BalkenFeld[]; skala: Skala; spur: number } {
  const b = endlich(breite);
  const breiteSicher = b !== null && b > 0 ? b : 0;
  const s = optionen.skala ?? skala(reihe, hoehe, optionen.stufen ?? 4);

  if (reihe.length === 0) {
    return { felder: [], skala: s, spur: 0 };
  }

  const spur = runde2(breiteSicher / reihe.length);
  const luft = Math.min(0.9, Math.max(0, endlich(optionen.luft) ?? 0.35));
  const balkenbreite = runde2(spur * (1 - luft));

  const felder = reihe.map((roh, index) => {
    const wert = endlich(roh);
    const x = runde2(index * spur + (spur - balkenbreite) / 2);
    const mitte = runde2(index * spur + spur / 2);
    if (wert === null) {
      return {
        index,
        x,
        breite: balkenbreite,
        y: s.nulllinie,
        hoehe: 0,
        mitte,
        wert: null,
        luecke: true,
        negativ: false,
      };
    }
    const laenge = s.laenge(wert);
    return {
      index,
      x,
      breite: balkenbreite,
      y: wert < 0 ? s.nulllinie : runde2(s.nulllinie - laenge),
      hoehe: laenge,
      mitte,
      wert,
      luecke: false,
      negativ: wert < 0,
    };
  });

  return { felder, skala: s, spur };
}

// ---------------------------------------------------------------------------
// Stapel
// ---------------------------------------------------------------------------

export interface StapelTeil {
  name: string;
  wert: number | null | undefined;
}

export interface StapelSegment {
  name: string;
  /** Der Wert, unveraendert -- auch wenn er nicht darstellbar war. */
  wert: number | null;
  /** Versatz vom Anfang des Stapels, in Pixeln. */
  versatz: number;
  laenge: number;
  /**
   * true = der Wert war negativ oder keine Zahl und konnte nicht gestapelt
   * werden. Er wird nicht stillschweigend auf 0 geklemmt, sondern gemeldet:
   * Die Komponente muss ihn benennen, sonst fehlt Geld im Bild und niemand
   * erfaehrt davon.
   */
  ungueltig: boolean;
}

export interface Stapel {
  segmente: StapelSegment[];
  /** Summe der darstellbaren Teile. */
  summe: number;
  /** Der Bezugswert, gegen den gestapelt wurde. */
  bezug: number;
  laenge: number;
  leer: boolean;
  /** true = mindestens ein Teil war nicht darstellbar. */
  ungueltig: boolean;
}

/**
 * Stapelt Posten mit laufendem Versatz.
 *
 * Gerechnet wird ueber die Grenzen, nicht ueber die Laengen: Die Position
 * jeder Trennlinie wird aus der Summe bis dorthin bestimmt, und die Laenge
 * eines Segments ist die Differenz zweier Grenzen. Dadurch ergeben die
 * Segmente zusammen **genau** die Gesamtlaenge -- rechnete man jede Laenge
 * einzeln und rundete sie, bliebe am Ende eine Luecke von einem halben
 * Pixel, und die sieht aus wie ein Posten, den es nicht gibt.
 *
 * `bezug` ist der Wert, der die ganze Laenge ausmacht. Ohne Angabe ist das
 * die Summe der Teile; mit Angabe (z. B. das gestellte Soll) fuellen die
 * Teile nur den Teil davon, den sie erklaeren -- der Rest bleibt sichtbar
 * leer, und das ist die Aussage.
 */
export function stapel(
  posten: ReadonlyArray<StapelTeil>,
  laenge: number,
  bezug?: number,
): Stapel {
  const l = Math.max(0, endlich(laenge) ?? 0);

  const teile = posten.map((p) => {
    const w = endlich(p.wert);
    const brauchbar = w !== null && w >= 0;
    return {
      name: p.name,
      wert: w,
      zaehlt: brauchbar ? (w as number) : 0,
      ungueltig: !brauchbar,
    };
  });

  const summe = runde2(teile.reduce((s, t) => s + t.zaehlt, 0));
  const vorgabe = endlich(bezug);
  const bezugswert = vorgabe !== null && vorgabe > 0 ? runde2(vorgabe) : summe;
  const leer = !(bezugswert > 0) || teile.length === 0;

  let kumuliert = 0;
  let vorige = 0;
  const segmente = teile.map((t, i) => {
    kumuliert = runde2(kumuliert + t.zaehlt);
    const letzter = i === teile.length - 1;
    let grenze: number;
    if (leer) {
      grenze = 0;
    } else if (letzter && Math.abs(kumuliert - bezugswert) < 0.005) {
      // Der letzte Posten schliesst den Stapel ab: exakt die Gesamtlaenge,
      // nicht 99,98 Prozent davon.
      grenze = l;
    } else {
      grenze = runde2((l * kumuliert) / bezugswert);
    }
    const seg: StapelSegment = {
      name: t.name,
      wert: t.wert,
      versatz: vorige,
      laenge: runde2(grenze - vorige),
      ungueltig: t.ungueltig,
    };
    vorige = grenze;
    return seg;
  });

  return {
    segmente,
    summe,
    bezug: bezugswert,
    laenge: l,
    leer,
    ungueltig: teile.some((t) => t.ungueltig),
  };
}

// ---------------------------------------------------------------------------
// Linien
// ---------------------------------------------------------------------------

export interface Punkt {
  x: number;
  y: number;
}

/** Pixelzahl fuer das Markup: hoechstens zwei Stellen, kein `NaN`. */
function px(n: number): string {
  return String(runde2(n));
}

/** Zusammenhaengende Abschnitte -- getrennt von jeder Luecke. */
function abschnitte(
  punkte: ReadonlyArray<Punkt | null | undefined>,
): Punkt[][] {
  const aus: Punkt[][] = [];
  let lauf: Punkt[] = [];
  for (const p of punkte) {
    const x = p ? endlich(p.x) : null;
    const y = p ? endlich(p.y) : null;
    if (x === null || y === null) {
      if (lauf.length > 0) aus.push(lauf);
      lauf = [];
      continue;
    }
    lauf.push({ x, y });
  }
  if (lauf.length > 0) aus.push(lauf);
  return aus;
}

/**
 * Der `d`-Pfad eines Linienzugs.
 *
 * Eine Luecke trennt den Pfad: der naechste Abschnitt beginnt mit einem
 * neuen `M`. Wuerde die Linie durchgezogen, behauptete sie fuer den
 * fehlenden Monat einen Zwischenwert -- also eine Zahl, die niemand kennt.
 *
 * Ein einzelner Punkt wird als `M x,y L x,y` ausgegeben. Ein `M` allein
 * zeichnet nichts; mit dem `L` auf sich selbst setzt ein runder Linienkopf
 * einen Punkt, und der einzige Monat mit Daten ist sichtbar.
 */
export function linienPfad(
  punkte: ReadonlyArray<Punkt | null | undefined>,
): string {
  return abschnitte(punkte)
    .map((lauf) => {
      const kopf = `M ${px(lauf[0].x)},${px(lauf[0].y)}`;
      if (lauf.length === 1) return `${kopf} L ${px(lauf[0].x)},${px(lauf[0].y)}`;
      return (
        kopf +
        lauf
          .slice(1)
          .map((p) => ` L ${px(p.x)},${px(p.y)}`)
          .join("")
      );
    })
    .join(" ");
}

/**
 * Der `d`-Pfad der gefuellten Flaeche unter einem Linienzug.
 *
 * Je Abschnitt eine eigene geschlossene Form. Eine Flaeche, die eine Luecke
 * ueberspannt, faerbt einen Monat ein, ueber den nichts bekannt ist.
 */
export function flaechePfad(
  punkte: ReadonlyArray<Punkt | null | undefined>,
  grundlinie: number,
): string {
  const g = endlich(grundlinie);
  if (g === null) return "";
  return abschnitte(punkte)
    .map((lauf) => {
      const erster = lauf[0];
      const letzter = lauf[lauf.length - 1];
      return (
        `M ${px(erster.x)},${px(g)}` +
        lauf.map((p) => ` L ${px(p.x)},${px(p.y)}`).join("") +
        ` L ${px(letzter.x)},${px(g)} Z`
      );
    })
    .join(" ");
}

// ---------------------------------------------------------------------------
// Ring
// ---------------------------------------------------------------------------

export interface RingMass {
  /** Derselbe Wert gehoert als `pathLength` an den Kreis im Markup. */
  umfang: number;
  strokeDasharray: string;
  strokeDashoffset: string;
  /** Der Anteil, 0 bis 1 -- geklemmt durch `anteil()` aus kennzahlen.ts. */
  anteil: number;
  /** Derselbe Anteil in Prozent, auf zwei Stellen. */
  prozent: number;
}

/**
 * Strich und Luecke fuer einen Ring, der einen Anteil zeigt.
 *
 * Der Umfang ist frei gewaehlt (100 als Voreinstellung) und gehoert im
 * Markup als `pathLength` an denselben Kreis -- dann muss der Radius
 * nirgends in die Rechnung, und ein geaenderter Radius verschiebt den Ring
 * nicht.
 *
 * Geklemmt wird mit `anteil()` aus lib/kennzahlen.ts: `NaN` wird 0,
 * Negatives wird 0, und ueber 1 wird 1. Ein Ring, der sich mehr als einmal
 * herumlegt, ist keine Quote mehr.
 */
export function ringAnteil(wert: number | null | undefined, umfang = 100): RingMass {
  const u = endlich(umfang);
  const umfangSicher = u !== null && u > 0 ? u : 100;
  const a = anteil(endlich(wert) ?? 0, 1);
  const voll = runde2(umfangSicher * a);
  return {
    umfang: umfangSicher,
    strokeDasharray: `${voll} ${runde2(umfangSicher - voll)}`,
    strokeDashoffset: "0",
    anteil: a,
    prozent: runde2(a * 100),
  };
}

/**
 * Punkte fuer eine Monatsreihe auf einer gegebenen Skala.
 *
 * Der x-Wert liegt in der Mitte der Spur, damit Linie und Balken desselben
 * Monats uebereinander stehen. `null` bleibt `null` -- siehe Regel 1 oben.
 */
export function reihenPunkte(
  werte: ReadonlyArray<number | null | undefined>,
  breite: number,
  s: Skala,
): Array<Punkt | null> {
  const b = endlich(breite);
  const breiteSicher = b !== null && b > 0 ? b : 0;
  if (werte.length === 0) return [];
  const spur = breiteSicher / werte.length;
  return werte.map((w, i) => {
    const n = endlich(w);
    if (n === null) return null;
    return { x: runde2(i * spur + spur / 2), y: s.y(n) };
  });
}
