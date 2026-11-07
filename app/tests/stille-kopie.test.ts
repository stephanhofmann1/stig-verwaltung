import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { stilleKopie, waehleKopie } from "../lib/versand";

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
/** Derselbe Text ohne Umbrueche und Kommentarsterne -- die Begruendungen
 *  stehen im Fliesstext und brechen mitten im Satz um. */
const fliess = quelle.replace(/\n\s*\*?\s*/g, " ");

const ABSENDER = "verwaltung@stig-immobilien.de";

describe("Wann eine Kopie mitgeht", () => {
  test("mit hinterlegter Adresse geht eine Kopie mit", () => {
    assert.deepEqual(
      stilleKopie("eigner@example.net", ["handwerker@example.com"], []),
      ["eigner@example.net"],
    );
  });

  test("ohne hinterlegte Adresse geht keine mit", () => {
    assert.deepEqual(stilleKopie("", ["handwerker@example.com"], []), []);
  });

  test("eine leere oder unsinnige Angabe ergibt keine Kopie", () => {
    // Ein Tippfehler ohne @ waere eine Kopie, die lautlos nirgends
    // ankommt -- und genau darum geht es hier nicht.
    for (const wert of ["", "   ", "keine-adresse", "aus"]) {
      assert.deepEqual(
        stilleKopie(wert, ["handwerker@example.com"], []),
        [],
        `"${wert}" durchgelassen`,
      );
    }
  });

  test("steht die Adresse schon offen in An, gibt es keine zweite", () => {
    assert.deepEqual(
      stilleKopie("eigner@example.net", ["eigner@example.net"], []),
      [],
    );
  });

  test("steht sie schon in CC, gibt es keine zweite", () => {
    assert.deepEqual(
      stilleKopie(
        "eigner@example.net",
        ["handwerker@example.com"],
        ["eigner@example.net"],
      ),
      [],
    );
  });

  test("Groß- und Kleinschreibung entscheidet nicht", () => {
    assert.deepEqual(
      stilleKopie("Eigner@Example.NET", ["EIGNER@example.net"], []),
      [],
    );
  });

  test("die Absenderadresse der Verwaltung bekommt keine zweite Zustellung", () => {
    // Eine Mail an sich selbst ist keine Bestaetigung.
    assert.deepEqual(stilleKopie(ABSENDER, [ABSENDER], []), []);
  });
});

describe("Woher die Adresse kommt", () => {
  test("die Angabe am Mandanten hat Vorrang vor der Umgebung", () => {
    // Eine Adresse in der Umgebung gilt fuer die ganze Installation --
    // sobald ein zweiter Mandant Mails verschickt, bekaeme der erste
    // eine verdeckte Kopie davon.
    assert.equal(
      waehleKopie("eigner@example.net", "umgebung@example.org"),
      "eigner@example.net",
    );
  });

  test("NULL am Mandanten heißt: Umgebung", () => {
    // "Nicht entschieden" -- damit die bestehende Installation
    // weiterlaeuft, ohne dass jemand erst etwas eintraegt.
    assert.equal(
      waehleKopie(null, "umgebung@example.org"),
      "umgebung@example.org",
    );
    assert.equal(
      waehleKopie(undefined, "umgebung@example.org"),
      "umgebung@example.org",
    );
  });

  test("ein leerer Eintrag am Mandanten überstimmt die Umgebung", () => {
    // "Ausdruecklich keine Kopie". Ohne diesen Unterschied liesse sich
    // die Kopie fuer einen Mandanten nicht abschalten, solange
    // irgendwo eine Umgebung gesetzt ist.
    assert.equal(waehleKopie("", "umgebung@example.org"), "");
    assert.equal(waehleKopie("   ", "umgebung@example.org"), "");
  });

  test("ohne beides gibt es keine Kopie", () => {
    assert.equal(waehleKopie(null, ""), "");
  });

  test("die Umgebung nimmt VERSAND_KOPIE vor LAGEBERICHT_AN", () => {
    const ab = quelle.slice(quelle.indexOf("const KOPIE_UMGEBUNG"));
    const i = ab.indexOf("VERSAND_KOPIE");
    const j = ab.indexOf("LAGEBERICHT_AN");
    assert.ok(i >= 0 && j > i, "LAGEBERICHT_AN steht vorn");
  });
});

describe("Die Adresse steht am Mandanten", () => {
  const migration = readFileSync(
    new URL("../../db/037_versand_kopie.sql", import.meta.url),
    "utf8",
  );

  test("die Spalte liegt am Mandanten, nicht global", () => {
    assert.match(
      migration,
      /ALTER TABLE mandant ADD COLUMN IF NOT EXISTS versand_kopie text/,
    );
  });

  test("sie nimmt nur eine Adresse oder gar nichts", () => {
    assert.match(migration, /mandant_versand_kopie_form/);
    assert.match(migration, /versand_kopie IS NULL/);
    assert.match(migration, /versand_kopie = ''/);
  });

  test("der Grund steht in der Migration", () => {
    // Eine BCC-Zustellung meldet sich nicht: Der zweite Kunde wuerde
    // nie erfahren, dass seine Korrespondenz mitgelesen wird.
    assert.match(migration, /bekaeme der erste eine verdeckte Kopie/);
  });

  test("der Versand liest sie ohne WHERE, weil die RLS das erledigt", () => {
    assert.match(quelle, /SELECT versand_kopie FROM mandant`/);
    assert.match(fliess, /kann auch keinen fremden Mandanten treffen/);
    // Und der gelesene Wert wird auch benutzt. Ohne diese Zeile waere
    // die Abfrage Zierde: waehleKopie(null) nimmt immer die Umgebung.
    assert.match(quelle, /waehleKopie\(eigner\?\.versand_kopie\)/);
  });
});

describe("Beide Versandwege tragen sie", () => {
  test("der Resend-Zweig setzt bcc", () => {
    const zweig = quelle.slice(
      quelle.indexOf('if (weg === "resend")'),
      quelle.indexOf("if (!res.ok)"),
    );
    assert.match(zweig, /bcc: stilleKopie\(kopie, n\.an_emails, n\.cc_emails\)/);
  });

  test("der SMTP-Zweig setzt bcc", () => {
    // Truege sie nur ein Weg, haenge die Nachvollziehbarkeit daran,
    // welcher Weg gerade konfiguriert ist.
    const zweig = quelle.slice(
      quelle.indexOf('if (weg === "smtp")'),
      quelle.indexOf('if (weg === "resend")'),
    );
    assert.match(zweig, /bcc: bcc\.length \? bcc : undefined/);
    assert.match(
      zweig,
      /const bcc = stilleKopie\(kopie, n\.an_emails, n\.cc_emails\)/,
    );
  });

  test("beide fragen dieselbe Funktion", () => {
    // Zwei getrennte Berechnungen wuerden irgendwann auseinanderlaufen.
    assert.ok(
      [...quelle.matchAll(/stilleKopie\(kopie, n\.an_emails, n\.cc_emails\)/g)]
        .length >= 3,
    );
  });

  test("die Kopie landet nicht im CC-Feld", () => {
    const resend = quelle.slice(
      quelle.indexOf('if (weg === "resend")'),
      quelle.indexOf("if (!res.ok)"),
    );
    assert.match(resend, /cc: n\.cc_emails\.length \? n\.cc_emails : undefined/);
  });
});

describe("Es bleibt nachvollziehbar", () => {
  test("die Kopie steht im Protokoll", () => {
    // Eine verdeckte Zustellung, von der auch im Protokoll nichts
    // steht, waere eine verdeckte Zustellung im schlechten Sinn.
    const eintrag = quelle.slice(
      quelle.indexOf("'freigegeben_und_gesendet'"),
      quelle.indexOf("return {\n    ok: true,"),
    );
    assert.match(
      eintrag,
      /stille_kopie: stilleKopie\(kopie, n\.an_emails, n\.cc_emails\)/,
    );
  });

  test("das Ergebnis nennt die Adresse", () => {
    // Sonst weiss der Mensch am Knopf weiterhin nicht, wo er nachsehen
    // kann.
    assert.match(quelle, /stille_kopie\?: string\[\]/);
  });
});

describe("Warum BCC und nicht CC", () => {
  test("die Begründung steht im Quelltext", () => {
    assert.match(quelle, /WARUM BCC UND NICHT CC/);
    assert.match(fliess, /BCC genügt dafür und verrät nichts/);
  });

  test("die Gefahr der Rückschleife ist benannt", () => {
    assert.match(quelle, /WARUM NICHT DIE EINGANGSADRESSE/);
    assert.match(fliess, /als neue eingehende wieder hereinholen/);
  });
});

describe("Die Adresse lässt sich auch setzen", () => {
  const route = readFileSync(
    new URL("../app/api/mandant/kopie/route.ts", import.meta.url),
    "utf8",
  );
  const stueck = readFileSync(
    new URL("../components/VersandKopie.tsx", import.meta.url),
    "utf8",
  );
  const seite = readFileSync(
    new URL("../app/weisungen/page.tsx", import.meta.url),
    "utf8",
  );

  test("es gibt überhaupt einen Schreibweg", () => {
    // db/037 legte die Spalte an und lib/versand.ts liest sie -- aber
    // niemand konnte sie beschreiben. Eine Spalte ohne Schreibweg ist
    // halbe Arbeit: Die Adresse blieb NULL und damit bei der
    // installationsweiten Einstellung, von der sie wegfuehren sollte.
    assert.match(route, /UPDATE mandant SET versand_kopie = \$1/);
    assert.match(seite, /<VersandKopie/);
  });

  test("nur die Verwaltung darf sie setzen", () => {
    // Wer die Adresse setzen darf, darf mitlesen. Das ist keine
    // Buchhaltungsaufgabe.
    assert.match(route, /sitzung\.rolle !== "verwalter"/);
    assert.match(route, /status: 403/);
  });

  test("eine Adresse mit Tippfehler wird abgewiesen", () => {
    // Eine Kopie an eine Adresse mit Tippfehler kommt lautlos nirgends
    // an -- und genau darum geht es hier nicht.
    assert.match(route, /\^\[\^@\\s\]\+@\[\^@\\s\]\+\\\.\[\^@\\s\]\+\$/);
    assert.match(route, /status: 400/);
  });

  test("leer ist erlaubt und heißt: keine Kopie", () => {
    assert.match(route, /if \(roh !== "" &&/);
    assert.match(stueck, /leer lassen schaltet die Kopie ab/);
  });

  test("das UPDATE braucht kein WHERE, weil die RLS die Grenze hält", () => {
    assert.match(route, /keinen fremden Mandanten treffen/);
    assert.ok(
      !/UPDATE mandant SET versand_kopie = \$1 WHERE/.test(route),
      "das UPDATE trägt ein WHERE und umgeht damit die Begründung",
    );
  });

  test("der Unterschied zwischen leer und nicht gesetzt ist sichtbar", () => {
    // "Nicht gesetzt" heisst: Es greift die Einstellung der
    // Installation. "Leer" heisst: ausdruecklich keine Kopie.
    assert.match(stueck, /nichts — es gilt die Einstellung der Installation/);
    assert.match(stueck, /ausdrücklich keine Kopie/);
    assert.match(stueck, /const \[gesetzt, setGesetzt\] = useState\(anfang !== null\)/);
  });

  test("der Warnhinweis zur Eingangsadresse steht dabei", () => {
    assert.match(stueck, /sonst käme jede ausgehende Mail als neue eingehende/);
  });

  test("lesende Zugänge sehen den Stand, bekommen aber kein Formular", () => {
    // Ein Formular, dessen Knopf immer 403 bekommt, ist schlechter als
    // keines.
    assert.match(stueck, /!darfSchreiben \?/);
    assert.match(stueck, /Geändert wird das von der Verwaltung/);
  });
});
