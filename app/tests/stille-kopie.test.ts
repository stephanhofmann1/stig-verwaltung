import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Tests der stillen Kopie jeder ausgehenden Mail.
 *
 * ANLASS, 07.11.2026
 *
 * Eine Antwort an einen Handwerker ging hinaus, und der Absender konnte
 * nicht feststellen, ob sie wirklich draussen war: Das Portal sagte
 * "gesendet", sein Postfach zeigte nichts, und nachsehen liess sich das
 * nur im Protokoll des Versanddienstleisters. Eine Zustellung, die man
 * nur in einem Fremdsystem nachvollziehen kann, ist fuer den Absender
 * keine.
 *
 * Alle Adressen hier sind erfunden.
 */
const quelle = readFileSync(
  new URL("../lib/versand.ts", import.meta.url),
  "utf8",
);
/** Derselbe Text ohne Zeilenumbrueche und Kommentarsterne -- die
 *  Begruendungen stehen im Fliesstext und brechen mitten im Satz um. */
const fliess = quelle.replace(/\n\s*\*?\s*/g, " ");

/**
 * stilleKopie() liest die Adresse beim Laden des Moduls aus der
 * Umgebung. Fuer die Tests wird das Modul deshalb je Fall frisch
 * geladen -- mit einem Zaehler im Pfad, damit der Modulcache nicht
 * den vorherigen Stand zurueckgibt.
 */
let lauf = 0;
async function mitKopie(wert: string | undefined, bericht?: string) {
  const vorher = process.env.VERSAND_KOPIE;
  const vorherAbsender = process.env.ABSENDER_EMAIL;
  const vorherBericht = process.env.LAGEBERICHT_AN;
  if (wert === undefined) delete process.env.VERSAND_KOPIE;
  else process.env.VERSAND_KOPIE = wert;
  if (bericht === undefined) delete process.env.LAGEBERICHT_AN;
  else process.env.LAGEBERICHT_AN = bericht;
  process.env.ABSENDER_EMAIL = "verwaltung@example.org";
  lauf += 1;
  const m = (await import(`../lib/versand.ts?kopie=${lauf}`)) as {
    stilleKopie: (an?: string[], cc?: string[]) => string[];
  };
  if (vorher === undefined) delete process.env.VERSAND_KOPIE;
  else process.env.VERSAND_KOPIE = vorher;
  if (vorherAbsender === undefined) delete process.env.ABSENDER_EMAIL;
  else process.env.ABSENDER_EMAIL = vorherAbsender;
  if (vorherBericht === undefined) delete process.env.LAGEBERICHT_AN;
  else process.env.LAGEBERICHT_AN = vorherBericht;
  return m.stilleKopie;
}

describe("Wann eine Kopie mitgeht", () => {
  test("mit hinterlegter Adresse geht eine Kopie mit", async () => {
    const k = await mitKopie("eigner@example.net");
    assert.deepEqual(k(["handwerker@example.com"], []), ["eigner@example.net"]);
  });

  test("ohne hinterlegte Adresse geht keine mit", async () => {
    const k = await mitKopie(undefined);
    assert.deepEqual(k(["handwerker@example.com"], []), []);
  });

  test("eine leere oder unsinnige Angabe ergibt keine Kopie", async () => {
    for (const wert of ["", "   ", "keine-adresse"]) {
      const k = await mitKopie(wert);
      assert.deepEqual(
        k(["handwerker@example.com"], []),
        [],
        `"${wert}" durchgelassen`,
      );
    }
  });

  test("die eigene Absenderadresse wird abgewiesen", async () => {
    // Eine Mail an sich selbst ist keine Bestaetigung.
    const k = await mitKopie("verwaltung@example.org");
    assert.deepEqual(k(["handwerker@example.com"], []), []);
  });

  test("steht die Adresse schon offen in An, gibt es keine zweite", async () => {
    const k = await mitKopie("eigner@example.net");
    assert.deepEqual(k(["eigner@example.net"], []), []);
  });

  test("steht sie schon in CC, gibt es keine zweite", async () => {
    const k = await mitKopie("eigner@example.net");
    assert.deepEqual(k(["handwerker@example.com"], ["eigner@example.net"]), []);
  });

  test("Groß- und Kleinschreibung entscheidet nicht", async () => {
    const k = await mitKopie("Eigner@Example.NET");
    assert.deepEqual(k(["EIGNER@example.net"], []), []);
  });
});

describe("Die Rückfallebene", () => {
  test("ohne eigene Angabe nimmt sie die Adresse des Lageberichts", async () => {
    // Sonst braeuchte die Kopie eine Einstellung, die jemand erst auf
    // dem Server eintraegt -- und bis dahin waere die Zustellung weiter
    // nicht nachvollziehbar, also genau das Problem, um das es geht.
    const k = await mitKopie(undefined, "bericht@example.net");
    assert.deepEqual(k(["handwerker@example.com"], []), ["bericht@example.net"]);
  });

  test("eine eigene Angabe hat Vorrang", async () => {
    const k = await mitKopie("eigner@example.net", "bericht@example.net");
    assert.deepEqual(k(["handwerker@example.com"], []), ["eigner@example.net"]);
  });

  test('"aus" schaltet die Kopie ab, auch wenn ein Lagebericht läuft', async () => {
    // Ohne diesen Weg liesse sich die Kopie nicht abstellen, solange
    // der Lagebericht eine Adresse hat.
    for (const wort of ["aus", "AUS", " Aus "]) {
      const k = await mitKopie(wort, "bericht@example.net");
      assert.deepEqual(
        k(["handwerker@example.com"], []),
        [],
        `"${wort}" schaltet nicht ab`,
      );
    }
  });

  test("ohne beides gibt es keine Kopie", async () => {
    const k = await mitKopie(undefined, undefined);
    assert.deepEqual(k(["handwerker@example.com"], []), []);
  });
});

describe("Beide Versandwege tragen sie", () => {
  test("der Resend-Zweig setzt bcc", () => {
    const zweig = quelle.slice(
      quelle.indexOf('if (weg === "resend")'),
      quelle.indexOf("if (!res.ok)"),
    );
    assert.match(zweig, /bcc: stilleKopie\(n\.an_emails, n\.cc_emails\)/);
  });

  test("der SMTP-Zweig setzt bcc", () => {
    // Truege sie nur ein Weg, haenge die Nachvollziehbarkeit daran,
    // welcher Weg gerade konfiguriert ist.
    const zweig = quelle.slice(
      quelle.indexOf('if (weg === "smtp")'),
      quelle.indexOf('if (weg === "resend")'),
    );
    assert.match(zweig, /bcc: bcc\.length \? bcc : undefined/);
    assert.match(zweig, /const bcc = stilleKopie\(n\.an_emails, n\.cc_emails\)/);
  });

  test("beide fragen dieselbe Funktion", () => {
    // Zwei getrennte Berechnungen wuerden irgendwann auseinanderlaufen.
    assert.equal(
      [...quelle.matchAll(/stilleKopie\(n\.an_emails, n\.cc_emails\)/g)].length >= 3,
      true,
    );
  });
});

describe("Es bleibt nachvollziehbar", () => {
  test("die Kopie steht im Protokoll", () => {
    // Eine verdeckte Zustellung, von der auch im Protokoll nichts
    // steht, waere eine verdeckte Zustellung im schlechten Sinn.
    // Nur der Protokoll-Einschub, nicht die Rueckgabe: Dort steht
    // dieselbe Zeile, und ein Treffer dort wuerde das Fehlen hier
    // verdecken.
    const eintrag = quelle.slice(
      quelle.indexOf("'freigegeben_und_gesendet'"),
      quelle.indexOf("return {\n    ok: true,"),
    );
    assert.match(eintrag, /stille_kopie: stilleKopie\(n\.an_emails, n\.cc_emails\)/);
  });

  test("das Ergebnis nennt die Adresse", () => {
    // Sonst weiss der Mensch am Knopf weiterhin nicht, wo er nachsehen
    // kann.
    assert.match(quelle, /stille_kopie\?: string\[\]/);
  });
});

describe("Warum BCC und nicht CC", () => {
  test("die Begründung steht im Quelltext", () => {
    // CC zeigt dem Empfaenger die Kopie und traegt die private Adresse
    // in jedes Postfach und jeden Weiterleitungsverlauf.
    assert.match(quelle, /WARUM BCC UND NICHT CC/);
    assert.match(fliess, /BCC genügt dafür und verrät nichts/);
  });

  test("die Gefahr der Rückschleife ist benannt", () => {
    // Eine Kopie an die Eingangsadresse holte jede ausgehende Mail als
    // neue eingehende wieder herein.
    assert.match(quelle, /WARUM NICHT DIE EINGANGSADRESSE/);
    assert.match(fliess, /als neue eingehende wieder hereinholen/);
  });

  test("die Kopie landet nicht im CC-Feld", () => {
    const resend = quelle.slice(
      quelle.indexOf('if (weg === "resend")'),
      quelle.indexOf("if (!res.ok)"),
    );
    assert.match(resend, /cc: n\.cc_emails\.length \? n\.cc_emails : undefined/);
  });
});
