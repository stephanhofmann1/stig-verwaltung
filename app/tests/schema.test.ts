import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Tests gegen das Schema, nicht gegen Logik.
 *
 * Diese Datei faengt eine Fehlerklasse ab, die sich sonst nicht bemerkbar
 * macht: einen Spaltennamen, der nirgends existiert. Normalerweise ist das
 * harmlos, weil Postgres dann einen Fehler wirft. Bei einem defensiven
 * Lesezugriff ueber to_jsonb(zeile) ->> 'spalte' ist es das nicht -- der
 * Ausdruck ist syntaktisch gueltig, der Schluessel fehlt einfach, und das
 * Ergebnis ist NULL.
 *
 * Genau das war hier der Fall: lib/sollstellung.ts las 'moeblierung', die
 * Migration legte 'moeblierungszuschlag' an. Kein Fehler, keine Warnung --
 * nur jeden Monat ein zu niedriger Sollbetrag je moebliertem Zimmer. So ein
 * Fehler faellt erst bei der Jahresabrechnung auf, und dann rueckwirkend.
 *
 * Der Test liest keine Datenbank. Er vergleicht zwei Textbestaende, und das
 * ist Absicht: Er muss auch dort laufen, wo kein Postgres steht -- im Build,
 * vor dem Deploy, auf einem fremden Rechner.
 */

const APP = join(import.meta.dirname, "..");
const DB = join(APP, "..", "db");

/** Alle Spaltennamen, die irgendeine Migration anlegt. */
function spaltenAusMigrationen(): Set<string> {
  const spalten = new Set<string>();

  for (const datei of readdirSync(DB).filter((d) => d.endsWith(".sql"))) {
    const sql = readFileSync(join(DB, datei), "utf8");

    // ALTER TABLE ... ADD COLUMN [IF NOT EXISTS] <name>
    for (const t of sql.matchAll(
      /ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi,
    )) {
      spalten.add(t[1].toLowerCase());
    }

    // CREATE TABLE <name> ( ... ) -- erste Spalte je Zeile innerhalb der
    // Klammern. Bewusst grob: Der Test soll Namen SAMMELN, nicht die
    // Tabellenstruktur nachbilden. Ein zu grosszuegiger Bestand laesst
    // hoechstens einen echten Fehler durch; ein zu enger bricht bei jeder
    // harmlosen Schemaaenderung.
    for (const tabelle of sql.matchAll(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[a-z_][a-z0-9_]*\s*\(([\s\S]*?)\n\s*\);/gi,
    )) {
      for (const zeile of tabelle[1].split("\n")) {
        const roh = zeile.trim();
        if (!roh || roh.startsWith("--")) continue;
        // Tabellenweite Bedingungen sind keine Spalten.
        if (
          /^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT|EXCLUDE|LIKE)\b/i.test(roh)
        ) {
          continue;
        }
        const name = roh.match(/^([a-z_][a-z0-9_]*)/);
        if (name) spalten.add(name[1].toLowerCase());
      }
    }
  }

  return spalten;
}

/** Jeder defensive Lesezugriff im Anwendungscode, mit Fundstelle. */
function defensiveLesezugriffe(): { datei: string; schluessel: string }[] {
  const treffer: { datei: string; schluessel: string }[] = [];

  const durchlaufen = (verzeichnis: string) => {
    for (const eintrag of readdirSync(verzeichnis, { withFileTypes: true })) {
      // .next enthaelt Kopien des Quellcodes aus dem letzten Build. Die mit
      // zu pruefen heisst, einen bereits behobenen Fehler erneut zu melden.
      if (eintrag.name === "node_modules" || eintrag.name.startsWith(".")) {
        continue;
      }
      const pfad = join(verzeichnis, eintrag.name);
      if (eintrag.isDirectory()) {
        durchlaufen(pfad);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(eintrag.name)) continue;
      if (eintrag.name.endsWith(".test.ts")) continue;

      const quelle = readFileSync(pfad, "utf8");
      for (const t of quelle.matchAll(
        /to_jsonb\s*\([^)]*\)\s*->>\s*'([a-z_][a-z0-9_]*)'/gi,
      )) {
        treffer.push({
          datei: pfad.slice(APP.length + 1),
          schluessel: t[1].toLowerCase(),
        });
      }
    }
  };

  durchlaufen(APP);
  return treffer;
}

test("to_jsonb-Lesezugriffe treffen Spalten, die es wirklich gibt", () => {
  const spalten = spaltenAusMigrationen();
  const zugriffe = defensiveLesezugriffe();

  // Findet der Test gar keine Zugriffe mehr, ist entweder der letzte entfernt
  // worden oder der Suchausdruck passt nicht mehr. Beides soll auffallen,
  // sonst ist der Test ab dann wirkungslos und meldet trotzdem gruen.
  assert.ok(
    zugriffe.length > 0,
    "Kein to_jsonb(...)->>'spalte' gefunden. Entweder gibt es keinen " +
      "defensiven Zugriff mehr -- dann diesen Test loeschen -- oder der " +
      "Suchausdruck trifft nicht mehr.",
  );

  const fehlend = zugriffe.filter((z) => !spalten.has(z.schluessel));

  assert.deepEqual(
    fehlend,
    [],
    "Diese Schluessel treffen keine Spalte in db/*.sql. Sie liefern still " +
      "NULL, nicht einen Fehler:\n" +
      fehlend
        .map((f) => `  ${f.datei}: ->> '${f.schluessel}'`)
        .join("\n"),
  );
});

test("der Moeblierungszuschlag wird wirklich gelesen", () => {
  // Der konkrete Fall, der den Test ausgeloest hat. Die allgemeine Pruefung
  // oben deckt ihn mit ab, aber ein benannter Test sagt im Fehlerfall direkt,
  // worum es geht: zu niedrige Mieten.
  const quelle = readFileSync(join(APP, "lib", "sollstellung.ts"), "utf8");
  const zugriff = quelle.match(
    /to_jsonb\s*\([^)]*\)\s*->>\s*'([a-z_][a-z0-9_]*)'\s*\)?\s*AS\s+moeblierung/i,
  );

  assert.ok(zugriff, "lib/sollstellung.ts liest keinen Moeblierungszuschlag.");
  assert.ok(
    spaltenAusMigrationen().has(zugriff[1]),
    `lib/sollstellung.ts liest '${zugriff[1]}', aber keine Migration legt ` +
      "diese Spalte an. Folge: Der Zuschlag bleibt 0 und jede Sollstellung " +
      "fuer ein moebliertes Zimmer ist zu niedrig.",
  );
});
