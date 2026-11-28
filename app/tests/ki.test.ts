import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { darf } from "../proxy";
import { frageModell, OHNE_SCHLUESSEL, type Holer } from "../lib/ki";
import {
  beantworte,
  verlaufFuerModell,
  WERKZEUGE,
  type Gespraechsschritt,
} from "../lib/assistent";
import {
  normalisiere,
  rolleFuer,
  schlageVor,
  suchkern,
  WERKZEUG_AUSFUELLEN,
  type Auswahl,
} from "../lib/vorgangsvorschlag";
import { gliedere } from "../lib/kitext";

/**
 * Tests fuer die KI in der Oberflaeche: den Assistenten und das Fenster
 * "Neuer Vorgang" (27.11.2026).
 *
 * Keiner dieser Tests ruft die echte Schnittstelle: Die Antworten des
 * Modells kommen aus einer Attrappe (`holen`), die Werkzeuge aus einer
 * eingespritzten Funktion. Geprueft wird, was in unserer Hand liegt --
 * dass Vorschlaege des Modells nie ungeprueft in die Datenbank gehen,
 * dass der Assistent nichts schreibt und dass Mieter nicht hinkommen.
 */

const AUSWAHL: Auswahl = {
  objekte: [
    { id: "o-west", name: "Westanlage 9" },
    { id: "o-lu", name: "Welserstraße 10" },
  ],
  einheiten: [
    { id: "e-33", bezeichnung: "Zimmer 3.3", objekt_id: "o-west", objekt: "Westanlage 9" },
    { id: "e-w2", bezeichnung: "Wohnung 2", objekt_id: "o-lu", objekt: "Welserstraße 10" },
  ],
};

/** Eine Attrappe der Schnittstelle: liefert die Antworten der Reihe nach. */
function attrappe(antworten: unknown[]) {
  const anfragen: Array<Record<string, unknown>> = [];
  const holen: Holer = async (_url, init) => {
    anfragen.push(JSON.parse(String(init.body)));
    const naechste = antworten.shift();
    if (naechste === "fehler") return new Response("kaputt", { status: 500 });
    return new Response(JSON.stringify(naechste), { status: 200 });
  };
  return { holen, anfragen };
}

const textAntwort = (text: string) => ({
  content: [{ type: "text", text }],
  stop_reason: "end_turn",
});
const werkzeugAntwort = (name: string, input: Record<string, unknown>, id = "w1") => ({
  content: [{ type: "tool_use", id, name, input }],
  stop_reason: "tool_use",
});

// ---------------------------------------------------------------------------

describe("normalisiere: was vom Modell kommt, wird geprueft", () => {
  test("eine unbekannte Kategorie wird zu sonstige", () => {
    const e = normalisiere({ betreff: "x", kategorie: "gefaehrlich" }, AUSWAHL);
    assert.equal(e.kategorie, "sonstige");
  });

  test("erfundene Objekt- und Einheitskennungen fallen weg", () => {
    const e = normalisiere(
      { betreff: "x", kategorie: "handwerker", objekt_id: "fremd", einheit_id: "auch-fremd" },
      AUSWAHL,
    );
    assert.equal(e.objekt_id, null);
    assert.equal(e.einheit_id, null);
  });

  test("die Einheit bringt ihr Haus mit und gewinnt gegen ein falsches", () => {
    const e = normalisiere(
      { betreff: "x", kategorie: "mieter", objekt_id: "o-west", einheit_id: "e-w2" },
      AUSWAHL,
    );
    assert.equal(e.einheit_id, "e-w2");
    assert.equal(e.objekt_id, "o-lu");
  });

  test("eine kaputte Adresse und ein kaputtes Datum werden leer", () => {
    const e = normalisiere(
      { betreff: "x", kategorie: "mieter", kontakt_email: "kein at", frist: "naechsten Freitag" },
      AUSWAHL,
    );
    assert.equal(e.kontakt_email, "");
    assert.equal(e.frist, null);
  });

  test("eine gueltige Adresse wird klein geschrieben, ein Datum bleibt", () => {
    const e = normalisiere(
      { betreff: "x", kategorie: "mieter", kontakt_email: "A.Muster@Example.org", frist: "2026-12-04" },
      AUSWAHL,
    );
    assert.equal(e.kontakt_email, "a.muster@example.org");
    assert.equal(e.frist, "2026-12-04");
  });

  test("in heiklen Kategorien schreibt die KI keine Nachricht vor", () => {
    for (const kategorie of ["mahnwesen", "behoerde"]) {
      const e = normalisiere(
        { betreff: "x", kategorie, nachricht_text: "Sehr geehrte …", nachricht_betreff: "B" },
        AUSWAHL,
        { vonKi: true },
      );
      assert.equal(e.nachricht_text, "", kategorie);
      assert.equal(e.nachricht_betreff, "", kategorie);
    }
  });

  test("was Stephan dort selbst schreibt, bleibt stehen", () => {
    const e = normalisiere(
      { betreff: "x", kategorie: "behoerde", nachricht_text: "Mein eigener Brief" },
      AUSWAHL,
    );
    assert.equal(e.nachricht_text, "Mein eigener Brief");
  });

  test("ueberlange Felder werden gekuerzt", () => {
    const e = normalisiere({ betreff: "x".repeat(500), kategorie: "sonstige" }, AUSWAHL);
    assert.equal(e.betreff.length, 200);
  });

  test("ein neuer Kontakt bekommt die Rolle der Kategorie, wo es sie gibt", () => {
    assert.equal(rolleFuer("handwerker"), "handwerker");
    assert.equal(rolleFuer("mieter"), "mieter");
    assert.equal(rolleFuer("rechnung"), "sonstige");
    assert.equal(rolleFuer("mahnwesen"), "sonstige");
  });
});

// ---------------------------------------------------------------------------

describe("verlaufFuerModell: ein gueltiges Gespraech fuer die Schnittstelle", () => {
  test("beginnt beim Nutzer und endet beim Nutzer", () => {
    const v = verlaufFuerModell([
      { rolle: "assistent", text: "Hallo" },
      { rolle: "nutzer", text: "Frage 1" },
      { rolle: "assistent", text: "Antwort 1" },
      { rolle: "nutzer", text: "Frage 2" },
      { rolle: "assistent", text: "halbe Antwort" },
    ]);
    assert.equal(v[0].role, "user");
    assert.equal(v[v.length - 1].role, "user");
    assert.equal(v.length, 3);
  });

  test("zwei Nachrichten derselben Seite werden zusammengelegt", () => {
    const v = verlaufFuerModell([
      { rolle: "nutzer", text: "a" },
      { rolle: "nutzer", text: "b" },
    ]);
    assert.equal(v.length, 1);
    assert.equal(v[0].content, "a\n\nb");
  });

  test("es geht nur das Ende eines langen Gespraechs mit", () => {
    const lang: Gespraechsschritt[] = Array.from({ length: 60 }, (_, i) => ({
      rolle: i % 2 === 0 ? "nutzer" : "assistent",
      text: `Nachricht ${i}`,
    }));
    lang.push({ rolle: "nutzer", text: "letzte" });
    assert.ok(verlaufFuerModell(lang).length <= 20);
  });

  test("leere Nachrichten zaehlen nicht", () => {
    assert.deepEqual(verlaufFuerModell([{ rolle: "nutzer", text: "   " }]), []);
  });
});

// ---------------------------------------------------------------------------

describe("beantworte: das Gespraech mit Werkzeugen", () => {
  const LAGE = { mandant: "STIG Immobilien eGbR", objekt: null, schluessel: "test" };

  test("ein Werkzeug wird ausgefuehrt, dann kommt die Antwort", async () => {
    const { holen, anfragen } = attrappe([
      werkzeugAntwort("lage_heute", {}),
      textAntwort("Heute liegen **2 Entwürfe** zur Freigabe."),
    ]);
    const aufrufe: string[] = [];
    const r = await beantworte([{ rolle: "nutzer", text: "Was ist heute zu tun?" }], {
      ...LAGE,
      holen,
      ausfuehren: async (name) => {
        aufrufe.push(name);
        return { zur_freigabe: { entwuerfe: 2 } };
      },
    });
    assert.ok(r.ok);
    assert.equal(r.text, "Heute liegen **2 Entwürfe** zur Freigabe.");
    assert.deepEqual(aufrufe, ["lage_heute"]);
    // Die zweite Anfrage traegt das Ergebnis des Werkzeugs zurueck.
    const zweite = anfragen[1].messages as Array<{ role: string; content: unknown }>;
    const letzte = zweite[zweite.length - 1];
    assert.equal(letzte.role, "user");
    assert.match(JSON.stringify(letzte.content), /tool_result/);
  });

  test("jede Anfrage nennt alle Werkzeuge und den Mandanten", async () => {
    const { holen, anfragen } = attrappe([textAntwort("ok")]);
    await beantworte([{ rolle: "nutzer", text: "Hallo" }], { ...LAGE, holen });
    const namen = (anfragen[0].tools as Array<{ name: string }>).map((w) => w.name);
    assert.deepEqual(namen, WERKZEUGE.map((w) => w.name));
    assert.match(String(anfragen[0].system), /STIG Immobilien eGbR/);
  });

  test("ein Vorschlag landet bei den Vorschlaegen, nicht in der Datenbank", async () => {
    const { holen } = attrappe([
      werkzeugAntwort("vorgang_vorschlagen", { betreff: "Scheibe", kategorie: "handwerker" }),
      textAntwort("Vorbereitet."),
    ]);
    const r = await beantworte([{ rolle: "nutzer", text: "Leg an: Scheibe" }], {
      ...LAGE,
      holen,
      ausfuehren: async (_name, eingabe, vorschlaege) => {
        vorschlaege.push(normalisiere(eingabe, AUSWAHL, { vonKi: true }));
        return { ok: true };
      },
    });
    assert.ok(r.ok);
    assert.equal(r.vorschlaege.length, 1);
    assert.equal(r.vorschlaege[0].betreff, "Scheibe");
  });

  test("ein Fehler im Werkzeug wird dem Modell gemeldet, nicht geworfen", async () => {
    const { holen, anfragen } = attrappe([
      werkzeugAntwort("rueckstaende", {}),
      textAntwort("Das konnte ich gerade nicht lesen."),
    ]);
    const r = await beantworte([{ rolle: "nutzer", text: "Rückstände?" }], {
      ...LAGE,
      holen,
      ausfuehren: async () => {
        throw new Error("Datenbank weg");
      },
    });
    assert.ok(r.ok);
    assert.match(JSON.stringify(anfragen[1].messages), /is_error/);
  });

  test("nach sechs Runden ist Schluss", async () => {
    const { holen, anfragen } = attrappe(
      Array.from({ length: 10 }, (_, i) => werkzeugAntwort("lage_heute", {}, `w${i}`)),
    );
    const r = await beantworte([{ rolle: "nutzer", text: "endlos" }], {
      ...LAGE,
      holen,
      ausfuehren: async () => ({}),
    });
    assert.ok(r.ok);
    assert.equal(anfragen.length, 6);
    assert.match(r.text, /genauer/);
  });

  test("antwortet die Schnittstelle nicht, gibt es einen Satz statt einer Ausnahme", async () => {
    const { holen } = attrappe(["fehler"]);
    const r = await beantworte([{ rolle: "nutzer", text: "Hallo" }], { ...LAGE, holen });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.fehler, /Status 500/);
  });
});

describe("ohne Schluessel wird nichts versucht", () => {
  test("frageModell meldet den fehlenden Schluessel", async () => {
    let gerufen = false;
    const r = await frageModell({
      system: "s",
      nachrichten: [{ role: "user", content: "x" }],
      schluessel: "",
      holen: async () => {
        gerufen = true;
        return new Response("{}");
      },
    });
    // "" zaehlt als nicht gesetzt -- es sei denn, die Umgebung hat einen.
    if (!process.env.ANTHROPIC_API_KEY) {
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.fehler, OHNE_SCHLUESSEL);
      assert.equal(gerufen, false);
    }
  });
});

// ---------------------------------------------------------------------------

describe("schlageVor: das Fenster 'Neuer Vorgang'", () => {
  test("das Modell muss das Formular benutzen", async () => {
    const { holen, anfragen } = attrappe([
      werkzeugAntwort(WERKZEUG_AUSFUELLEN.name, { betreff: "Scheibe tauschen", kategorie: "handwerker" }),
    ]);
    await schlageVor("Scheibe in Zimmer 3.3 tauschen lassen", {
      holen,
      schluessel: "test",
      auswahl: AUSWAHL,
      kontaktSuche: async () => null,
    });
    assert.deepEqual(anfragen[0].tool_choice, { type: "tool", name: WERKZEUG_AUSFUELLEN.name });
    // Die Liste der Haeuser und Einheiten geht mit, damit das Modell
    // Kennungen waehlen kann statt sie zu erfinden.
    assert.match(String(anfragen[0].system), /e-33: Zimmer 3\.3 \(Westanlage 9\)/);
  });

  test("der Vorschlag wird geprueft und der Kontakt aus dem Bestand uebernommen", async () => {
    const { holen } = attrappe([
      werkzeugAntwort(WERKZEUG_AUSFUELLEN.name, {
        betreff: "Scheibe Zimmer 3.3",
        kategorie: "handwerker",
        einheit_id: "e-33",
        objekt_id: "erfunden",
        kontakt_name: "ml hauselemente",
        nachricht_text: "Guten Tag …",
      }),
    ]);
    const r = await schlageVor("…", {
      holen,
      schluessel: "test",
      auswahl: AUSWAHL,
      kontaktSuche: async () => ({
        id: "k-ml",
        anzeigename: "ML Hauselemente",
        email: "d.harsch@ml-hauselemente.de",
      }),
    });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.entwurf.einheit_id, "e-33");
    assert.equal(r.entwurf.objekt_id, "o-west");
    assert.equal(r.entwurf.kontakt_id, "k-ml");
    assert.equal(r.entwurf.kontakt_name, "ML Hauselemente");
    assert.equal(r.entwurf.kontakt_email, "d.harsch@ml-hauselemente.de");
  });

  test("eine leere Beschreibung geht gar nicht erst raus", async () => {
    const { holen, anfragen } = attrappe([]);
    const r = await schlageVor("   ", { holen, schluessel: "test", auswahl: AUSWAHL });
    assert.equal(r.ok, false);
    assert.equal(anfragen.length, 0);
  });

  test("ohne Werkzeugaufruf kein Formular", async () => {
    const { holen } = attrappe([textAntwort("Hier ist mein Vorschlag …")]);
    const r = await schlageVor("x", { holen, schluessel: "test", auswahl: AUSWAHL });
    assert.equal(r.ok, false);
  });
});

// ---------------------------------------------------------------------------

describe("Der Assistent schreibt nicht", () => {
  const quelle = readFileSync(new URL("../lib/assistent.ts", import.meta.url), "utf8");
  const werkzeuge = quelle.slice(
    quelle.indexOf("export async function fuehreAus("),
    quelle.indexOf("// Das Gespraech"),
  );

  test("in den Werkzeugen steht kein schreibendes SQL", () => {
    assert.ok(werkzeuge.length > 1000, "Abschnitt der Werkzeuge nicht gefunden");
    assert.doesNotMatch(werkzeuge, /\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/);
  });

  test("die Werkzeuge lesen ueber query() -- also unter der Zeilensicherheit", () => {
    assert.doesNotMatch(werkzeuge, /pool\.query/);
    assert.match(quelle, /import \{ query \} from "\.\/db"/);
  });

  test("der Vorschlag legt nichts an", () => {
    assert.doesNotMatch(werkzeuge, /legeVorgangAn/);
  });
});

describe("Wer an die KI kommt", () => {
  for (const pfad of ["/api/assistent", "/api/vorgang", "/api/vorgang/vorschlag"]) {
    test(`ein Mieter kommt nicht an ${pfad}`, () => {
      assert.equal(darf(pfad, "mieter", "POST"), false);
      assert.equal(darf(pfad, "mieter", "GET"), false);
    });
  }

  test("wer nur lesen darf, legt keinen Vorgang an", () => {
    assert.equal(darf("/api/vorgang", "lesen", "POST"), false);
  });

  test("die Verwaltung darf", () => {
    assert.equal(darf("/api/vorgang", "verwalter", "POST"), true);
    assert.equal(darf("/api/assistent", "verwalter", "POST"), true);
  });
});

// ---------------------------------------------------------------------------

describe("gliedere: so sieht eine Antwort aus", () => {
  test("die Antwort vom ersten echten Lauf (28.11.2026)", () => {
    const teile = gliedere(
      [
        "Hier ist die Lage für heute:",
        "",
        "---",
        "",
        "✅ Freigaben",
        "- **2 Entwürfe** warten auf deine Freigabe",
        "",
        "---",
        "",
        "## Rückstände",
        "- 27 Fälle",
        "- Mahnwesen gesperrt",
      ].join("\n"),
    );
    assert.deepEqual(
      teile.map((t) => t.art),
      ["absatz", "absatz", "liste", "zwischen", "liste"],
    );
    // Keine Trennlinie bleibt als Text stehen.
    assert.doesNotMatch(JSON.stringify(teile), /---/);
  });

  test("eine Titelzeile direkt ueber einer Liste wird nicht zur Listenzeile", () => {
    const teile = gliedere("Leerstand\n- Zimmer 1.5\n- Zimmer 10 ab 01.12.");
    assert.deepEqual(teile, [
      { art: "absatz", zeilen: ["Leerstand"] },
      { art: "liste", punkte: ["Zimmer 1.5", "Zimmer 10 ab 01.12."] },
    ]);
  });

  test("nummerierte Punkte und Zeilenumbrueche im Absatz", () => {
    const teile = gliedere("Zeile eins\nZeile zwei\n\n1. erstens\n2. zweitens");
    assert.deepEqual(teile, [
      { art: "absatz", zeilen: ["Zeile eins", "Zeile zwei"] },
      { art: "nummern", punkte: ["erstens", "zweitens"] },
    ]);
  });
});

describe("suchkern: Name gegen Mail-Domain", () => {
  test("eine Firma findet ihre Domain", () => {
    assert.equal(suchkern("ML Hauselemente"), "mlhauselemente");
    assert.ok("ml-hauselemente.de".replace(/[^a-z0-9]/g, "").includes(suchkern("ML Hauselemente")));
  });

  test("Umlaute werden ausgeschrieben, wie in Domains ueblich", () => {
    assert.equal(suchkern("Glaserei Müller & Söhne"), "glasereimuellersoehne");
  });
});
