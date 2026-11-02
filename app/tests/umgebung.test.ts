import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Tests der Uebergabe von Umgebungswerten an die Container.
 *
 * Der Fehler, gegen den das schuetzt, ist am 01.11.2026 passiert und war
 * besonders unangenehm, weil er nicht als Fehler auftrat:
 *
 *   start.sh pflegte eine Liste der Werte, die Compose bekommen soll, von
 *   Hand. Nach dem Einbau von Lagebericht und Bankanbindung war sie vier
 *   Werte hinterher. LAGEBERICHT_AN kam damit leer im Container an -- und
 *   der Bericht wurde gebaut, ins Log geschrieben und NIE verschickt. Kein
 *   Absturz, keine Meldung, nur Schweigen.
 *
 * Der Umweg ueber eine leere .env ist noetig, weil der Passwort-Hash die
 * Form scrypt$salz$hash hat: Compose deutet jedes $ in der .env als
 * Variable und uebergibt den Hash zerstueckelt.
 */

const lies = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const compose = lies("../../compose.yaml");

/** Alle Werte, die compose.yaml aus der Umgebung erwartet. */
const erwartet = [
  ...new Set(
    [...compose.matchAll(/\$\{([A-Z_][A-Z0-9_]*)/g)].map((m) => m[1]),
  ),
].sort();

describe("Werte erreichen den Container", () => {
  for (const skript of ["start.sh", "migrieren.sh"]) {
    const s = lies("../../" + skript);

    test(`${skript} leitet die Liste aus der compose.yaml ab`, () => {
      // Keine Liste von Hand: Eine Liste, die man vergessen kann, wird
      // vergessen. Genau das ist passiert.
      assert.match(
        s,
        /WERTE=\$\(grep -oE '\\\$\\\{\[A-Z_\]\[A-Z0-9_\]\*' compose\.yaml/,
        "die Namen muessen aus der compose.yaml gelesen werden",
      );
      assert.match(s, /for V in \$WERTE; do/);
    });

    test(`${skript} pflegt keine eigene Werteliste mehr`, () => {
      // Gegenprobe: Stuende hier wieder eine Liste, waere der Fehler
      // zurueck. Geprueft an drei Werten, die spaeter dazugekommen sind.
      const schleife = s.slice(s.indexOf("for V in"), s.indexOf("done", s.indexOf("for V in")));
      for (const v of ["LAGEBERICHT_AN", "FINTS_SCHLUESSEL", "DOMAIN"])
        assert.doesNotMatch(
          schleife, new RegExp(v),
          `${v} steht wieder von Hand in der Schleife`,
        );
    });

    test(`${skript} legt die leere .env an, bevor Compose laeuft`, () => {
      // Fehlt die Datei, scheitert jeder Compose-Aufruf mit
      // "env file not found" -- einmal selbst gebaut beim Umstellen.
      assert.match(s, /^: > leer\.env$/m, "`: > leer.env` fehlt");
      assert.ok(
        s.indexOf(": > leer.env") < s.indexOf("--env-file leer.env"),
        "leer.env muss vor der ersten Verwendung angelegt werden",
      );
    });

    test(`${skript} laesst Compose die .env nicht selbst lesen`, () => {
      // Sonst kommt der Passwort-Hash zerstueckelt an und niemand kann
      // sich mehr anmelden.
      assert.match(s, /--env-file leer\.env/);
    });
  }

  test("die compose.yaml erwartet ueberhaupt Werte", () => {
    // Waere die Liste leer, wuerden die Tests oben nichts beweisen.
    assert.ok(erwartet.length > 15, `nur ${erwartet.length} gefunden`);
    for (const v of ["LAGEBERICHT_AN", "FINTS_SCHLUESSEL", "FINTS_PRODUKT_ID"])
      assert.ok(erwartet.includes(v), `${v} fehlt in der compose.yaml`);
  });

  test("was die Anwendung liest, steht auch in der compose.yaml", () => {
    // Die andere Richtung: Ein process.env-Zugriff auf einen Wert, den
    // compose.yaml nicht durchreicht, ist im Container immer leer.
    const dateien = [
      "../lib/fints/geheimnis.ts",
      "../lib/fints/holen.ts",
      "../app/api/aufgaben/lagebericht/route.ts",
    ];
    const gelesen = new Set<string>();
    for (const d of dateien)
      for (const m of lies(d).matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)/g))
        gelesen.add(m[1]);

    // NODE_ENV kommt von Next.js selbst, nicht aus der compose.yaml.
    gelesen.delete("NODE_ENV");
    // BERICHT_AN ist die Ausweichbezeichnung, absichtlich nicht gefuehrt.
    gelesen.delete("BERICHT_AN");

    for (const v of gelesen)
      assert.ok(
        erwartet.includes(v),
        `${v} wird gelesen, aber von der compose.yaml nicht durchgereicht`,
      );
  });
});

describe("mailabruf: nicht eingerichtet ist kein Fehlschlag", () => {
  const quelle = readFileSync(
    new URL("../app/api/aufgaben/mailabruf/route.ts", import.meta.url),
    "utf8",
  );

  test("der Lauf fragt ausdrücklich, ob IMAP eingerichtet ist", () => {
    // Nicht am Wortlaut einer Fehlermeldung erkennen -- das wird beim
    // ersten Umformulieren still falsch.
    assert.ok(
      quelle.includes("imapEingerichtet()"),
      "ohne diese Abfrage scheitert der Lauf zweimal täglich an einer " +
        "fehlenden Einstellung und steht als 'gescheitert' im Lagebericht",
    );
  });

  test("ohne Zugang wird ruefeAb gar nicht erst gerufen", () => {
    const frage = quelle.indexOf("if (!imapEingerichtet())");
    const abruf = quelle.indexOf("await ruefeAb()");
    assert.ok(frage > 0 && abruf > 0 && frage < abruf,
      "die Abfrage muss VOR dem Abruf stehen");
  });

  test("der Hinweis sagt, dass der Regelweg woanders läuft", () => {
    // Sonst liest es sich wie ein Mangel, obwohl es eine Festlegung ist.
    assert.ok(quelle.includes("Cloudflare-Worker"));
    assert.ok(
      quelle.includes("Fällt der still aus"),
      "und er muss nennen, was diese zweite Leitung absichert",
    );
  });
});
