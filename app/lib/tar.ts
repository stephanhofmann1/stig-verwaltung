import { gunzipSync } from "node:zlib";

/**
 * Ein strenger Leser fuer tar- und tar.gz-Archive.
 *
 * WARUM NICHT DAS SYSTEM-TAR
 *
 * Ein eingeliefertes Archiv kommt von aussen. `tar -x` wuerde darin
 * ausfuehren, was drinsteht: Pfade mit `..`, absolute Pfade, symbolische
 * Verweise auf /etc, Geraetedateien, harte Verweise auf Dateien, die es
 * schon gibt. Jede dieser Moeglichkeiten ist ein Weg, ausserhalb des
 * Zielverzeichnisses zu schreiben -- und sie laesst sich mit Schaltern
 * nicht sicher abstellen, sondern nur hoffentlich.
 *
 * Dieser Leser entpackt gar nicht auf die Platte. Er gibt Name und Inhalt
 * zurueck, und der Aufrufer entscheidet, wohin das geht. Was kein
 * gewoehnliches Dateielement ist, wird nicht uebersprungen und nicht
 * entschaerft, sondern mit Grund gemeldet: Ein Archiv, das symbolische
 * Verweise mitbringt, ist kein Belegstapel.
 *
 * WAS ER KANN UND WAS NICHT
 *
 * Gelesen werden ustar und das GNU-Format, einschliesslich langer Namen
 * ueber den GNU-Satz 'L' und ueber pax-Kopfsaetze ('x', Schluessel
 * `path`). Beides ist noetig, weil die Namen hier lang sind: Datum,
 * Objekt, Artikel und Betrag stehen im Dateinamen, und das Namensfeld im
 * tar-Kopf hat 100 Zeichen.
 *
 * Nicht gelesen werden Verzeichniseintraege (sie tragen keinen Inhalt und
 * werden hier nicht gebraucht), Pax-Verzeichnissaetze ('g') und alles
 * weitere. Verzeichnisse werden still verworfen, der Rest gemeldet.
 */

/** Hoechstens so viele Dateien in einem Archiv. */
export const MAX_EINTRAEGE = 500;
/** Hoechstens so gross je Datei -- dieselbe Grenze wie beim Einzelupload. */
export const MAX_DATEI_BYTES = 25 * 1024 * 1024;
/**
 * Hoechstens so gross entpackt, zusammen.
 *
 * Diese Grenze ist die eigentliche Sicherung gegen eine Archivbombe: Ein
 * Gzip-Strom von wenigen Kilobyte kann sich auf Gigabyte aufblasen, und
 * das faellt erst auf, wenn der Arbeitsspeicher weg ist. Deshalb wird sie
 * schon beim Auspacken des Gzip-Mantels durchgesetzt und nicht erst beim
 * Zaehlen der Eintraege.
 */
export const MAX_GESAMT_BYTES = 300 * 1024 * 1024;

export interface TarEintrag {
  name: string;
  inhalt: Buffer;
}

export class TarFehler extends Error {}

const BLOCK = 512;

function istGzip(b: Buffer): boolean {
  return b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;
}

/** Nullterminierter Text aus einem Kopffeld. */
function feld(b: Buffer, von: number, laenge: number): string {
  const roh = b.subarray(von, von + laenge);
  const ende = roh.indexOf(0);
  return roh.subarray(0, ende === -1 ? roh.length : ende).toString("utf8");
}

/**
 * Oktalzahl aus einem Kopffeld.
 *
 * GNU schreibt grosse Zahlen binaer mit gesetztem hoechsten Bit. Das
 * kommt bei Belegen nicht vor (die Grenze liegt bei 25 MB, oktal
 * darstellbar), wird aber abgewiesen statt falsch gelesen -- eine als 0
 * gelesene Groesse wuerde den Strom lautlos verschieben und danach
 * Unsinn liefern.
 */
function oktal(b: Buffer, von: number, laenge: number): number {
  const roh = b.subarray(von, von + laenge);
  if (roh.length > 0 && (roh[0] & 0x80) !== 0) {
    throw new TarFehler("Das Archiv benutzt binaere Zahlenfelder (GNU-Erweiterung).");
  }
  const t = roh.toString("ascii").replace(/\0/g, " ").trim();
  if (t === "") return 0;
  if (!/^[0-7]+$/.test(t)) {
    throw new TarFehler("Ein Zahlenfeld im Archivkopf ist keine Oktalzahl.");
  }
  return parseInt(t, 8);
}

/**
 * Die Pruefsumme des Kopfsatzes.
 *
 * Sie steht selbst im Kopf und wird fuer die Berechnung als Leerzeichen
 * gelesen. Ohne diese Pruefung wuerde jede beliebige Datei als Archiv
 * durchgehen, solange zufaellig ein plausibles Namensfeld darin steht --
 * und der Leser liefe durch den Rest der Datei, als waere er ein Archiv.
 */
function pruefsummeStimmt(kopf: Buffer): boolean {
  const soll = oktal(kopf, 148, 8);
  let summe = 0;
  for (let i = 0; i < BLOCK; i++) {
    summe += i >= 148 && i < 156 ? 0x20 : kopf[i];
  }
  return summe === soll;
}

/**
 * Ist der Name harmlos?
 *
 * Verlangt wird ein relativer Pfad aus gewoehnlichen Bestandteilen. `..`
 * als Bestandteil, ein fuehrender Schraegstrich, ein Laufwerksbuchstabe
 * und Steuerzeichen fuehren zur Ablehnung. Der Rueckschraegstrich ist
 * auch verboten: Unter Windows trennt er Pfade, und ein Name wie
 * `..\\..\\etc` waere hier ein gueltiger Dateiname mit boeser Absicht.
 */
export function nameIstHarmlos(name: string): boolean {
  if (name === "" || name.length > 400) return false;
  if (name.startsWith("/") || /^[A-Za-z]:/.test(name)) return false;
  if (name.includes("\\")) return false;
  if (/[\u0000-\u001f]/.test(name)) return false;
  return !name.split("/").some((t) => t === ".." || t === ".");
}

/**
 * Liest ein Archiv und gibt die enthaltenen Dateien zurueck.
 *
 * Wirft TarFehler, sobald etwas nicht stimmt. Kein teilweises Ergebnis:
 * Ein Archiv, in dem auf halbem Weg ein symbolischer Verweis steckt, ist
 * als Ganzes verdaechtig, und die erste Haelfte einzuliefern waere die
 * schlechteste aller Antworten.
 */
export function leseTar(roh: Buffer): TarEintrag[] {
  let daten: Buffer;
  if (istGzip(roh)) {
    try {
      daten = gunzipSync(roh, { maxOutputLength: MAX_GESAMT_BYTES });
    } catch (e) {
      const m = (e as Error).message ?? "";
      throw new TarFehler(
        /maxOutputLength|buffer/i.test(m)
          ? `Entpackt ueberschreitet das Archiv ${Math.round(MAX_GESAMT_BYTES / 1024 / 1024)} MB.`
          : "Das Archiv laesst sich nicht entpacken (kein gueltiges gzip).",
      );
    }
  } else {
    daten = roh;
  }

  if (daten.length === 0 || daten.length % BLOCK !== 0) {
    throw new TarFehler("Keine tar-Datei: die Laenge ist kein Vielfaches von 512.");
  }

  const eintraege: TarEintrag[] = [];
  let gesamt = 0;
  // Ein vorangestellter langer Name ('L' oder pax) gilt fuer den
  // naechsten Satz und nur fuer ihn.
  let langerName: string | null = null;
  let pos = 0;
  let leere = 0;

  while (pos + BLOCK <= daten.length) {
    const kopf = daten.subarray(pos, pos + BLOCK);
    pos += BLOCK;

    // Zwei Nullbloecke beenden das Archiv. Ein einzelner kann Fuellung
    // sein.
    if (kopf.every((b) => b === 0)) {
      if (++leere >= 2) break;
      continue;
    }
    leere = 0;

    if (!pruefsummeStimmt(kopf)) {
      throw new TarFehler("Der Archivkopf hat eine falsche Pruefsumme.");
    }

    const groesse = oktal(kopf, 124, 12);
    if (groesse < 0) throw new TarFehler("Negative Groesse im Archivkopf.");
    const belegt = Math.ceil(groesse / BLOCK) * BLOCK;
    if (pos + belegt > daten.length) {
      throw new TarFehler("Das Archiv ist abgeschnitten.");
    }
    const inhalt = daten.subarray(pos, pos + groesse);
    pos += belegt;

    const typ = String.fromCharCode(kopf[156]);

    // GNU: langer Name als eigener Satz vor der Datei.
    if (typ === "L") {
      langerName = inhalt.toString("utf8").replace(/\0+$/, "");
      continue;
    }
    // pax: Kopfsatz mit Schluessel/Wert-Paaren, hier zaehlt `path`.
    if (typ === "x") {
      const t = inhalt.toString("utf8");
      const m = /\d+ path=([^\n]*)\n/.exec(t);
      if (m) langerName = m[1];
      continue;
    }
    // pax-Verzeichnissatz: gilt fuer das ganze Archiv, enthaelt hier
    // nichts, was gebraucht wird.
    if (typ === "g") continue;

    const vorsatz = feld(kopf, 345, 155);
    const kurz = feld(kopf, 0, 100);
    const name = langerName ?? (vorsatz ? `${vorsatz}/${kurz}` : kurz);
    langerName = null;

    // Verzeichnisse tragen keinen Inhalt.
    if (typ === "5" || name.endsWith("/")) continue;

    if (typ !== "0" && typ !== "\u0000" && typ !== "7") {
      throw new TarFehler(
        `Das Archiv enthaelt "${name.slice(0, 80)}" als Eintrag der Art '${typ}'. ` +
          "Zugelassen sind nur gewoehnliche Dateien -- keine Verweise, " +
          "keine Geraetedateien.",
      );
    }
    if (!nameIstHarmlos(name)) {
      throw new TarFehler(
        `Unzulaessiger Name im Archiv: "${name.slice(0, 80)}". ` +
          "Erwartet wird ein relativer Pfad, ohne Punkt-Punkt als " +
          "Bestandteil und ohne Rueckschraegstrich.",
      );
    }
    if (groesse > MAX_DATEI_BYTES) {
      throw new TarFehler(
        `"${name.slice(0, 80)}" ist groesser als ` +
          `${Math.round(MAX_DATEI_BYTES / 1024 / 1024)} MB.`,
      );
    }
    gesamt += groesse;
    if (gesamt > MAX_GESAMT_BYTES) {
      throw new TarFehler(
        `Das Archiv enthaelt mehr als ${Math.round(MAX_GESAMT_BYTES / 1024 / 1024)} MB.`,
      );
    }
    if (eintraege.length >= MAX_EINTRAEGE) {
      throw new TarFehler(`Mehr als ${MAX_EINTRAEGE} Dateien in einem Archiv.`);
    }

    // Kopie, nicht Sicht: subarray teilt den Speicher des ganzen
    // Archivs, und der soll nach dem Lesen freigegeben werden koennen.
    eintraege.push({ name, inhalt: Buffer.from(inhalt) });
  }

  if (eintraege.length === 0) {
    throw new TarFehler("Das Archiv enthaelt keine Dateien.");
  }
  return eintraege;
}
