import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { crc32, crc32Fertig, zipPuffer, zipStrom } from "../lib/zip";

/**
 * Tests des ZIP-Schreibers.
 *
 * Das Paket, das hier entsteht, geht an den Steuerberater. Ein Archiv,
 * das sich bei ihm nicht oeffnen laesst, ist schlimmer als keines: Er
 * ruft an, es gehen Tage verloren, und niemand weiss, ob der Fehler beim
 * Erstellen oder beim Entpacken lag.
 *
 * Deshalb wird hier nicht nur die Struktur geprueft, sondern mit dem
 * Programm `unzip` wirklich entpackt. Eigene Felder gegen eigene
 * Erwartungen zu pruefen heisst nur, dass der Schreiber mit sich selbst
 * einig ist.
 *
 * Alle Namen und Inhalte in dieser Datei sind erfunden.
 */

function entpacker(): string {
  // Absichtlich kein Ueberspringen, wenn unzip fehlt: Ein Test, der sich
  // selbst abschaltet, sieht gruen aus und prueft nichts.
  return execFileSync("sh", ["-c", "command -v unzip"]).toString().trim();
}

/**
 * Warum hier kein Name mit Umlaut gegen unzip geprueft wird.
 *
 * Erster Versuch am 05.11.2026: Das Archiv enthielt
 * "belege/0001_Gießen_Rechnung.pdf", und `unzip -Z1` sollte genau diesen
 * Namen zurueckgeben. Oertlich ging das. Auf dem Rechner der Werkbank kam
 * "Gie├Яen" zurueck. Zweiter Versuch mit ausdruecklich gesetztem
 * LC_ALL=C.UTF-8: Jetzt scheiterte es oertlich und lief unter LC_ALL=C.
 *
 * Info-ZIP wandelt gespeicherte Namen je nach Uebersetzung und
 * Spracheinstellung in den lokalen Zeichensatz um. Was es ausgibt, haengt
 * also am Entpacker, nicht am Archiv -- ein Test darauf prueft die
 * Umgebung und nennt das Ergebnis Archivfehler.
 *
 * Geprueft wird deshalb, was wir wirklich verantworten: dass der Name als
 * UTF-8 im Archiv steht und dass das Kennzeichen dafuer gesetzt ist. Die
 * Rundreise durch unzip bleibt, aber mit Namen aus reinem ASCII -- dort
 * kann nichts umgewandelt werden.
 */

describe("CRC32", () => {
  test("bekannter Wert für \"123456789\"", () => {
    // Der Standardwert aus der Literatur für diese Zeichenfolge.
    const c = crc32Fertig(crc32(Buffer.from("123456789")));
    assert.equal(c.toString(16), "cbf43926");
  });

  test("stückweise gerechnet ergibt dasselbe", () => {
    const ganz = crc32Fertig(crc32(Buffer.from("Belegstapel 2026")));
    let c = crc32(Buffer.from("Beleg"));
    c = crc32(Buffer.from("stapel "), c);
    c = crc32(Buffer.from("2026"), c);
    assert.equal(crc32Fertig(c), ganz);
  });
});

describe("Archiv schreiben", () => {
  test("die Signaturen stehen an den erwarteten Stellen", async () => {
    const z = await zipPuffer([{ name: "a.txt", inhalt: Buffer.from("A") }]);
    assert.equal(z.readUInt32LE(0), 0x04034b50, "Ortsdatensatz");
    assert.ok(z.includes(Buffer.from([0x50, 0x4b, 0x07, 0x08])), "nachgestellt");
    assert.ok(z.includes(Buffer.from([0x50, 0x4b, 0x01, 0x02])), "Verzeichnis");
    assert.equal(z.readUInt32LE(z.length - 22), 0x06054b50, "Abschluss");
  });

  test("das Verzeichnis zählt die Dateien", async () => {
    const z = await zipPuffer([
      { name: "a.txt", inhalt: Buffer.from("A") },
      { name: "b.txt", inhalt: Buffer.from("BB") },
      { name: "unter/c.txt", inhalt: Buffer.from("CCC") },
    ]);
    assert.equal(z.readUInt16LE(z.length - 22 + 10), 3);
  });

  test("Umlaute stehen als UTF-8 im Archiv und sind gekennzeichnet", async () => {
    const z = await zipPuffer([{ name: "Gießen/Beleg.pdf", inhalt: Buffer.from("X") }]);
    const merker = z.readUInt16LE(6);
    assert.equal(merker & 0x0800, 0x0800, "UTF-8-Merker gesetzt");
    assert.equal(merker & 0x0008, 0x0008, "nachgestellter Datensatz angekündigt");

    // Der Name steht zweimal im Archiv -- im Ortsdatensatz und im
    // zentralen Verzeichnis. Beide Male als UTF-8, und zwar Byte für Byte
    // so, wie Node den String kodiert. Das ist unabhängig davon, was ein
    // Entpackprogramm später daraus macht.
    const alsUtf8 = Buffer.from("Gießen/Beleg.pdf", "utf8");
    let gefunden = 0;
    let von = 0;
    for (;;) {
      const i = z.indexOf(alsUtf8, von);
      if (i === -1) break;
      gefunden += 1;
      von = i + 1;
    }
    assert.equal(gefunden, 2, "Name im Ortsdatensatz und im Verzeichnis");
    assert.equal(z.readUInt16LE(26), alsUtf8.length, "Namenslänge in Bytes, nicht in Zeichen");
  });
});

describe("Wirklich entpackbar", () => {
  test("unzip liest Namen und Inhalte zurück", async () => {
    entpacker();
    const ordner = mkdtempSync(join(tmpdir(), "zipprobe-"));
    const aufPlatte = join(ordner, "beleg.pdf");
    writeFileSync(aufPlatte, Buffer.from("%PDF-1.4 erfundener Beleg"));

    const z = await zipPuffer([
      { name: "LIESMICH.txt", inhalt: Buffer.from("Paket für den Steuerberater\n") },
      { name: "belege/0001_Rechnung.pdf", pfad: aufPlatte },
      { name: "journal.csv", inhalt: Buffer.from("nr;datum;betrag\n1;2026-01-02;45,44\n") },
    ]);
    const archiv = join(ordner, "paket.zip");
    writeFileSync(archiv, z);

    // -t prüft jede Pruefsumme im Archiv.
    const geprueft = execFileSync("unzip", ["-t", archiv]).toString();
    assert.match(geprueft, /No errors detected in compressed data/);

    const liste = execFileSync("unzip", ["-Z1", archiv]).toString().trim().split("\n");
    assert.deepEqual(liste.sort(), [
      "LIESMICH.txt",
      "belege/0001_Rechnung.pdf",
      "journal.csv",
    ].sort());

    const raus = join(ordner, "raus");
    execFileSync("unzip", ["-q", archiv, "-d", raus]);
    assert.equal(
      readFileSync(join(raus, "belege/0001_Rechnung.pdf")).toString(),
      "%PDF-1.4 erfundener Beleg",
    );
    assert.match(readFileSync(join(raus, "journal.csv")).toString(), /45,44/);
  });

  test("eine fehlende Datei wird gemeldet und nicht stillschweigend übergangen", async () => {
    const vermisst: string[] = [];
    const stuecke: Buffer[] = [];
    for await (const s of zipStrom(
      [
        { name: "da.txt", inhalt: Buffer.from("X") },
        { name: "weg.pdf", pfad: "/gibt/es/nicht/weg.pdf" },
      ],
      (q, grund) => vermisst.push(`${q.name}: ${grund}`),
    )) {
      stuecke.push(Buffer.from(s));
    }
    const z = Buffer.concat(stuecke);
    assert.equal(vermisst.length, 1);
    assert.match(vermisst[0], /^weg\.pdf: /);
    // Das Archiv bleibt gültig und enthält die eine vorhandene Datei.
    assert.equal(z.readUInt16LE(z.length - 22 + 10), 1);
  });

  test("ein Archiv mit 60 Dateien bleibt entpackbar", async () => {
    entpacker();
    const ordner = mkdtempSync(join(tmpdir(), "zipviele-"));
    const quellen = Array.from({ length: 60 }, (_, i) => ({
      name: `belege/${String(i + 1).padStart(4, "0")}_beleg.txt`,
      inhalt: Buffer.from(`Beleg Nummer ${i + 1}\n`.repeat(20)),
    }));
    const archiv = join(ordner, "viele.zip");
    writeFileSync(archiv, await zipPuffer(quellen));
    assert.match(
      execFileSync("unzip", ["-t", archiv]).toString(),
      /No errors detected in compressed data/,
    );
    assert.equal(
      execFileSync("unzip", ["-Z1", archiv]).toString().trim().split("\n").length,
      60,
    );
  });
});
