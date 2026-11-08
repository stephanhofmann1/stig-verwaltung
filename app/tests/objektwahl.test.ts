import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nurImporte } from "./quelltext";

import { ALLE, KEKS_ALTER, KEKS_OBJEKT, waehleObjekt } from "../lib/objektwahl";

/**
 * Die Objektwahl.
 *
 * ANLASS (08.11.2026)
 *
 * Stephan: "Zusätzlich fehlen mir noch klare Filtermöglichkeiten
 * zwischen den Objekten. Ich sehe nur ein Cockpit. ... Die Gesamtschau
 * interessiert in den wenigsten Fällen. Ich behandle die Objekte gerne
 * separat und interessiere mich auch für jedes Objekt einzeln für die
 * KPI, das Cockpit, Dashboard, Cashflow."
 *
 * Drei Haeuser in einem Mandanten -- Augartenstrasse 91, Welserstrasse
 * 10, Westanlage 9 -- und ein Cockpit, das sie zusammenrechnete.
 *
 * WAS HIER GEPRUEFT WIRD, UND WARUM GERADE DAS
 *
 * Die Wahl selbst ist eine Zeile Code. Geprueft wird der Fall, den man
 * beim Hinschreiben uebersieht: Das Cookie ueberlebt den
 * Mandantenwechsel. Wer in der eGbR auf "Westanlage 9" steht und in den
 * privaten Mandanten wechselt, traegt dort eine Kennung im Cookie, die
 * es nicht gibt. Ohne Pruefung filterte jede Abfrage auf ein fremdes
 * Objekt -- und das Cockpit zeigte lauter Nullen, ohne zu sagen, warum.
 * Eine stille Null ist in dieser Anwendung die gefaehrlichste Anzeige.
 */
describe("Welches Objekt gilt", () => {
  const westanlage = { id: "11111111-1111-1111-1111-111111111111", name: "Westanlage 9" };
  const welser = { id: "22222222-2222-2222-2222-222222222222", name: "Welserstraße 10" };
  const beide = [welser, westanlage];

  test("ohne Cookie gilt die Gesamtschau", () => {
    assert.equal(waehleObjekt(null, beide), null);
    assert.equal(waehleObjekt(undefined, beide), null);
    assert.equal(waehleObjekt("", beide), null);
  });

  test('"alle" ist eine Wahl und keine fehlende', () => {
    // Wer bewusst auf die Gesamtschau stellt, soll sie wiederfinden.
    assert.equal(waehleObjekt(ALLE, beide), null);
  });

  test('"alle" schlaegt die Liste, nicht umgekehrt', () => {
    /*
      Erst diese Pruefung macht die ausdrueckliche Abfrage auf ALLE
      noetig -- ohne sie faellt "alle" ohnehin durch die Suche und
      ergibt null, und die Zeile liesse sich streichen, ohne dass ein
      Test rot wird. Hier steht ein Objekt in der Liste, das selbst
      "alle" heisst: Dann entscheidet die Reihenfolge, und sie muss zur
      Gesamtschau fuehren. Die Kennungen sind UUIDs, der Fall ist also
      unwahrscheinlich -- aber "unwahrscheinlich" ist keine Zusage, und
      eine Zeile, die keine Pruefung haelt, verschwindet beim naechsten
      Aufraeumen.
    */
    assert.equal(waehleObjekt(ALLE, [{ id: ALLE, name: "Falle" }, ...beide]), null);
  });

  test("eine bekannte Kennung ergibt das Objekt", () => {
    assert.deepEqual(waehleObjekt(westanlage.id, beide), westanlage);
    assert.deepEqual(waehleObjekt(welser.id, beide), welser);
  });

  test("eine fremde Kennung faellt auf die Gesamtschau zurueck", () => {
    /*
      Der Fall nach einem Mandantenwechsel. Das Alternative waere, die
      Kennung durchzureichen und die Zeilensicherheit entscheiden zu
      lassen -- dann kaeme ueberall nichts zurueck, und das Cockpit
      stuende auf lauter Nullen, die wie ein Befund aussehen.
    */
    assert.equal(waehleObjekt("33333333-3333-3333-3333-333333333333", beide), null);
  });

  test("ohne Objekte gibt es nichts zu waehlen", () => {
    assert.equal(waehleObjekt(westanlage.id, []), null);
  });

  test("Unsinn im Cookie wirft nicht", () => {
    // Das Cookie kommt aus dem Browser. Was dort steht, ist kein
    // Versprechen -- auch wenn es niemand faelschen muss, um nichts zu
    // gewinnen.
    for (const unsinn of ["../../etc/passwd", "'; DROP TABLE objekt; --", "ALLE", "null"]) {
      assert.equal(waehleObjekt(unsinn, beide), null, unsinn);
    }
  });

  test("die Wahl haelt ein Jahr", () => {
    // Eine Sicht, die man taeglich neu waehlen muss, ist keine.
    assert.equal(KEKS_ALTER, 60 * 60 * 24 * 365);
    assert.equal(KEKS_OBJEKT, "objekt");
  });
});

/**
 * Das Objekt ist eine Sicht, kein Recht.
 *
 * Der Mandant steckt im unterschriebenen Sitzungscookie: Er ist eine
 * Rechtegrenze, und wer ihn faelschen koennte, saehe fremde Daten. Das
 * Objekt ist etwas anderes -- alle Objekte eines Mandanten darf derselbe
 * Benutzer ohnehin sehen, die Zeilensicherheit hat das schon
 * entschieden.
 *
 * Diese Pruefungen halten den Unterschied fest. Nicht weil ein
 * unterschriebenes Objektcookie unsicher waere, sondern weil es eine
 * Vorliebe wie ein Recht behandelte -- und spaetestens beim naechsten
 * Mandantenwechsel waere nicht mehr zu sagen, was eigentlich gilt.
 */
describe("Die Objektsicht fasst die Sitzung nicht an", () => {
  const quelle = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  const SICHT = quelle("../lib/objektsicht.ts");
  const ROUTE = quelle("../app/api/objekt/sicht/route.ts");
  const WAHL = quelle("../lib/objektwahl.ts");

  test("das Umstellen stellt keine Sitzung neu aus", () => {
    for (const verboten of ["baueSitzung", "sitzungFuerMandant", "COOKIE_NAME"]) {
      assert.ok(
        !ROUTE.includes(verboten),
        `Die Objektsicht benutzt "${verboten}" -- das gehoert zum Mandanten.`,
      );
    }
  });

  test("das Umstellen prueft trotzdem, dass es das Objekt gibt", () => {
    /*
      Nicht aus Sicherheit: Die Zeilensicherheit laesst nichts Fremdes
      durch. Sondern damit im Cookie nichts steht, was spaeter
      stillschweigend auf die Gesamtschau zurueckfaellt. Ein Umschalter,
      der etwas annimmt und dann etwas anderes zeigt, ist schlimmer als
      einer, der ablehnt.
    */
    assert.match(ROUTE, /objekteDesMandanten\(\)/);
    assert.match(ROUTE, /status: 404/);
  });

  test("das Cookie ist nicht aus dem Skript lesbar", () => {
    assert.match(ROUTE, /httpOnly: true/);
    assert.match(ROUTE, /sameSite: "lax"/);
  });

  test("ein Mieterzugang waehlt nichts", () => {
    // Er sieht genau eine Wohnung. Es gibt nichts umzustellen.
    assert.match(ROUTE, /rolle === "mieter"/);
  });

  test("die Abfrage der Objekte verlaesst sich auf die Zeilensicherheit", () => {
    // Ein zusaetzliches mandant_id = ... waere eine zweite, schwaechere
    // Zusage neben der, die wirklich traegt.
    const abfrage = SICHT.slice(SICHT.indexOf("objekteDesMandanten"));
    assert.doesNotMatch(abfrage.slice(0, 400), /WHERE mandant_id/);
  });

  test("der client-sichtbare Teil zieht keinen Server mit", () => {
    /*
      components/ObjektWahl.tsx ist eine Clientkomponente. Importierte
      sie aus lib/objektsicht.ts, zoege sie next/headers und den
      Datenbankpool in den Browserbau -- der Bau bricht daran ab, und
      zwar erst beim Bauen, nicht beim Tippen. Genau das ist am
      08.11.2026 passiert.
    */
    // Geprueft werden die Importzeilen, nicht der Fliesstext: Die
    // Begruendung dieser Regel nennt die verbotenen Namen selbst.
    // nurImporte steht in tests/quelltext.ts, zusammen mit der
    // Geschichte dieses dreimal gemachten Fehlers.
    for (const verboten of ["next/headers", "@/lib/db", '"pg"']) {
      assert.ok(
        !nurImporte(WAHL).includes(verboten),
        `lib/objektwahl.ts importiert ${verboten}`,
      );
    }
    assert.ok(
      !nurImporte(quelle("../components/ObjektWahl.tsx")).includes("@/lib/objektsicht"),
      "Die Clientkomponente importiert aus der Serverdatei.",
    );
  });
});

/**
 * Was sich nicht nach Objekt trennen laesst, sagt das Cockpit.
 *
 * Unter der Ueberschrift eines Hauses eine Zahl zu zeigen, die ein
 * anderes mitmeint, ist eine falsche Auskunft -- auch wenn die Zahl
 * stimmt.
 */
describe("Das Cockpit nennt seinen Ausschnitt", () => {
  const SEITE = readFileSync(new URL("../app/cockpit/page.tsx", import.meta.url), "utf8");

  test("der Name des Hauses steht in der Ueberschrift", () => {
    // Nicht nur im Umschalter oben: Wer ein Bildschirmfoto weitergibt,
    // muss darauf sehen koennen, wovon die Zahlen handeln.
    assert.match(SEITE, /Cockpit — \$\{gewaehlt\.name\}/);
  });

  test("die Ausnahmen stehen auf der Seite", () => {
    assert.match(SEITE, /Automatik/);
    assert.match(SEITE, /für alle Objekte zusammen/);
    assert.match(SEITE, /noch keinem Haus zugeordnet/);
    // Der Satz, der jedes Mal gilt, steht sichtbar und nicht im
    // Aufklappbaren: Wer die Teilzahlen addiert, muss vorher wissen,
    // dass sie sich nicht zum Ganzen addieren.
    const kopf = SEITE.slice(SEITE.indexOf("<summary>"), SEITE.indexOf("</summary>"));
    assert.match(kopf, /summieren sich nicht überall/);
  });

  test("die Zahlen kommen gefiltert aus einer Quelle", () => {
    // ladeCockpit() bekommt das Objekt; nirgends wird daneben noch
    // einmal gerechnet.
    assert.match(SEITE, /ladeCockpit\(new Date\(\), gewaehlt\?\.id \?\? null, monate\)/);
  });
});

/**
 * Eine Fassung jeder Abfrage, nicht zwei.
 *
 * Jede Abfrage traegt denselben Platzhalter:
 * ($1::uuid IS NULL OR ... = $1). Zwei Fassungen derselben Abfrage --
 * eine mit Filter, eine ohne -- laufen auseinander, und dann zeigt die
 * Gesamtschau etwas anderes als die Summe ihrer Teile.
 */
describe("Die Abfragen haben eine Fassung", () => {
  const KENNZAHLEN = readFileSync(new URL("../lib/kennzahlen.ts", import.meta.url), "utf8");

  test("jede Abfrage des Cockpits traegt den Objektfilter", () => {
    /*
      Gezaehlt wird genau, nicht "mindestens": Eine Abfrage, die den
      Filter verliert, zeigt unter der Ueberschrift eines Hauses die
      Zahlen aller. Mit einer Untergrenze faellt das nicht auf, solange
      die anderen noch filtern -- genau das hat die Mutationsprobe am
      08.11.2026 gezeigt.

      Faellt eine Abfrage weg oder kommt eine hinzu, ist diese Zahl zu
      berichtigen -- und beim Berichtigen nachzusehen, ob die neue
      Abfrage den Filter wirklich traegt.
    */
    const n = (KENNZAHLEN.match(/\$1::uuid IS NULL OR/g) ?? []).length;
    assert.equal(n, 10, `${n} statt 10 Stellen filtern nach Objekt`);
    for (const datei of ["../lib/rueckstaende.ts", "../lib/oeffentlich.ts"]) {
      const q = readFileSync(new URL(datei, import.meta.url), "utf8");
      assert.match(q, /\$1::uuid IS NULL OR/, datei);
    }
  });

  test("kein Filter ist stillgelegt", () => {
    // (true OR ...) sieht aus wie ein Filter und ist keiner.
    for (const datei of [
      "../lib/kennzahlen.ts",
      "../lib/rueckstaende.ts",
      "../lib/oeffentlich.ts",
    ]) {
      const q = readFileSync(new URL(datei, import.meta.url), "utf8");
      assert.doesNotMatch(q, /\(\s*true\s+OR/i, datei);
      assert.doesNotMatch(q, /\(\s*false\s+AND/i, datei);
    }
  });

  test("ladeCockpit nimmt das Objekt entgegen", () => {
    assert.match(
      KENNZAHLEN,
      /objekt: string \| null = null,\n  monate: number = 12,\n\): Promise<CockpitDaten>/,
    );
  });

  test("die Laeufe bleiben ungefiltert -- und das steht da", () => {
    // Einen "Bankabruf des Hauses Westanlage" gibt es nicht.
    assert.match(KENNZAHLEN, /behutsam\("Läufe", ladeLaeufe/);
    assert.match(KENNZAHLEN, /Die Laeufe gelten fuer den Mandanten/);
  });
});

/**
 * Welche Seiten dem Umschalter folgen -- und welche nicht.
 *
 * ENTSCHIEDEN AM 08.11.2026
 *
 * Stephan auf die Frage, wie der doppelte Objektfilter im Mietenbuch
 * aufzuloesen sei: "Umschalter steuert alles." Das Mietenbuch hat
 * seinen eigenen Objektfilter deshalb verloren.
 *
 * Nicht alle Seiten folgen. Belege und Zahlungen sind Arbeitsvorraete,
 * keine Lagebilder: Dort steht, was noch zuzuordnen ist. Ein Filter
 * wuerde dort Arbeit verstecken, und zwar unsichtbar -- die Liste saehe
 * vollstaendig aus. Dass sie nicht folgen, ist eine Entscheidung und
 * kein Vergessen; darum steht sie hier.
 */
describe("Die Seiten folgen dem Objekt", () => {
  const seite = (p: string) =>
    readFileSync(new URL(`../app/${p}/page.tsx`, import.meta.url), "utf8");

  for (const [pfad, ueberschrift] of [
    ["mahnwesen", "Rückstände"],
    ["konten", "Konten"],
    ["ablage", "Ablage"],
    ["mietenbuch", "Mietenbuch"],
    ["stammdaten", "Einheiten und Mietverhältnisse"],
    ["vorgaenge", "Vorgänge"],
  ] as const) {
    test(`/${pfad} liest die Objektwahl und nennt das Haus`, () => {
      const q = seite(pfad);
      assert.match(q, /objektSicht\(\)/, `/${pfad} liest die Wahl nicht`);
      assert.ok(
        q.includes(`${ueberschrift} — $`),
        `/${pfad} nennt das Haus nicht in der Ueberschrift`,
      );
      /*
        Und die Wahl muss auch etwas bewirken. Ohne diese Zeile blieb
        eine Mutationsprobe am 08.11.2026 gruen, die den Filter aus der
        Einheitenliste entfernt hat: Die Ueberschrift nannte das Haus,
        die Liste zeigte alle. Eine Ueberschrift, die mehr behauptet als
        die Daten darunter, ist schlimmer als keine.

        Zwei Seiten filtern nicht im eigenen SQL, und das ist richtig
        so: /mahnwesen geht ueber mahnstand(heute, objekt) -- die
        Abfrage steht in lib/rueckstaende.ts und wird dort geprueft.
        /mietenbuch laedt bewusst das ganze Buch und filtert danach im
        Speicher, weil die Angabe "X von Y Einheiten" das Y braucht.
      */
      if (pfad === "mahnwesen") {
        assert.match(q, /mahnstand\(heute, gewaehlt\?\.id \?\? null\)/);
      } else if (pfad === "mietenbuch") {
        assert.match(q, /objekt: gewaehltesHaus\?\.id \?\? null/);
        assert.match(q, /filterRaster\(alles, filter\)/);
      } else {
        assert.match(
          q,
          /\$\d::uuid IS NULL OR/,
          `/${pfad} nennt das Haus, filtert aber nicht danach`,
        );
      }
    });
  }

  test("die Arbeitsvorraete folgen bewusst nicht", () => {
    // Belege und Zahlungen zeigen, was noch zu tun ist. Ein Filter
    // waere dort kein Ausschnitt, sondern eine Luecke.
    for (const pfad of ["belege", "zahlungen"]) {
      assert.ok(
        !seite(pfad).includes("objektSicht()"),
        `/${pfad} filtert nach Objekt -- das versteckt offene Arbeit.`,
      );
    }
  });

  test("Vorgaenge ohne Objekt bleiben in jeder Sicht stehen", () => {
    /*
      Dieselbe Regel wie in der Ablage und im Cockpit: "ohne Objekt"
      heisst nicht "gehoert einem anderen Haus", sondern "noch keinem
      zugeordnet". Bei Vorgaengen ist das meist die frischeste Post --
      also die, die am ehesten Arbeit macht. Faellt sie beim Umschalten
      weg, ist die Liste genau dort blind, wo sie gebraucht wird.
    */
    assert.match(
      seite("vorgaenge"),
      /\$1::uuid IS NULL OR v\.objekt_id = \$1 OR v\.objekt_id IS NULL/,
    );
  });

  test("das Mietenbuch hat keinen zweiten Objektfilter mehr", () => {
    const filter = readFileSync(
      new URL("../components/MietenbuchFilter.tsx", import.meta.url),
      "utf8",
    );
    assert.ok(
      !filter.includes('<select name="objekt"'),
      "Zwei Stellen fuer dieselbe Entscheidung: Beim Lesen einer Zahl " +
        "waere nicht mehr zu sagen, welche gerade gilt.",
    );
    // Und die Seite nimmt das Haus wirklich aus dem Kopf.
    assert.match(seite("mietenbuch"), /objekt: gewaehltesHaus\?\.id \?\? null/);
  });

  test("ein altes ?objekt= in der Adresse wird nicht mehr beachtet", () => {
    // Sonst zeigte ein veralteter Verweis stillschweigend etwas
    // anderes, als der Umschalter daneben behauptet.
    assert.match(seite("mietenbuch"), /lesefilter\(params, \[\]\)/);
  });
});
