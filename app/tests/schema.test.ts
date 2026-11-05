import { test, describe } from "node:test";
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

/**
 * ON CONFLICT gegen die tatsaechlichen Eindeutigkeiten.
 *
 * Diese Pruefung faengt einen Fehler, der sich wie ein Tippfehler liest
 * und wie ein Ausfall wirkt.
 *
 * Postgres leitet das Ziel einer ON-CONFLICT-Klausel aus den genannten
 * SPALTEN ab, nicht aus dem Namen der Bedingung. Passt keine eindeutige
 * Bedingung genau auf diese Spaltenliste, wird die ganze Anweisung
 * abgewiesen: "there is no unique or exclusion constraint matching the
 * ON CONFLICT specification".
 *
 * Genau das lag hier vor. db/010 hat die globale Eindeutigkeit auf
 * kontakt_email durch (mandant_id, email) ersetzt -- zwei Vermieter mit
 * demselben Handwerker sind in einer Region der Normalfall. Die Route
 * api/stammdaten nannte weiterhin "ON CONFLICT (email)".
 *
 * Die Folge war nicht eine Dublette, sondern ein vollstaendiger Ausfall
 * genau einer Handlung: Einen Mieter MIT E-Mail-Adresse anzulegen
 * scheiterte samt Mietverhaeltnis, weil beides in einer Transaktion
 * laeuft. Ohne Adresse ging es. Der Fehler traf also nur den, der
 * sorgfaeltig genug war, die Adresse gleich mitzupflegen -- und er
 * ueberlebte jeden Test, weil kein Test eine Datenbank anfasst.
 *
 * Geprueft wird deshalb gegen den Text: Jede Spaltenliste, die eine
 * ON-CONFLICT-Klausel nennt, muss woertlich als UNIQUE-Bedingung in
 * irgendeiner Migration stehen.
 */
test("jede ON-CONFLICT-Klausel trifft eine vorhandene Eindeutigkeit", () => {
  /**
   * Kommentare heraus, bevor gesucht wird.
   *
   * Ohne das meldet dieser Test seinen eigenen Erklaertext als Mangel:
   * Im Kommentar ueber der berichtigten Stelle steht die FALSCHE Form
   * woertlich, damit nachlesbar bleibt, was dort einmal stand. Ein Test,
   * der Dokumentation fuer Code haelt, zwingt dazu, die Begruendung
   * wegzulassen -- und das ist der teurere Verlust.
   */
  const ohneKommentare = (quelle: string) =>
    quelle
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
      .replace(/^\s*--[^\n]*/gm, " ");

  const spaltenliste = (roh: string) =>
    roh
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
      .join(",");

  // Welche Eindeutigkeiten es am Ende WIRKLICH gibt.
  //
  // Die Migrationen werden in ihrer Reihenfolge gelesen und ein
  // Bestand fortgeschrieben. Das ist der Punkt, an dem die erste
  // Fassung dieses Tests scheiterte: Sie sammelte jede UNIQUE-Zeile
  // ein, die je geschrieben wurde -- auch die aus db/001, die db/010
  // ausdruecklich wieder entfernt. Damit galt "ON CONFLICT (email)"
  // als gedeckt, und der Test blieb gruen, waehrend die Anwendung
  // genau daran scheiterte. Ein Test, der den Fehler nicht findet, den
  // er finden soll, ist schlimmer als keiner: Er sagt, es sei geprueft.
  const nachName = new Map<string, string>();
  const ohneNamen = new Set<string>();

  for (const datei of readdirSync(DB)
    .filter((d) => d.endsWith(".sql"))
    .sort()) {
    const sql = ohneKommentare(readFileSync(join(DB, datei), "utf8"));

    // Alle Ereignisse MIT ihrer Stelle in der Datei sammeln und dann in
    // dieser Reihenfolge anwenden.
    //
    // Hier lag der zweite Fehler dieses Tests: Zuerst wurden alle
    // Hinzufuegungen verarbeitet, dann alle Loeschungen. db/010 loescht
    // kontakt_email_email_key und legt sie unmittelbar danach neu an --
    // mit (mandant_id, email) statt (email). Nach Art statt nach
    // Reihenfolge verarbeitet gewann die Loeschung, und der Test
    // behauptete, es gebe die Bedingung nicht, die es sehr wohl gibt.
    // Eine Reihenfolge, die in der Datei steht, darf ein Leser nicht
    // umsortieren.
    type Ereignis =
      | { bei: number; art: "add"; name: string; spalten: string }
      | { bei: number; art: "add-anonym"; spalten: string }
      | { bei: number; art: "drop"; name: string };
    const ereignisse: Ereignis[] = [];

    for (const m of sql.matchAll(
      /CONSTRAINT\s+([a-z_][a-z0-9_]*)\s+UNIQUE\s*(?:NULLS\s+NOT\s+DISTINCT\s*)?\(([^)]+)\)/gi,
    )) {
      ereignisse.push({
        bei: m.index!,
        art: "add",
        name: m[1].toLowerCase(),
        spalten: spaltenliste(m[2]),
      });
    }

    for (const m of sql.matchAll(
      /\bUNIQUE\s*(?:NULLS\s+NOT\s+DISTINCT\s*)?\(([^)]+)\)/gi,
    )) {
      const vorher = sql.slice(Math.max(0, m.index! - 80), m.index!);
      if (/CONSTRAINT\s+[a-z_][a-z0-9_]*\s*$/i.test(vorher)) continue;
      ereignisse.push({
        bei: m.index!,
        art: "add-anonym",
        spalten: spaltenliste(m[1]),
      });
    }

    for (const m of sql.matchAll(/CREATE\s+UNIQUE\s+INDEX[^(]*\(([^)]+)\)/gi)) {
      ereignisse.push({
        bei: m.index!,
        art: "add-anonym",
        spalten: spaltenliste(m[1].replace(/\s+WHERE\s+.*$/i, "")),
      });
    }

    for (const m of sql.matchAll(
      /DROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi,
    )) {
      ereignisse.push({ bei: m.index!, art: "drop", name: m[1].toLowerCase() });
    }

    ereignisse.sort((a, b) => a.bei - b.bei);

    for (const e of ereignisse) {
      if (e.art === "add") {
        nachName.set(e.name, e.spalten);
      } else if (e.art === "add-anonym") {
        ohneNamen.add(e.spalten);
      } else {
        const spalten = nachName.get(e.name);
        nachName.delete(e.name);
        // Eine unbenannt angelegte Bedingung traegt den Namen, den
        // Postgres vergibt (tabelle_spalte_key). Wird sie darueber
        // entfernt, muss auch die Spaltenliste weichen -- sonst bliebe
        // genau der Eintrag stehen, der den Fehler deckt.
        if (spalten) ohneNamen.delete(spalten);
        else {
          const ausName = e.name.replace(/_key$/, "").split("_").pop();
          if (ausName) ohneNamen.delete(ausName);
        }
      }
    }
  }

  const eindeutig = new Set<string>([...nachName.values(), ...ohneNamen]);
  assert.ok(
    eindeutig.size > 5,
    "Keine UNIQUE-Bedingungen gefunden -- der Test prueft dann nichts",
  );

  const code = join(APP, "app");
  const dateien: string[] = [];
  const sammle = (ordner: string) => {
    for (const e of readdirSync(ordner, { withFileTypes: true })) {
      const pfad = join(ordner, e.name);
      if (e.isDirectory()) sammle(pfad);
      else if (e.name.endsWith(".ts") || e.name.endsWith(".tsx")) dateien.push(pfad);
    }
  };
  sammle(code);
  sammle(join(APP, "lib"));

  const fehler: string[] = [];
  let gefunden = 0;
  for (const datei of dateien) {
    const text = ohneKommentare(readFileSync(datei, "utf8"));
    for (const t of text.matchAll(/ON\s+CONFLICT\s*\(([^)]+)\)/gi)) {
      gefunden++;
      const liste = spaltenliste(t[1]);
      if (!eindeutig.has(liste)) {
        fehler.push(
          `${datei.replace(APP, "app")}: ON CONFLICT (${liste}) — ` +
            `dazu gibt es in db/ keine UNIQUE-Bedingung`,
        );
      }
    }
  }
  assert.ok(gefunden > 0, "Keine ON-CONFLICT-Klausel gefunden");
  assert.deepEqual(fehler, [], fehler.join("\n"));
});

/**
 * In db/ gehoeren nur Migrationen.
 *
 * Anlass, 05.11.2026: Dort lag saat-gestaltung.sql -- erfundene Mieter
 * fuer die oertliche Gestaltungsarbeit, beginnend mit DELETE FROM
 * kontakt, mietverhaeltnis, vorgang, nachricht. migrieren.sh nimmt
 * db/*.sql und hat die Datei auf dem Server ausgefuehrt. Dass dabei
 * nichts verloren ging, lag am Fremdschluessel und nicht an einer
 * Absicht.
 *
 * Der Waechter prueft das Verzeichnis, nicht das Skript: Das Muster in
 * migrieren.sh laesst sich aendern, ohne dass ein Test es merkt -- eine
 * fremde Datei in db/ dagegen faellt hier sofort auf. Und er prueft das
 * Offensichtliche mit: keine zwei Migrationen mit derselben Nummer.
 */
describe("db/ enthaelt nur Migrationen", () => {
  const dbVerzeichnis = join(import.meta.dirname, "..", "..", "db");
  const sqlDateien = readdirSync(dbVerzeichnis).filter((d) => d.endsWith(".sql"));

  test("jede .sql-Datei traegt drei Ziffern und einen Unterstrich", () => {
    const fremd = sqlDateien.filter((d) => !/^\d{3}_.+\.sql$/.test(d));
    assert.deepEqual(
      fremd,
      [],
      "Keine Migration. Saatdaten und Hilfsskripte gehoeren nach entwicklung/.",
    );
  });

  test("keine Nummer zweimal", () => {
    const nummern = sqlDateien.map((d) => d.slice(0, 3));
    const doppelt = nummern.filter((n, i) => nummern.indexOf(n) !== i);
    assert.deepEqual([...new Set(doppelt)], []);
  });

  test("es gibt ueberhaupt Migrationen -- sonst prueft der Waechter nichts", () => {
    assert.ok(sqlDateien.length > 25, `nur ${sqlDateien.length} gefunden`);
  });
});
