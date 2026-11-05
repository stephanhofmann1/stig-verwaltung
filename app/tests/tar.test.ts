import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";

import {
  leseTar,
  nameIstHarmlos,
  TarFehler,
  MAX_DATEI_BYTES,
} from "../lib/tar";

/**
 * Tests des Archivlesers.
 *
 * Dieser Leser bekommt Dateien von aussen und entscheidet, was daraus in
 * die Belegablage geht. Die Prüfungen hier sind deshalb nicht Formsache:
 * Jeder durchgelassene Pfad mit `..` wäre ein Schreibzugriff ausserhalb
 * der Ablage, jeder durchgelassene symbolische Verweis ein Leseweg in
 * fremde Dateien.
 *
 * Alle Namen und Inhalte in dieser Datei sind erfunden.
 */

const BLOCK = 512;

/** Baut einen tar-Kopfsatz, wie ihn ustar vorsieht. */
function kopf(opts: {
  name: string;
  groesse: number;
  typ?: string;
  vorsatz?: string;
  pruefsummeKaputt?: boolean;
}): Buffer {
  const b = Buffer.alloc(BLOCK, 0);
  b.write(opts.name.slice(0, 100), 0, "utf8");
  b.write("0000644\0", 100, "ascii"); // Rechte
  b.write("0000000\0", 108, "ascii"); // Eigentümer
  b.write("0000000\0", 116, "ascii"); // Gruppe
  b.write(opts.groesse.toString(8).padStart(11, "0") + "\0", 124, "ascii");
  b.write("00000000000\0", 136, "ascii"); // Zeit
  b.write("        ", 148, "ascii"); // Pruefsummenfeld: Leerzeichen
  b.write(opts.typ ?? "0", 156, "ascii");
  b.write("ustar\0", 257, "ascii");
  b.write("00", 263, "ascii");
  if (opts.vorsatz) b.write(opts.vorsatz.slice(0, 155), 345, "utf8");

  let summe = 0;
  for (let i = 0; i < BLOCK; i++) summe += b[i];
  if (opts.pruefsummeKaputt) summe += 1;
  b.write(summe.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
  return b;
}

/** Füllt einen Inhalt auf ein Vielfaches von 512 auf. */
function daten(inhalt: Buffer): Buffer {
  const rest = inhalt.length % BLOCK;
  return rest === 0
    ? inhalt
    : Buffer.concat([inhalt, Buffer.alloc(BLOCK - rest, 0)]);
}

function ende(): Buffer {
  return Buffer.alloc(BLOCK * 2, 0);
}

function archiv(
  teile: Array<{ name: string; inhalt: Buffer; typ?: string; vorsatz?: string }>,
): Buffer {
  const stuecke: Buffer[] = [];
  for (const t of teile) {
    stuecke.push(
      kopf({ name: t.name, groesse: t.inhalt.length, typ: t.typ, vorsatz: t.vorsatz }),
    );
    stuecke.push(daten(t.inhalt));
  }
  stuecke.push(ende());
  return Buffer.concat(stuecke);
}

describe("Namen prüfen", () => {
  test("gewöhnliche relative Pfade sind in Ordnung", () => {
    assert.equal(nameIstHarmlos("beleg.pdf"), true);
    assert.equal(nameIstHarmlos("Amazon/2026-03-09_Giessen_Sache_45-44EUR.pdf"), true);
  });

  test("Pfade aus der Ablage heraus werden abgewiesen", () => {
    assert.equal(nameIstHarmlos("../beleg.pdf"), false);
    assert.equal(nameIstHarmlos("a/../../etc/passwd"), false);
    assert.equal(nameIstHarmlos("/etc/passwd"), false);
    assert.equal(nameIstHarmlos("C:/windows/system32"), false);
  });

  test("Rückschrägstrich wird abgewiesen -- unter Windows trennt er Pfade", () => {
    assert.equal(nameIstHarmlos("..\\..\\etc"), false);
    assert.equal(nameIstHarmlos("ordner\\beleg.pdf"), false);
  });

  test("Steuerzeichen und leere Namen werden abgewiesen", () => {
    assert.equal(nameIstHarmlos(""), false);
    assert.equal(nameIstHarmlos("beleg\u0000.pdf"), false);
    assert.equal(nameIstHarmlos("beleg\n.pdf"), false);
  });
});

describe("Archive lesen", () => {
  test("zwei Dateien kommen mit Name und Inhalt zurück", () => {
    const a = archiv([
      { name: "eins.pdf", inhalt: Buffer.from("INHALT EINS") },
      { name: "zwei.pdf", inhalt: Buffer.from("INHALT ZWEI") },
    ]);
    const e = leseTar(a);
    assert.equal(e.length, 2);
    assert.equal(e[0].name, "eins.pdf");
    assert.equal(e[0].inhalt.toString(), "INHALT EINS");
    assert.equal(e[1].inhalt.toString(), "INHALT ZWEI");
  });

  test("gzip wird erkannt und entpackt", () => {
    const a = gzipSync(archiv([{ name: "eins.pdf", inhalt: Buffer.from("X") }]));
    const e = leseTar(a);
    assert.equal(e.length, 1);
    assert.equal(e[0].inhalt.toString(), "X");
  });

  test("der Vorsatz wird dem Namen vorangestellt", () => {
    const a = archiv([
      { name: "beleg.pdf", inhalt: Buffer.from("X"), vorsatz: "Amazon/Giessen" },
    ]);
    assert.equal(leseTar(a)[0].name, "Amazon/Giessen/beleg.pdf");
  });

  test("Verzeichniseinträge werden verworfen, nicht gemeldet", () => {
    const a = archiv([
      { name: "ordner/", inhalt: Buffer.alloc(0), typ: "5" },
      { name: "ordner/beleg.pdf", inhalt: Buffer.from("X") },
    ]);
    const e = leseTar(a);
    assert.equal(e.length, 1);
    assert.equal(e[0].name, "ordner/beleg.pdf");
  });

  test("ein langer Name nach GNU-Art gilt für den nächsten Satz", () => {
    const lang = "Amazon STIG Immobilien/Giessen/" + "a".repeat(120) + ".pdf";
    const a = Buffer.concat([
      kopf({ name: "././@LongLink", groesse: lang.length, typ: "L" }),
      daten(Buffer.from(lang)),
      kopf({ name: lang.slice(0, 100), groesse: 1, typ: "0" }),
      daten(Buffer.from("X")),
      ende(),
    ]);
    const e = leseTar(a);
    assert.equal(e.length, 1);
    assert.equal(e[0].name, lang);
  });

  test("ein langer Name nach pax-Art gilt für den nächsten Satz", () => {
    const lang = "Belege/" + "b".repeat(120) + ".pdf";
    const satz = `${String(lang.length + 8).length + lang.length + 7} path=${lang}\n`;
    const a = Buffer.concat([
      kopf({ name: "PaxHeaders/beleg", groesse: satz.length, typ: "x" }),
      daten(Buffer.from(satz)),
      kopf({ name: "beleg.pdf", groesse: 1, typ: "0" }),
      daten(Buffer.from("X")),
      ende(),
    ]);
    assert.equal(leseTar(a)[0].name, lang);
  });
});

describe("Was abgewiesen wird", () => {
  test("ein symbolischer Verweis bringt das ganze Archiv zu Fall", () => {
    const a = archiv([
      { name: "beleg.pdf", inhalt: Buffer.from("X") },
      { name: "boese", inhalt: Buffer.alloc(0), typ: "2" },
    ]);
    assert.throws(() => leseTar(a), (e: Error) => {
      assert.ok(e instanceof TarFehler);
      assert.match(e.message, /gewoehnliche Dateien/);
      return true;
    });
  });

  test("ein harter Verweis wird abgewiesen", () => {
    const a = archiv([{ name: "x", inhalt: Buffer.alloc(0), typ: "1" }]);
    assert.throws(() => leseTar(a), TarFehler);
  });

  test("ein Pfad mit .. wird abgewiesen", () => {
    const a = archiv([{ name: "../../etc/passwd", inhalt: Buffer.from("X") }]);
    assert.throws(() => leseTar(a), (e: Error) => {
      assert.match(e.message, /Unzul/);
      return true;
    });
  });

  test("eine falsche Prüfsumme wird abgewiesen", () => {
    const k = kopf({ name: "x.pdf", groesse: 1, pruefsummeKaputt: true });
    const a = Buffer.concat([k, daten(Buffer.from("X")), ende()]);
    assert.throws(() => leseTar(a), (e: Error) => {
      assert.match(e.message, /Pruefsumme/);
      return true;
    });
  });

  test("eine beliebige Datei ist kein Archiv", () => {
    assert.throws(() => leseTar(Buffer.alloc(1024, 0x41)), TarFehler);
  });

  test("eine abgeschnittene Datei wird abgewiesen", () => {
    const k = kopf({ name: "x.pdf", groesse: 4096 });
    assert.throws(() => leseTar(Buffer.concat([k, Buffer.alloc(512)])), TarFehler);
  });

  test("eine Länge, die kein Vielfaches von 512 ist, wird abgewiesen", () => {
    assert.throws(() => leseTar(Buffer.alloc(700, 0)), TarFehler);
  });

  test("eine zu grosse Einzeldatei wird abgewiesen", () => {
    // Nur der Kopf wird gebaut; der Inhalt müsste nicht wirklich
    // vorhanden sein, denn die Grenze greift vor dem Lesen.
    const k = kopf({ name: "gross.pdf", groesse: MAX_DATEI_BYTES + 1 });
    const a = Buffer.concat([k, Buffer.alloc(MAX_DATEI_BYTES + BLOCK), ende()]);
    assert.throws(() => leseTar(a), (e: Error) => {
      assert.match(e.message, /groesser als/);
      return true;
    });
  });

  test("ein leeres Archiv wird abgewiesen", () => {
    assert.throws(() => leseTar(ende()), (e: Error) => {
      assert.match(e.message, /keine Dateien/);
      return true;
    });
  });

  test("binäre Zahlenfelder werden gemeldet, nicht als 0 gelesen", () => {
    const k = kopf({ name: "x.pdf", groesse: 1 });
    k[124] = 0x80; // hoechstes Bit im Groessenfeld
    const a = Buffer.concat([k, daten(Buffer.from("X")), ende()]);
    assert.throws(() => leseTar(a), (e: Error) => {
      assert.match(e.message, /binaere Zahlenfelder|Pruefsumme/);
      return true;
    });
  });
});
