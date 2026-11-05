import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

/**
 * Ein ZIP-Schreiber, der im Strom arbeitet.
 *
 * WARUM ZIP UND NICHT TAR
 *
 * Das Paket geht an den Steuerberater. Ein tar.gz wird dort auf einem
 * Windows-Rechner geoeffnet, oder eben nicht. ZIP oeffnet jedes
 * Betriebssystem ohne Zusatzprogramm. Das ist der ganze Grund.
 *
 * WARUM IM STROM UND NICHT IM SPEICHER
 *
 * Das Paket enthaelt jeden Einzelbeleg. Am 05.11.2026 waren das 297
 * Dateien, davon 86 Scans -- zusammen etwa 200 MB. Ein ZIP, das erst
 * fertig im Arbeitsspeicher steht und dann ausgeliefert wird, belegt
 * diese 200 MB auf einem Server, der 2 GB hat, und zwar zusaetzlich zu
 * allem anderen. Beim zweiten gleichzeitigen Abruf ist er weg.
 *
 * Deshalb: Jede Datei wird gelesen und sofort weitergeschrieben, und nur
 * das Verzeichnis am Ende wird gesammelt. Dessen Groesse haengt an der
 * Zahl der Dateien, nicht an ihrer Groesse -- bei 300 Belegen sind das
 * einige Kilobyte.
 *
 * WARUM OHNE KOMPRESSION
 *
 * Die Belege sind PDFs und JPEGs. Beides ist schon komprimiert; ein
 * zweiter Durchgang bringt wenige Prozent und kostet Rechenzeit je Byte.
 * Gespeichert wird deshalb unveraendert (Methode 0). Die Textdateien im
 * Paket sind klein genug, dass es nicht auffaellt.
 *
 * WARUM MIT NACHGESTELLTER PRUEFSUMME
 *
 * Im ZIP-Format steht die Pruefsumme einer Datei VOR ihrem Inhalt. Wer im
 * Strom schreibt, kennt sie dort noch nicht -- er muesste die Datei
 * zweimal lesen. Das Format kennt dafuer den nachgestellten Datensatz
 * (Bit 3 im Merker): Pruefsumme und Groessen stehen hinter dem Inhalt.
 * Jedes gaengige Entpackprogramm liest das seit Jahrzehnten.
 */

const CRC_TABELLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(daten: Buffer, start = 0xffffffff): number {
  let c = start;
  for (let i = 0; i < daten.length; i++) {
    c = CRC_TABELLE[(c ^ daten[i]) & 0xff] ^ (c >>> 8);
  }
  return c >>> 0;
}

export function crc32Fertig(c: number): number {
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Datum und Zeit im MS-DOS-Format.
 *
 * Das Format kennt nur Jahre ab 1980 und Sekunden in Zweierschritten.
 * Beides ist hier ohne Belang -- es geht um das Datum, das der
 * Entpacker anzeigt.
 */
function dosZeit(d: Date): { zeit: number; datum: number } {
  const jahr = Math.max(1980, d.getFullYear());
  return {
    zeit: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    datum: ((jahr - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export interface ZipQuelle {
  /** Pfad im Archiv, mit Schrägstrichen. */
  name: string;
  /** Entweder der Inhalt direkt ... */
  inhalt?: Buffer;
  /** ... oder eine Datei auf der Platte, die gelesen werden soll. */
  pfad?: string;
}

interface Verzeichniseintrag {
  name: Buffer;
  crc: number;
  groesse: number;
  versatz: number;
  zeit: number;
  datum: number;
}

const MERKER_NACHGESTELLT = 0x0008;
/** Namen als UTF-8 kennzeichnen, sonst liest Windows Umlaute falsch. */
const MERKER_UTF8 = 0x0800;

/**
 * Baut das Archiv als asynchrone Folge von Stücken.
 *
 * Fehlt eine Datei auf der Platte, wird sie nicht stillschweigend
 * ausgelassen: Der Rückruf `fehlt` wird gerufen, und der Aufrufer
 * entscheidet. Ein Belegpaket, aus dem ein Beleg fehlt, ohne dass es
 * jemand erfährt, ist schlimmer als ein Fehler beim Erstellen -- es wird
 * weitergegeben und erst beim Steuerberater bemerkt.
 */
export async function* zipStrom(
  quellen: ZipQuelle[],
  fehlt?: (q: ZipQuelle, grund: string) => void,
): AsyncGenerator<Buffer> {
  const verzeichnis: Verzeichniseintrag[] = [];
  let versatz = 0;
  const jetzt = dosZeit(new Date());

  for (const q of quellen) {
    const name = Buffer.from(q.name, "utf8");

    let groesse: number;
    if (q.inhalt) {
      groesse = q.inhalt.length;
    } else if (q.pfad) {
      try {
        const s = await stat(q.pfad);
        if (!s.isFile()) throw new Error("keine gewöhnliche Datei");
        groesse = s.size;
      } catch (e) {
        fehlt?.(q, (e as Error).message);
        continue;
      }
    } else {
      fehlt?.(q, "weder Inhalt noch Pfad angegeben");
      continue;
    }

    // --- Ortsdatensatz ---
    const kopf = Buffer.alloc(30);
    kopf.writeUInt32LE(0x04034b50, 0);
    kopf.writeUInt16LE(20, 4); // Mindestversion 2.0
    kopf.writeUInt16LE(MERKER_NACHGESTELLT | MERKER_UTF8, 6);
    kopf.writeUInt16LE(0, 8); // Methode 0: gespeichert
    kopf.writeUInt16LE(jetzt.zeit, 10);
    kopf.writeUInt16LE(jetzt.datum, 12);
    // Pruefsumme und Groessen stehen im nachgestellten Datensatz.
    kopf.writeUInt32LE(0, 14);
    kopf.writeUInt32LE(0, 18);
    kopf.writeUInt32LE(0, 22);
    kopf.writeUInt16LE(name.length, 26);
    kopf.writeUInt16LE(0, 28);
    yield kopf;
    yield name;

    let crc = 0xffffffff;
    let geschrieben = 0;
    if (q.inhalt) {
      crc = crc32(q.inhalt, crc);
      geschrieben = q.inhalt.length;
      yield q.inhalt;
    } else if (q.pfad) {
      for await (const stueck of createReadStream(q.pfad)) {
        const b = stueck as Buffer;
        crc = crc32(b, crc);
        geschrieben += b.length;
        yield b;
      }
    }
    const fertig = crc32Fertig(crc);

    // --- Nachgestellter Datensatz ---
    const nach = Buffer.alloc(16);
    nach.writeUInt32LE(0x08074b50, 0);
    nach.writeUInt32LE(fertig, 4);
    nach.writeUInt32LE(geschrieben, 8);
    nach.writeUInt32LE(geschrieben, 12);
    yield nach;

    verzeichnis.push({
      name,
      crc: fertig,
      groesse: geschrieben,
      versatz,
      zeit: jetzt.zeit,
      datum: jetzt.datum,
    });
    versatz += kopf.length + name.length + geschrieben + nach.length;
  }

  // --- Zentrales Verzeichnis ---
  const beginn = versatz;
  let laenge = 0;
  for (const e of verzeichnis) {
    const z = Buffer.alloc(46);
    z.writeUInt32LE(0x02014b50, 0);
    z.writeUInt16LE(20, 4); // erzeugt von Version 2.0
    z.writeUInt16LE(20, 6); // benötigte Version
    z.writeUInt16LE(MERKER_NACHGESTELLT | MERKER_UTF8, 8);
    z.writeUInt16LE(0, 10);
    z.writeUInt16LE(e.zeit, 12);
    z.writeUInt16LE(e.datum, 14);
    z.writeUInt32LE(e.crc, 16);
    z.writeUInt32LE(e.groesse, 20);
    z.writeUInt32LE(e.groesse, 24);
    z.writeUInt16LE(e.name.length, 28);
    z.writeUInt16LE(0, 30);
    z.writeUInt16LE(0, 32);
    z.writeUInt16LE(0, 34);
    z.writeUInt16LE(0, 36);
    z.writeUInt32LE(0, 38);
    z.writeUInt32LE(e.versatz, 42);
    yield z;
    yield e.name;
    laenge += z.length + e.name.length;
  }

  // --- Abschluss ---
  const schluss = Buffer.alloc(22);
  schluss.writeUInt32LE(0x06054b50, 0);
  schluss.writeUInt16LE(0, 4);
  schluss.writeUInt16LE(0, 6);
  schluss.writeUInt16LE(verzeichnis.length, 8);
  schluss.writeUInt16LE(verzeichnis.length, 10);
  schluss.writeUInt32LE(laenge, 12);
  schluss.writeUInt32LE(beginn, 16);
  schluss.writeUInt16LE(0, 20);
  yield schluss;
}

/** Für Tests und kleine Pakete: alles in einen Puffer. */
export async function zipPuffer(quellen: ZipQuelle[]): Promise<Buffer> {
  const stuecke: Buffer[] = [];
  for await (const s of zipStrom(quellen)) stuecke.push(Buffer.from(s));
  return Buffer.concat(stuecke);
}
