import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  erkenneTyp,
  pruefeDatei,
  sichererDateiname,
  ablagePfad,
  darfSehen,
  darfSchreiben,
  mietzusammensetzung,
  gueltigeMiete,
  mietZeitleiste,
  vortag,
  baujahrAusNotizen,
  istArt,
  istBild,
  GRENZE_BYTES,
  type Anpassung,
  type DokumentBezug,
} from "../lib/dokumente";

/**
 * Tests zum Dokumentenspeicher.
 *
 * Drei Dinge stehen hier auf dem Spiel, und alle drei fallen ohne Test
 * nicht auf:
 *
 *   1. Was hereinkommt. Eine Datei wird nach ihrem INHALT beurteilt. Die
 *      Endung ist eine Behauptung des Hochladenden -- wer sie glaubt,
 *      liefert sie später mit einem Content-Type aus, den der Browser
 *      anders auslegt als der Server dachte.
 *   2. Wohin sie kommt. Ein Dateiname aus dem Netz darf nie Teil eines
 *      Pfades werden. "../../etc/passwd" ist ein gültiger multipart-Name.
 *   3. Wer sie sieht. Row Level Security trennt Vermieter voneinander,
 *      nicht Mieter untereinander (db/015). Die zweite Grenze zieht
 *      darfSehen() -- und wenn die falsch ist, sieht ein Mieter das
 *      Übergabeprotokoll eines anderen.
 *
 * Ohne Datenbank: geprüft wird nur, was rein rechnet, plus der Text der
 * Migration.
 */

// ---------------------------------------------------------------------------
// Beispieldateien. Keine echten Dateien, nur die Markenzeichen am Anfang.
// ---------------------------------------------------------------------------

const PDF = Buffer.concat([
  Buffer.from("%PDF-1.7\n"),
  Buffer.alloc(64, 0x20),
]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 0),
]);
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(64, 0),
]);
const HEIC = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from("ftypheic"),
  Buffer.alloc(64, 0),
]);
/** Ein ZIP -- das häufigste, was versehentlich hochgeladen wird (docx, pages). */
const ZIP = Buffer.concat([Buffer.from("PK\u0003\u0004"), Buffer.alloc(64, 0)]);

describe("Der Dateityp wird am Inhalt erkannt", () => {
  test("die vier erlaubten Typen", () => {
    assert.deepEqual(erkenneTyp(PDF), { mime: "application/pdf", endung: ".pdf" });
    assert.deepEqual(erkenneTyp(PNG), { mime: "image/png", endung: ".png" });
    assert.deepEqual(erkenneTyp(JPEG), { mime: "image/jpeg", endung: ".jpg" });
    assert.deepEqual(erkenneTyp(HEIC), { mime: "image/heic", endung: ".heic" });
  });

  test("alles andere nicht", () => {
    assert.equal(erkenneTyp(ZIP), null);
    assert.equal(erkenneTyp(Buffer.from("das ist nur Text, kein Dokument")), null);
    // Zu kurz, um irgendetwas zu sein. Darf nicht abstürzen.
    assert.equal(erkenneTyp(Buffer.from([0x89, 0x50])), null);
    assert.equal(erkenneTyp(Buffer.alloc(0)), null);
  });

  test("eine Datei mit Endung .pdf und PNG-Inhalt gilt als PNG", () => {
    // Der Fall, gegen den die ganze Prüfung gebaut ist. Würde hier die
    // Endung gewinnen, stünde in mime_typ "application/pdf", und die
    // Ausliefer-Route setzte genau diesen Content-Type auf ein Bild.
    const p = pruefeDatei(PNG, "grundriss-1og.pdf");
    assert.equal(p.ok, true);
    assert.ok(p.ok);
    assert.equal(p.mime, "image/png");
    assert.equal(p.endung, ".png");
    // Und das Missverhältnis wird gemeldet, nicht verschwiegen.
    assert.equal(p.endungPasstNicht, true);
  });

  test("passende Endungen gelten als passend, auch .jpeg und .heif", () => {
    const a = pruefeDatei(JPEG, "bad.jpg");
    assert.ok(a.ok);
    assert.equal(a.endungPasstNicht, false);

    const b = pruefeDatei(JPEG, "Bad Nach Sanierung.JPEG");
    assert.ok(b.ok);
    assert.equal(b.endungPasstNicht, false);

    const c = pruefeDatei(HEIC, "IMG_0042.heif");
    assert.ok(c.ok);
    assert.equal(c.endungPasstNicht, false);

    // Ohne jede Endung ist nichts widersprüchlich.
    const d = pruefeDatei(PDF, "grundriss");
    assert.ok(d.ok);
    assert.equal(d.endungPasstNicht, false);
  });

  test("ein ZIP mit der Endung .png wird abgewiesen", () => {
    const p = pruefeDatei(ZIP, "foto.png");
    assert.equal(p.ok, false);
    assert.ok(!p.ok && /Dateityp/.test(p.fehler));
  });

  test("leere Dateien und Dateien über 25 MB werden abgewiesen", () => {
    const leer = pruefeDatei(Buffer.alloc(0), "leer.pdf");
    assert.equal(leer.ok, false);

    // Ein gültiger PDF-Anfang, aber zu groß. Der Typ allein genügt nicht.
    const zuGross = Buffer.concat([PDF, Buffer.alloc(GRENZE_BYTES, 0x20)]);
    const p = pruefeDatei(zuGross, "scan.pdf");
    assert.equal(p.ok, false);
    assert.ok(!p.ok && /25 MB/.test(p.fehler));

    // Genau an der Grenze geht noch.
    const genau = Buffer.concat([PDF, Buffer.alloc(GRENZE_BYTES - PDF.length)]);
    assert.equal(genau.length, GRENZE_BYTES);
    assert.equal(pruefeDatei(genau, "scan.pdf").ok, true);
  });

  test("istArt und istBild", () => {
    assert.equal(istArt("grundriss"), true);
    assert.equal(istArt("Grundriss"), false);
    assert.equal(istArt("rechnung"), false);
    assert.equal(istBild("image/png"), true);
    assert.equal(istBild("application/pdf"), false);
    assert.equal(istBild(null), false);
  });
});

// ---------------------------------------------------------------------------
// Namen und Pfade
// ---------------------------------------------------------------------------

describe("Ein Dateiname aus dem Netz wird nicht zu einem Pfad", () => {
  test("Pfadanteile fallen weg", () => {
    assert.equal(sichererDateiname("../../etc/passwd"), "passwd");
    assert.equal(sichererDateiname("..\\..\\Windows\\win.ini"), "win.ini");
    assert.equal(sichererDateiname("/etc/shadow"), "shadow");
    assert.equal(sichererDateiname("ordner/unterordner/plan.pdf"), "plan.pdf");
  });

  test("ein Name, der nur aus Punkten besteht, ist kein Name", () => {
    assert.equal(sichererDateiname(".."), "dokument");
    assert.equal(sichererDateiname("."), "dokument");
    assert.equal(sichererDateiname(""), "dokument");
    assert.equal(sichererDateiname("   "), "dokument");
    // Nach dem Abschneiden des Pfades bleibt nichts übrig.
    assert.equal(sichererDateiname("../../"), "dokument");
  });

  test("Steuerzeichen und Anführungszeichen verschwinden", () => {
    // Der Name steht später in einem Content-Disposition-Header. Ein
    // Anführungszeichen darin bricht den Header auf.
    assert.equal(
      sichererDateiname('plan";\u0000 attachment.pdf'),
      "plan; attachment.pdf",
    );
    assert.equal(sichererDateiname("a\nb\tc.png"), "abc.png");
  });

  test("lange Namen werden gekürzt", () => {
    assert.equal(sichererDateiname("x".repeat(400)).length, 160);
  });

  test("Umlaute bleiben", () => {
    assert.equal(
      sichererDateiname("Grundriss Küche & Bad (Dachgeschoß).pdf"),
      "Grundriss Küche & Bad (Dachgeschoß).pdf",
    );
  });

  test("ablagePfad baut nur aus Hash, Endung und Monat", () => {
    const p = ablagePfad("a".repeat(24), ".png", "2026-11", "/daten/dok");
    assert.equal(p, `/daten/dok/2026-11/${"a".repeat(24)}.png`);
  });

  test("ablagePfad weist alles ab, was aus der Ablage herausführt", () => {
    // Das ist die Gegenprobe zum Pfaddurchstieg: Selbst wenn ein
    // Programmierfehler einen Namen statt eines Hashes übergibt, entsteht
    // kein Pfad.
    assert.throws(
      () => ablagePfad("../../etc/passwd", ".png", "2026-11", "/daten/dok"),
      /Kein Inhaltshash/,
    );
    assert.throws(
      () => ablagePfad("a".repeat(24), "/../../x.png", "2026-11", "/daten/dok"),
      /Keine erlaubte Endung/,
    );
    assert.throws(
      () => ablagePfad("a".repeat(24), ".exe", "2026-11", "/daten/dok"),
      /Keine erlaubte Endung/,
    );
    assert.throws(
      () => ablagePfad("a".repeat(24), ".png", "../../etc", "/daten/dok"),
      /Kein Monat/,
    );
    // Grossbuchstaben sind kein Hex-Hash aus createHash(...).digest("hex").
    assert.throws(() => ablagePfad("A".repeat(24), ".png", "2026-11"), /Inhaltshash/);
  });
});

// ---------------------------------------------------------------------------
// Berechtigung
// ---------------------------------------------------------------------------

const O_EIGEN = "11111111-1111-1111-1111-111111111111";
const O_FREMD = "22222222-2222-2222-2222-222222222222";
const E_EIGEN = "aaaaaaaa-0000-0000-0000-00000000000a";
const E_FREMD = "aaaaaaaa-0000-0000-0000-00000000000b";
const MV_EIGEN = "bbbbbbbb-0000-0000-0000-00000000000a";
const MV_FREMD = "bbbbbbbb-0000-0000-0000-00000000000b";

const MIETER = {
  rolle: "mieter" as const,
  mietverhaeltnis: MV_EIGEN,
  einheit: E_EIGEN,
  objekt: O_EIGEN,
};

function dok(teil: Partial<DokumentBezug>): DokumentBezug {
  return {
    objekt_id: null,
    einheit_id: null,
    mietverhaeltnis_id: null,
    mieter_sichtbar: true,
    ...teil,
  };
}

describe("Wer darf welches Dokument sehen", () => {
  test("die Verwaltung sieht alles, was ihr Mandant hat", () => {
    // Die Mandantengrenze zieht Postgres (RLS), bevor die Zeile hier
    // ankommt. Innerhalb des Mandanten gibt es für Verwalter keine
    // Abstufung -- sonst wäre die Verwaltungsoberfläche unbenutzbar.
    const fremd = dok({ mietverhaeltnis_id: MV_FREMD, mieter_sichtbar: false });
    assert.equal(darfSehen({ rolle: "verwalter" }, fremd), true);
    assert.equal(darfSehen({ rolle: "lesen" }, fremd), true);
  });

  test("der Mieter sieht seinen Grundriss", () => {
    assert.equal(
      darfSehen(MIETER, dok({ einheit_id: E_EIGEN })),
      true,
    );
  });

  test("der Mieter sieht den Energieausweis seines Hauses", () => {
    assert.equal(darfSehen(MIETER, dok({ objekt_id: O_EIGEN })), true);
  });

  test("ohne den Haken sieht der Mieter nichts — auch nicht sein Eigenes", () => {
    // Am Mietverhältnis hängen Übergabeprotokolle mit Mängeln und
    // Schriftverkehr. Dass eine Datei hochgeladen wurde, ist keine
    // Entscheidung, sie dem Mieter zu zeigen.
    assert.equal(
      darfSehen(MIETER, dok({ mietverhaeltnis_id: MV_EIGEN, mieter_sichtbar: false })),
      false,
    );
    assert.equal(
      darfSehen(MIETER, dok({ einheit_id: E_EIGEN, mieter_sichtbar: false })),
      false,
    );
  });

  test("ein Dokument eines fremden Mietverhältnisses ist aus", () => {
    // Die Gegenprobe zur wichtigsten Grenze: Der Mieter hat eine gültige
    // Sitzung, das Dokument ist als mieter_sichtbar markiert -- und gehört
    // dem Nachbarn.
    assert.equal(
      darfSehen(MIETER, dok({ mietverhaeltnis_id: MV_FREMD })),
      false,
    );
  });

  test("eine fremde Einheit und ein fremdes Objekt sind aus", () => {
    assert.equal(darfSehen(MIETER, dok({ einheit_id: E_FREMD })), false);
    assert.equal(darfSehen(MIETER, dok({ objekt_id: O_FREMD })), false);
  });

  test("ein passender Bezug hebt einen fremden nicht auf", () => {
    // Das Übergabeprotokoll des Vormieters hängt an derselben Einheit.
    // Richtig ist: Einheit passt, Mietverhältnis nicht -- also nein.
    assert.equal(
      darfSehen(
        MIETER,
        dok({ einheit_id: E_EIGEN, mietverhaeltnis_id: MV_FREMD }),
      ),
      false,
    );
    // Und umgekehrt: eigenes Mietverhältnis, aber am fremden Objekt
    // hängend (so sollte es nie aussehen -- wenn doch, dann nein).
    assert.equal(
      darfSehen(
        MIETER,
        dok({ mietverhaeltnis_id: MV_EIGEN, objekt_id: O_FREMD }),
      ),
      false,
    );
  });

  test("ein Dokument ohne jeden Bezug ist für niemanden sichtbar", () => {
    // Die Tabelle verhindert das per CHECK. Eine Berechtigung, die sich
    // darauf verlässt, ist eine Berechtigung weniger.
    assert.equal(darfSehen(MIETER, dok({})), false);
  });

  test("ein Mieterzugang ohne Mietverhältnis darf nichts", () => {
    assert.equal(
      darfSehen({ rolle: "mieter" }, dok({ objekt_id: O_EIGEN })),
      false,
    );
    assert.equal(
      darfSehen(
        { rolle: "mieter", mietverhaeltnis: null, einheit: null, objekt: null },
        dok({ objekt_id: O_EIGEN }),
      ),
      false,
    );
  });

  test("schreiben darf nur der Verwalter", () => {
    assert.equal(darfSchreiben("verwalter"), true);
    assert.equal(darfSchreiben("lesen"), false);
    assert.equal(darfSchreiben("mieter"), false);
    assert.equal(darfSchreiben(""), false);
  });
});

// ---------------------------------------------------------------------------
// Mietzusammensetzung
// ---------------------------------------------------------------------------

describe("Die Miete wird aufgeschlüsselt", () => {
  test("Posten einzeln, Summe daraus", () => {
    const m = mietzusammensetzung({
      kaltmiete: "500.00",
      nebenkosten: "90.00",
      moeblierung: "60.00",
      gesamtmiete: null,
    });
    assert.deepEqual(
      m.posten.map((p) => [p.bezeichnung, p.betrag]),
      [["Kaltmiete", 500], ["Nebenkosten", 90], ["Möblierungszuschlag", 60]],
    );
    assert.equal(m.summe, 650);
    assert.equal(m.inklusiv, false);
    assert.equal(m.abweichung, null);
  });

  test("Inklusivmiete hat keine Posten, aber eine Summe", () => {
    const m = mietzusammensetzung({
      kaltmiete: null, nebenkosten: null, moeblierung: null,
      gesamtmiete: "630.00",
    });
    assert.equal(m.inklusiv, true);
    assert.equal(m.summe, 630);
    assert.deepEqual(m.posten, []);
  });

  test("ein Möblierungszuschlag von null erscheint nicht", () => {
    const m = mietzusammensetzung({
      kaltmiete: "500", nebenkosten: "90", moeblierung: "0", gesamtmiete: null,
    });
    assert.ok(!m.posten.some((p) => /Möblierung/.test(p.bezeichnung)));
  });

  test("die zugesagte Gesamtmiete gilt, die Lücke wird benannt", () => {
    // Genau der Fall, an dem der Möblierungszuschlag schon einmal verloren
    // gegangen ist: Im Vertrag stehen 600, die Posten ergeben 540. Die
    // Differenz ist keine Rundung, sondern ein fehlender Eintrag.
    const m = mietzusammensetzung({
      kaltmiete: "450", nebenkosten: "90", moeblierung: null,
      gesamtmiete: "600",
    });
    assert.equal(m.summe, 600);
    assert.equal(m.abweichung, 60);
  });

  test("gar keine Angaben ergeben null, nicht NaN", () => {
    const m = mietzusammensetzung({
      kaltmiete: null, nebenkosten: null, moeblierung: null, gesamtmiete: null,
    });
    assert.equal(m.summe, 0);
    assert.equal(m.inklusiv, false);
    assert.deepEqual(m.posten, []);
  });
});

// ---------------------------------------------------------------------------
// Welche Miete gilt wann
// ---------------------------------------------------------------------------

const VERTRAG = {
  kaltmiete: "500.00",
  nebenkosten: "90.00",
  moeblierung: null,
  gesamtmiete: null,
};

/** Zwei Anpassungen, bewusst unsortiert übergeben. */
const ANPASSUNGEN: Anpassung[] = [
  {
    gilt_ab: "2026-07-01",
    kaltmiete: "560.00", nebenkosten: "90.00",
    moeblierung: null, gesamtmiete: null,
    grund: "mieterhoehung", beleg: "Schreiben vom 28.03.2026",
  },
  {
    gilt_ab: "2025-01-01",
    kaltmiete: "520.00", nebenkosten: "90.00",
    moeblierung: null, gesamtmiete: null,
    grund: "vereinbarung", beleg: null,
  },
];

describe("Welche Miete am Stichtag gilt", () => {
  test("die jüngste Anpassung vor dem Stichtag", () => {
    const g = gueltigeMiete(ANPASSUNGEN, VERTRAG, "2026-11-02");
    assert.equal(g.miete.summe, 650);
    assert.equal(g.giltAb, "2026-07-01");
    assert.match(g.quelle, /Mietanpassung ab 2026-07-01 \(mieterhoehung\)/);
  });

  test("eine künftige Anpassung gilt noch nicht", () => {
    // Der teure Fehler in der anderen Richtung: Eine zum 01.01. erfasste
    // Erhöhung würde im Dezember schon gestellt.
    const g = gueltigeMiete(ANPASSUNGEN, VERTRAG, "2026-06-30");
    assert.equal(g.giltAb, "2025-01-01");
    assert.equal(g.miete.summe, 610);
  });

  test("ohne Anpassung gilt der Vertrag", () => {
    const g = gueltigeMiete([], VERTRAG, "2026-11-02");
    assert.equal(g.quelle, "Mietvertrag");
    assert.equal(g.giltAb, null);
    assert.equal(g.miete.summe, 590);
  });

  test("vor der ersten Anpassung gilt der Vertrag", () => {
    const g = gueltigeMiete(ANPASSUNGEN, VERTRAG, "2024-12-31");
    assert.equal(g.quelle, "Mietvertrag");
    assert.equal(g.miete.summe, 590);
  });
});

describe("Die Zeitleiste der Miete", () => {
  test("Vertrag zuerst, dann jede Anpassung, Lücken geschlossen", () => {
    const z = mietZeitleiste("2024-09-01", null, ANPASSUNGEN, VERTRAG);
    assert.equal(z.length, 3);

    assert.deepEqual(
      z.map((e) => [e.giltAb, e.bis, e.miete.summe]),
      [
        ["2024-09-01", "2024-12-31", 590],
        ["2025-01-01", "2026-06-30", 610],
        ["2026-07-01", null, 650],
      ],
    );
    assert.equal(z[0].quelle, "Mietvertrag");
    assert.equal(z[2].grund, "mieterhoehung");
    assert.equal(z[2].beleg, "Schreiben vom 28.03.2026");
  });

  test("das Ende des Mietverhältnisses beendet den letzten Eintrag", () => {
    const z = mietZeitleiste("2024-09-01", "2026-12-31", ANPASSUNGEN, VERTRAG);
    assert.equal(z[z.length - 1].bis, "2026-12-31");
  });

  test("eine Anpassung ab Vertragsbeginn verdrängt den Vertragsbetrag", () => {
    // Sonst stünde über der Zeitleiste ein Betrag, den niemand je
    // geschuldet hat -- bei den übernommenen Altmietverhältnissen ist
    // genau das der Normalfall: Der erfasste Betrag am Mietverhältnis ist
    // der heutige, die Anpassung trägt den von damals.
    const z = mietZeitleiste(
      "2025-01-01",
      null,
      [ANPASSUNGEN[1]],
      VERTRAG,
    );
    assert.equal(z.length, 1);
    assert.equal(z[0].quelle, "Mietanpassung");
    assert.equal(z[0].miete.summe, 610);
  });

  test("ohne Anpassung bleibt ein Eintrag übrig", () => {
    const z = mietZeitleiste("2026-01-01", null, [], VERTRAG);
    assert.deepEqual(
      z.map((e) => [e.giltAb, e.bis, e.quelle]),
      [["2026-01-01", null, "Mietvertrag"]],
    );
  });

  test("vortag rechnet über Monats- und Jahresgrenzen", () => {
    assert.equal(vortag("2026-07-01"), "2026-06-30");
    assert.equal(vortag("2026-01-01"), "2025-12-31");
    assert.equal(vortag("2024-03-01"), "2024-02-29");
  });
});

describe("Das Baujahr steht in den Notizen", () => {
  test("wird gelesen, wo es benannt ist", () => {
    assert.equal(
      baujahrAusNotizen(
        "Baujahr 1957, Sanierung 2017. Vier Etagen plus DG, " +
          "rund 920 m2 Grundflaeche.",
      ),
      "1957",
    );
    assert.equal(baujahrAusNotizen("baujahr: 1998"), "1998");
  });

  test("nichts wird geraten", () => {
    // Im Notizfeld der Westanlage 9 steht auch ein Sanierungsjahr. Eine
    // beliebige vierstellige Zahl zu nehmen hiesse, es als Baujahr
    // auszugeben.
    assert.equal(baujahrAusNotizen("Sanierung 2017, 920 m2"), null);
    assert.equal(baujahrAusNotizen(null), null);
    assert.equal(baujahrAusNotizen(""), null);
  });
});

// ---------------------------------------------------------------------------
// Die Migration
// ---------------------------------------------------------------------------
//
// Ohne Datenbank lässt sich nicht einspielen. Prüfbar ist der Text -- und
// zwar genau die Zusicherungen, auf die sich der Anwendungscode verlässt:
// Ohne RLS wäre die Mandantentrennung weg, ohne den Vorgabewert false wäre
// jedes hochgeladene Dokument sofort beim Mieter sichtbar.

const APP = join(import.meta.dirname, "..");
const MIGRATION = join(APP, "..", "db", "029_dokument.sql");
const sql = readFileSync(MIGRATION, "utf8");

describe("db/029_dokument.sql", () => {
  test("liegt unter genau dieser Nummer und ändert keine andere", () => {
    const dateien = readdirSync(join(APP, "..", "db")).filter((d) =>
      d.endsWith(".sql"),
    );
    assert.ok(dateien.includes("029_dokument.sql"));
    // Keine zweite 029: Der Runner merkt sich Dateinamen, zwei Dateien mit
    // derselben Nummer laufen beide und in unbestimmter Reihenfolge.
    assert.equal(dateien.filter((d) => d.startsWith("029_")).length, 1);
  });

  test("ist in eine Transaktion gefasst", () => {
    assert.equal((sql.match(/^BEGIN;/gm) ?? []).length, 1);
    assert.equal((sql.match(/^COMMIT;/gm) ?? []).length, 1);
    assert.ok(sql.indexOf("BEGIN;") < sql.indexOf("COMMIT;"));
  });

  test("Klammern und Dollar-Anführungen gehen auf", () => {
    // Ein unpaariges $$ macht den Rest der Datei zu einem Text -- psql
    // meldet dann eine Stelle weit hinter der echten Ursache.
    assert.equal((sql.match(/\$\$/g) ?? []).length % 2, 0);
    const ohneText = sql.replace(/--[^\n]*/g, "").replace(/'[^']*'/g, "''");
    assert.equal(
      (ohneText.match(/\(/g) ?? []).length,
      (ohneText.match(/\)/g) ?? []).length,
    );
  });

  test("legt die Tabelle mit allen verlangten Spalten an", () => {
    assert.match(sql, /CREATE TABLE IF NOT EXISTS dokument/);
    for (const spalte of [
      "mandant_id", "objekt_id", "einheit_id", "mietverhaeltnis_id",
      "art", "bezeichnung", "dateiname", "mime_typ", "groesse_bytes",
      "ablage_pfad", "sortierung", "mieter_sichtbar", "angelegt_am",
    ]) {
      assert.match(sql, new RegExp(`\\n\\s+${spalte}\\s`), `Spalte ${spalte}`);
    }
  });

  test("mandant_id ist gesetzt, mit Vorgabewert und Verweis", () => {
    assert.match(
      sql,
      /mandant_id\s+uuid NOT NULL REFERENCES mandant\(id\)[\s\S]{0,80}DEFAULT aktueller_mandant\(\)/,
    );
  });

  test("ablage_pfad ist Pflicht, der Bezug auch", () => {
    assert.match(sql, /ablage_pfad\s+text NOT NULL/);
    assert.match(
      sql,
      /CHECK \(objekt_id IS NOT NULL\s*\n?\s*OR einheit_id IS NOT NULL\s*\n?\s*OR mietverhaeltnis_id IS NOT NULL\)/,
    );
  });

  test("die Arten sind festgelegt", () => {
    const m = sql.match(/art\s+text NOT NULL DEFAULT 'sonstige'\s*\n?\s*CHECK \(art IN \(([^)]*)\)/);
    assert.ok(m, "Kein CHECK auf art");
    for (const art of [
      "grundriss", "foto", "mietvertrag", "uebergabeprotokoll",
      "energieausweis", "sonstige",
    ]) {
      assert.ok(m[1].includes(`'${art}'`), `Art ${art} fehlt im CHECK`);
    }
  });

  test("mieter_sichtbar ist standardmäßig aus", () => {
    // Die wichtigste Zeile der Migration. Mit DEFAULT true wäre jedes
    // hochgeladene Übergabeprotokoll sofort beim Mieter zu sehen.
    assert.match(sql, /mieter_sichtbar boolean NOT NULL DEFAULT false/);
    assert.doesNotMatch(sql, /mieter_sichtbar[^\n]*DEFAULT true/);
  });

  test("RLS ist an, erzwungen und beidseitig geprüft", () => {
    assert.match(sql, /ALTER TABLE dokument ENABLE ROW LEVEL SECURITY/);
    assert.match(sql, /ALTER TABLE dokument FORCE\s+ROW LEVEL SECURITY/);
    assert.match(
      sql,
      /CREATE POLICY dokument_mandant ON dokument\s*\n\s*USING \(mandant_id = aktueller_mandant\(\)\)\s*\n\s*WITH CHECK \(mandant_id = aktueller_mandant\(\)\)/,
    );
    assert.match(
      sql,
      /GRANT SELECT, INSERT, UPDATE, DELETE ON dokument TO stig_app/,
    );
  });

  test("die drei Bezugsspalten sind indiziert", () => {
    assert.match(sql, /CREATE INDEX IF NOT EXISTS \w+\s+ON dokument \(einheit_id\)/);
    assert.match(sql, /CREATE INDEX IF NOT EXISTS \w+\s+ON dokument \(objekt_id\)/);
    assert.match(
      sql,
      /CREATE INDEX IF NOT EXISTS \w+\s+ON dokument \(mietverhaeltnis_id\)/,
    );
  });

  test("der Mandant steckt auch im Fremdschlüssel", () => {
    // Fremdschlüsselprüfungen laufen im System und unterliegen RLS nicht.
    // Ohne den zusammengesetzten Schlüssel könnte ein Dokument an der
    // Einheit eines anderen Vermieters hängen -- unsichtbar und gültig.
    for (const ziel of ["objekt", "einheit", "mietverhaeltnis"]) {
      assert.ok(
        sql.includes(`REFERENCES ${ziel} (id, mandant_id)`),
        `Kein zusammengesetzter Fremdschlüssel auf ${ziel}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Der Pfad auf der Platte bleibt im Server
// ---------------------------------------------------------------------------

describe("Kein Ablagepfad im HTML", () => {
  test("keine Oberfläche fasst ablage_pfad an", () => {
    // Ein Pfad im HTML wäre nicht nur unschön: Er verrät den Aufbau der
    // Ablage, und eine Oberfläche, die ihn kennt, lädt irgendwann an der
    // Berechtigungsprüfung vorbei. Geprüft werden alle .tsx -- Seiten und
    // Bausteine, also genau das, was HTML erzeugt.
    const treffer: string[] = [];
    const durchlaufen = (verzeichnis: string) => {
      for (const name of readdirSync(verzeichnis)) {
        if (name === "node_modules" || name.startsWith(".")) continue;
        const pfad = join(verzeichnis, name);
        if (statSync(pfad).isDirectory()) {
          durchlaufen(pfad);
          continue;
        }
        if (!name.endsWith(".tsx")) continue;
        if (readFileSync(pfad, "utf8").includes("ablage_pfad")) {
          treffer.push(pfad.slice(APP.length + 1));
        }
      }
    };
    durchlaufen(APP);

    assert.deepEqual(
      treffer,
      [],
      "Diese Oberflächen fassen ablage_pfad an:\n" + treffer.join("\n"),
    );
  });

  test("die Liste der ausgegebenen Spalten enthält ihn nicht", () => {
    // Die Gegenprobe zur Prüfung oben: Sie kann nur greifen, solange
    // dokumenteFuer() den Pfad nicht mitgibt. Stünde er in SPALTEN,
    // käme er über die Eigenschaften der Bausteine doch ins HTML, ohne
    // dass das Wort dort auftaucht.
    const quelle = readFileSync(join(APP, "lib", "dokumente.ts"), "utf8");
    const liste = quelle.match(/const SPALTEN = `([\s\S]*?)`/);
    assert.ok(liste, "SPALTEN nicht gefunden");
    assert.ok(!liste[1].includes("ablage_pfad"));
    assert.ok(liste[1].includes("mieter_sichtbar"));
  });
});
