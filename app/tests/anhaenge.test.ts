import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  GRENZE_PAKET_BYTES,
  MAX_ANHAENGE,
  alsResendAnhaenge,
  alsSmtpAnhaenge,
  auslieferung,
  base64Groesse,
  endungFuerAblage,
  heikleTypen,
  mimeGroesse,
  pruefePaket,
} from "../lib/anhaenge";

const MB = 1024 * 1024;

/**
 * Die Größe eines Pakets.
 *
 * Der teure Fehler ist hier nicht ein abgewiesener Anhang -- den sieht
 * man. Der teure Fehler ist ein Paket, das angenommen und auf der
 * Leitung zu groß wird: Der Versand meldet Erfolg, der Entwurf steht auf
 * 'gesendet', und der empfangende Server weist die Mail ab. Die
 * Unzustellbarkeitsnachricht geht an das Absenderpostfach und nicht in
 * dieses Portal -- niemand erfährt, dass die Schadensmeldung nie ankam.
 */
describe("base64Groesse", () => {
  test("drei Bytes werden vier Zeichen", () => {
    assert.equal(base64Groesse(3), 4);
    assert.equal(base64Groesse(6), 8);
  });

  test("angebrochene Gruppen werden aufgefüllt", () => {
    assert.equal(base64Groesse(1), 4);
    assert.equal(base64Groesse(2), 4);
    assert.equal(base64Groesse(4), 8);
  });

  test("nichts bleibt nichts", () => {
    assert.equal(base64Groesse(0), 0);
    assert.equal(base64Groesse(-5), 0);
  });

  test("die Kodierung wächst um ein Drittel", () => {
    // 3 MB -> 4 MB. Wer diese Zeile bricht, hat die Rechnung geändert.
    assert.equal(base64Groesse(3 * MB), 4 * MB);
  });
});

describe("mimeGroesse", () => {
  /**
   * Die Zeilenumbrüche kommen in keiner Überschlagsrechnung vor und
   * fehlen genau dann, wenn ein Paket knapp unter der Grenze liegt.
   */
  test("die Zeilenumbrüche zählen mit", () => {
    // 76 Zeichen Base64 = 57 Bytes roh, plus ein CRLF.
    assert.equal(mimeGroesse(57), 76 + 2);
  });

  test("mehr als eine Zeile bekommt mehr als ein CRLF", () => {
    assert.equal(mimeGroesse(114), 152 + 4);
  });

  test("mimeGroesse ist nie kleiner als base64Groesse", () => {
    for (const n of [1, 57, 1000, 3 * MB, 17 * MB]) {
      assert.ok(mimeGroesse(n) >= base64Groesse(n), String(n));
    }
  });

  test("nichts bleibt nichts", () => {
    assert.equal(mimeGroesse(0), 0);
  });
});

describe("pruefePaket", () => {
  test("ein normales Paket geht durch", () => {
    const p = pruefePaket([2 * MB, 3 * MB, 1 * MB]);
    assert.equal(p.ok, true);
  });

  test("leer geht durch", () => {
    const p = pruefePaket([]);
    assert.equal(p.ok, true);
    assert.equal(p.kodiert, 0);
  });

  /**
   * DER entscheidende Fall.
   *
   * 18 MB auf der Platte sehen harmlos aus -- unter den 25 MB, die die
   * meisten Mailserver nennen. Kodiert sind es rund 24,6 MB, und damit
   * ist das Paket über unserer Grenze von 20 MB. Wer hier auf den rohen
   * Bytes prüft, lässt es durch.
   */
  test("gross auf der Platte, zu gross auf der Leitung", () => {
    const roh = 18 * MB;
    assert.ok(roh < 25 * MB, "roh liegt unter der üblichen Serverschranke");

    const p = pruefePaket([roh]);
    assert.equal(p.ok, false);
    assert.ok(
      p.kodiert > 24 * MB,
      `kodiert sollte über 24 MB liegen, war ${p.kodiert}`,
    );
    if (!p.ok) {
      assert.match(p.fehler, /Base64/, "die Meldung erklärt den Unterschied");
      assert.match(p.fehler, /auf der Platte/, "sie nennt auch die rohe Größe");
    }
  });

  test("die Grenze greift auf der Summe, nicht je Datei", () => {
    // Acht Dateien zu je 2 MB: einzeln unauffällig, zusammen zu viel.
    const p = pruefePaket(Array(8).fill(2 * MB));
    assert.equal(p.ok, false);
  });

  test("knapp darunter geht noch", () => {
    const p = pruefePaket([14 * MB]);
    assert.equal(p.ok, true);
    assert.ok(p.kodiert <= GRENZE_PAKET_BYTES);
  });

  test("zu viele Dateien, auch wenn sie klein sind", () => {
    const p = pruefePaket(Array(MAX_ANHAENGE + 1).fill(1024));
    assert.equal(p.ok, false);
    if (!p.ok) assert.match(p.fehler, /zu viele/);
  });

  test("genau die Höchstzahl geht noch", () => {
    const p = pruefePaket(Array(MAX_ANHAENGE).fill(1024));
    assert.equal(p.ok, true);
  });
});

/**
 * Wie eine Datei den Server verlässt.
 *
 * Hier geht es nicht um Bequemlichkeit, sondern um die Frage, wer
 * bestimmt, was der Browser mit einer Datei tut. Bei allem, was von
 * außen kam, ist der MIME-Typ die Behauptung eines Fremden.
 */
describe("auslieferung", () => {
  test("Eigenes darf der Browser anzeigen", () => {
    assert.deepEqual(auslieferung({ richtung: "ausgehend", mime_typ: "image/png" }), {
      contentType: "image/png",
      disposition: "inline",
    });
    assert.deepEqual(
      auslieferung({ richtung: "ausgehend", mime_typ: "application/pdf" }),
      { contentType: "application/pdf", disposition: "inline" },
    );
  });

  /**
   * Auch wenn der Absender 'image/png' behauptet: Was von außen kam,
   * geht als octet-stream heraus. Würde hier der behauptete Typ
   * übernommen, könnte ein Fremder eine Datei als 'text/html'
   * deklarieren und sie im Ursprung dieser Anwendung rendern lassen.
   */
  test("Fremdes wird nie im Browser geöffnet", () => {
    for (const mime of [
      "image/png",
      "application/pdf",
      "text/html",
      "image/svg+xml",
      null,
    ]) {
      const a = auslieferung({ richtung: "eingehend", mime_typ: mime });
      assert.equal(a.contentType, "application/octet-stream", String(mime));
      assert.equal(a.disposition, "attachment", String(mime));
    }
  });

  test("ein ausgehender Typ ausserhalb der Liste wird heruntergeladen", () => {
    const a = auslieferung({ richtung: "ausgehend", mime_typ: "text/html" });
    assert.equal(a.contentType, "application/octet-stream");
    assert.equal(a.disposition, "attachment");
  });

  test("ohne Typ wird heruntergeladen", () => {
    const a = auslieferung({ richtung: "ausgehend", mime_typ: null });
    assert.equal(a.disposition, "attachment");
  });
});

/**
 * Die Endung auf der Platte.
 *
 * Der Name kommt bei eingehender Post aus einem MIME-Header und ist
 * Text, kein Pfad -- er darf den Ablageort nicht formen.
 */
describe("endungFuerAblage", () => {
  test("der erkannte Typ hat Vorrang vor dem Namen", () => {
    assert.equal(endungFuerAblage({ endung: ".png" }, "rechnung.pdf"), ".png");
  });

  test("ohne erkannten Typ wird die Endung des Namens genommen", () => {
    assert.equal(endungFuerAblage(null, "Angebot.DOCX"), ".docx");
    assert.equal(endungFuerAblage(null, "termin.ics"), ".ics");
  });

  test("Pfadanteile im Namen formen den Ablageort nicht", () => {
    assert.equal(endungFuerAblage(null, "../../etc/passwd"), ".bin");
    assert.equal(endungFuerAblage(null, "rechnung.pdf/../../x"), ".bin");
    assert.equal(endungFuerAblage(null, "C:\\Temp\\bild.jpeg"), ".jpeg");
  });

  test("ohne brauchbare Endung heisst es .bin", () => {
    assert.equal(endungFuerAblage(null, "anhang"), ".bin");
    assert.equal(endungFuerAblage(null, ""), ".bin");
    assert.equal(endungFuerAblage(null, "datei."), ".bin");
    assert.equal(endungFuerAblage(null, "x.verylongextension"), ".bin");
  });

  test("das Ergebnis enthaelt nie etwas, das einen Pfad bilden koennte", () => {
    for (const name of [
      "a.p/df",
      "a.p\\df",
      "a..",
      "a. pdf",
      "a.pd f",
      "a.%2e%2e",
    ]) {
      const e = endungFuerAblage(null, name);
      assert.match(e, /^\.[a-z0-9]{0,8}$/, `${name} -> ${e}`);
      assert.ok(!e.includes("/") && !e.includes("\\"), name);
    }
  });
});

/**
 * Die beiden Versandwege.
 *
 * Der Fehler, gegen den das hier steht: Anhänge in den Resend-Zweig
 * einbauen und den SMTP-Zweig vergessen. Niemand merkt das, solange
 * Resend läuft. Fällt der Schlüssel weg und die Anwendung weicht auf
 * SMTP aus, gehen Mails ohne Anhänge hinaus -- und melden Erfolg.
 */
describe("die beiden Versandwege tragen dasselbe", () => {
  const nutzlast = [
    { dateiname: "schaden-1.jpg", inhalt: Buffer.from([0xff, 0xd8, 0xff, 0x01]) },
    { dateiname: "schaden-2.pdf", inhalt: Buffer.from("%PDF-1.7 test") },
  ];

  test("gleiche Anzahl", () => {
    assert.equal(
      alsResendAnhaenge(nutzlast).length,
      alsSmtpAnhaenge(nutzlast).length,
    );
    assert.equal(alsResendAnhaenge(nutzlast).length, 2);
  });

  test("gleiche Namen, in gleicher Reihenfolge", () => {
    assert.deepEqual(
      alsResendAnhaenge(nutzlast).map((a) => a.filename),
      alsSmtpAnhaenge(nutzlast).map((a) => a.filename),
    );
  });

  test("gleiche Bytes nach dem Dekodieren", () => {
    const r = alsResendAnhaenge(nutzlast);
    const s = alsSmtpAnhaenge(nutzlast);
    for (let i = 0; i < r.length; i++) {
      assert.deepEqual(
        Buffer.from(r[i].content, "base64"),
        s[i].content,
        nutzlast[i].dateiname,
      );
    }
  });

  test("leer bleibt leer, in beiden Wegen", () => {
    assert.deepEqual(alsResendAnhaenge([]), []);
    assert.deepEqual(alsSmtpAnhaenge([]), []);
  });
});

describe("heikleTypen", () => {
  test("HEIC wird gemeldet", () => {
    assert.deepEqual(heikleTypen(["image/jpeg", "image/heic", "image/heic"]), [
      "image/heic",
    ]);
  });

  test("ohne HEIC ist nichts zu melden", () => {
    assert.deepEqual(heikleTypen(["image/jpeg", "application/pdf", null]), []);
  });
});
