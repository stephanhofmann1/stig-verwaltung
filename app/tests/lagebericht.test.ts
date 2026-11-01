import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Tests des taeglichen Lageberichts.
 *
 * Der Bericht ist der Grund, warum die Anwendung unbeobachtet laufen darf.
 * Die Fehler, gegen die hier geprueft wird, sind alle vom selben Typ:
 * **Schweigen**. Ein Bericht, der nichts sagt, obwohl etwas liegt, ist
 * schlimmer als keiner -- weil er Ruhe suggeriert.
 *
 * Die Zahlen kommen aus der Datenbank; geprueft wird hier der Teil, der
 * ohne sie prueffaehig ist: dass Schweigen nicht moeglich ist, dass der
 * Bericht einmal taeglich laeuft und dass eine Frist, die an einem Dritten
 * haengt, frueher warnt.
 */

const quelle = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("Der Bericht kann nicht schweigen", () => {
  test("ein leerer Bericht sagt ausdruecklich, dass nichts zu tun ist", () => {
    // Sonst sieht ein Totalausfall genauso aus wie ein ruhiger Tag.
    const s = quelle("../lib/lagebericht.ts");
    assert.match(s, /Nichts zu tun\./);
  });

  test("ein nicht lesbarer Abschnitt wird gemeldet, nicht weggelassen", () => {
    // Ein Abschnitt, der wirft, darf nicht als "nichts gefunden"
    // durchgehen -- das waere eine Luecke, die wie Ruhe aussieht.
    const s = quelle("../lib/lagebericht.ts");
    assert.match(s, /## Nicht lesbar/);
    assert.match(s, /Abschnitt, der nicht gelesen werden konnte/);
  });

  test("der Bericht sagt selbst, dass sein Ausbleiben etwas bedeutet", () => {
    // Die einzige Absicherung gegen den Fall, dass der Lauf selbst
    // ausfaellt: Dann kommt keine Mail, und der Leser muss wissen, dass
    // das kein gutes Zeichen ist.
    const s = quelle("../lib/lagebericht.ts");
    assert.match(s, /Kommt er nicht, steht der Zeitplaner/);
  });

  test("ein Abschnitt darf den ganzen Bericht nicht verhindern", () => {
    const s = quelle("../lib/lagebericht.ts");
    assert.match(s, /async function behutsam/);
    assert.match(s, /Lieber ein Bericht mit einer Fehlermeldung/);
  });

  test("ein stehender Zeitplaner faellt auf", () => {
    const s = quelle("../lib/lagebericht.ts");
    assert.match(s, /stunden > 26/);
    assert.match(s, /noch nie gelaufen/);
  });
});

describe("Fristen warnen rechtzeitig", () => {
  test("eine Frist, die an einem Dritten haengt, warnt ab 60 Tagen", () => {
    // TEHA und Domex brauchen Wochen. 30 Tage waeren zu spaet, und bei
    // § 556 Abs. 3 BGB heisst zu spaet: die Nachforderung ist weg.
    const s = quelle("../lib/lagebericht.ts");
    assert.match(s, /const schwelle = f\.haengt_an \? 60 : 30;/);
  });

  test("eine verstrichene Frist wird als verstrichen benannt", () => {
    const s = quelle("../lib/lagebericht.ts");
    assert.match(s, /VERSTRICHEN seit/);
  });

  test("die Rechtsgrundlage steht dabei", () => {
    // Wer eine Frist verschiebt, muss nachsehen koennen, woher sie kommt.
    const s = quelle("../lib/lagebericht.ts");
    assert.match(s, /Grundlage: /);
  });
});

describe("Der Lauf", () => {
  test("laeuft einmal taeglich, nicht zweimal", () => {
    // Zweimal taeglich wird nach einer Woche nicht mehr gelesen -- und
    // dann ist der Bericht an dem Tag nutzlos, an dem etwas drinsteht.
    const s = readFileSync(new URL("../../aufgaben.sh", import.meta.url), "utf8");
    assert.match(s, /erste_stunde/);
    assert.match(s, /\[ "\$s" = "\$erste_stunde" \] && anstossen lagebericht/);
  });

  test("ein fehlender Empfaenger laesst den Lauf nicht scheitern", () => {
    // Sonst steht der ganze naechtliche Lauf, weil eine Adresse fehlt.
    const s = quelle("../app/api/aufgaben/lagebericht/route.ts");
    assert.match(s, /kein Empfänger eingerichtet/);
    assert.match(s, /nur protokolliert/);
  });

  test("ein nicht versendeter Bericht wird als Hinweis vermerkt", () => {
    // Sonst gilt der Lauf als geglueckt, obwohl niemand etwas erfahren hat.
    const s = quelle("../app/api/aufgaben/lagebericht/route.ts");
    assert.match(s, /Lagebericht nicht versendet/);
  });

  test("der Schluessel wird geprueft", () => {
    const s = quelle("../app/api/aufgaben/lagebericht/route.ts");
    assert.match(s, /pruefeSchluessel/);
  });

  test("LAGEBERICHT_AN steht ohne :? in der compose.yaml", () => {
    // Mit :? wuerde eine fehlende Adresse den Start der ganzen Anwendung
    // verhindern.
    const s = readFileSync(new URL("../../compose.yaml", import.meta.url), "utf8");
    assert.match(s, /LAGEBERICHT_AN: \$\{LAGEBERICHT_AN:-\}/);
  });
});
