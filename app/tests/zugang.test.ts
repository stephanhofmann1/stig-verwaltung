import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { baueSitzung, pruefeSitzung, type Sitzung } from "../lib/sitzung";

/**
 * Tests des Mandantenwechsels.
 *
 * Hier liegt die Mandantentrennung. Ein Fehler an dieser Stelle zeigt
 * einem Benutzer die Daten eines anderen -- im konkreten Fall: Igor die
 * privaten Steuerbelege. Darum pruefen die Tests nicht nur, dass der
 * Wechsel geht, sondern vor allem, dass er nicht geht, wo er nicht
 * darf.
 *
 * Alle Kennungen hier sind erfunden.
 */

const GEHEIM = "x".repeat(40);
process.env.SITZUNG_GEHEIMNIS ??= GEHEIM;

const STIG = "11111111-1111-4111-8111-111111111111";
const PRIVAT = "22222222-2222-4222-8222-222222222222";
const FREMD = "33333333-3333-4333-8333-333333333333";

describe("Das Sitzungscookie traegt den Heimatmandanten", () => {
  test("nach dem Wechsel stehen beide drin", () => {
    const s: Sitzung = {
      name: "stephan",
      mandant: PRIVAT,
      rolle: "verwalter",
      heimat: STIG,
    };
    const gelesen = pruefeSitzung(baueSitzung(s));
    assert.ok(gelesen);
    assert.equal(gelesen!.mandant, PRIVAT);
    assert.equal(gelesen!.heimat, STIG);
  });

  test("ein Cookie ohne sechstes Feld bleibt gueltig", () => {
    // Alle Cookies von vor dem Umschalter sehen so aus. Sie duerfen
    // niemanden aussperren -- fuer einen Benutzer mit einem Mandanten
    // ist der Heimatmandant derselbe.
    const alt: Sitzung = { name: "stephan", mandant: STIG, rolle: "verwalter" };
    const gelesen = pruefeSitzung(baueSitzung(alt));
    assert.ok(gelesen);
    assert.equal(gelesen!.heimat, STIG);
  });

  test("ein veraendertes Cookie wird nicht angenommen", () => {
    const echt = baueSitzung({
      name: "stephan",
      mandant: STIG,
      rolle: "verwalter",
      heimat: STIG,
    });
    // Den Mandanten im Klartext austauschen und die alte Unterschrift
    // dranlassen -- genau der Versuch, gegen den die Unterschrift steht.
    const punkt = echt.lastIndexOf(".");
    const nutzlast = Buffer.from(echt.slice(0, punkt), "base64url").toString();
    const gefaelscht = nutzlast.replace(STIG, FREMD);
    const cookie = `${Buffer.from(gefaelscht).toString("base64url")}.${echt.slice(punkt + 1)}`;
    assert.equal(pruefeSitzung(cookie), null);
  });

  test("ein Name mit Trennzeichen wird abgewiesen, nicht verpackt", () => {
    // Ohne diese Sperre verschiebt ein Name wie "a|0|<mandant>|verwalter"
    // alle folgenden Felder -- die Unterschrift waere gueltig, die
    // Bedeutung falsch.
    assert.throws(
      () =>
        baueSitzung({
          name: `stephan|${Date.now() + 99999999}|${FREMD}|verwalter`,
          mandant: STIG,
          rolle: "verwalter",
        }),
      /kein \| enthalten/,
    );
  });
});

describe("Was der Code tun muss -- am Quelltext geprueft", () => {
  const zugang = readFileSync(new URL("../lib/zugang.ts", import.meta.url), "utf8");
  const route = readFileSync(
    new URL("../app/api/mandant/wechseln/route.ts", import.meta.url),
    "utf8",
  );
  const sql = readFileSync(
    new URL("../../db/035_benutzer_zugang.sql", import.meta.url),
    "utf8",
  );

  test("die Rolle kommt aus der Datenbank, nicht aus der Anfrage", () => {
    // Käme sie aus der Anfrage, könnte sich jemand beim Wechseln selbst
    // zum Verwalter machen.
    assert.match(zugang, /rolle:\s*treffer\.rolle/);
    assert.ok(
      !/rolle:\s*(body|anfrage|ziel)/.test(route),
      "die Route setzt die Rolle aus der Anfrage",
    );
  });

  test("der Heimatmandant wird beim Wechsel nicht überschrieben", () => {
    assert.match(zugang, /heimat:\s*sitzung\.heimat\s*\?\?\s*sitzung\.mandant/);
  });

  test("ein Mieterzugang bekommt keine Liste und keinen Wechsel", () => {
    assert.match(zugang, /if \(sitzung\.rolle === "mieter"\) return \[\];/);
    assert.match(route, /sitzung\.rolle === "mieter"/);
  });

  test("der Zielmandant wird gegen die offenen Zugänge geprüft", () => {
    assert.match(zugang, /const offen = await zugaengeFuer\(sitzung\)/);
    assert.match(zugang, /offen\.find\(\(z\) => z\.mandant === ziel\)/);
    assert.match(zugang, /if \(!treffer\) return null;/);
  });

  test("die Abfrage läuft am Pool, nicht über query()", () => {
    // query() setzt app.mandant auf den aktiven Mandanten -- damit sähe
    // die Abfrage den Zielmandanten nie.
    assert.match(zugang, /pool\.query<Zeile>\(`SELECT \* FROM zugaenge_fuer/);
    assert.ok(!/from "\.\/db";[\s\S]*\bquery\(/.test(zugang.split("\n")[0]));
  });

  test("die Tabelle ist für die Anwendungsrolle ganz zu", () => {
    assert.match(sql, /ALTER TABLE benutzer_zugang ENABLE ROW LEVEL SECURITY/);
    // Keine Policy: Das ist der Punkt. Mit Policy auf aktueller_mandant()
    // wäre genau der Fall gesperrt, für den die Tabelle existiert.
    assert.ok(
      !/CREATE POLICY[^\n]*ON benutzer_zugang/.test(sql),
      "benutzer_zugang hat eine Policy -- dann ist der Zugriff doppelt geregelt",
    );
    // FORCE würde auch den Eigentümer binden, und damit die
    // SECURITY-DEFINER-Funktion aussperren.
    assert.ok(
      !/benutzer_zugang FORCE/.test(sql),
      "FORCE auf benutzer_zugang sperrt die Funktion selbst aus",
    );
  });

  test("die Funktion ist eng zugeschnitten", () => {
    assert.match(sql, /SECURITY DEFINER/);
    assert.match(sql, /SET search_path = public, pg_temp/);
    assert.match(sql, /REVOKE ALL ON FUNCTION zugaenge_fuer\(text, uuid\) FROM PUBLIC/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION zugaenge_fuer\(text, uuid\) TO stig_app/);
    // Kein LIKE, keine Mustersuche -- ein Name herein, eine Liste heraus.
    // Geprüft am Code ohne Kommentare: im Kommentar steht das Wort, weil
    // dort begründet ist, warum es im Code nicht steht.
    const ohneKommentar = sql.replace(/--[^\n]*/g, "");
    assert.ok(!/\bLIKE\b/i.test(ohneKommentar), "die Funktion sucht mit einem Muster");
  });

  test("Mieter stehen nie in der Zugangstabelle", () => {
    assert.match(sql, /CHECK \(rolle IN \('verwalter','lesen'\)\)/);
    assert.match(sql, /b\.rolle <> 'mieter'/);
  });

  test("die Spalte heißt nicht mandant_id", () => {
    // In diesem Schema bedeutet mandant_id "diese Zeile gehört jenem
    // Mandanten", und darauf sitzt die RLS-Policy. Hier bedeutet der Wert
    // das Gegenteil: "dieser Benutzer darf in jenen Mandanten".
    assert.match(sql, /ziel_mandant_id\s+uuid\s+NOT NULL REFERENCES mandant\(id\)/);
    assert.ok(
      !/benutzer_zugang[\s\S]{0,400}?\bmandant_id\s+uuid/.test(sql),
      "die Tabelle hat eine Spalte mandant_id",
    );
  });

  test("der Grund, nicht nur die Ursache, steht nicht in der Antwort", () => {
    // Eine Unterscheidung zwischen "gibt es nicht" und "nicht
    // freigegeben" verrät, welche Mandanten existieren.
    const faelle = [...route.matchAll(/status: 403/g)];
    assert.ok(faelle.length >= 1);
    assert.match(route, /Dieser Mandant steht dir nicht offen\./);
  });
});

describe("Einen weiteren Mandanten anlegen", () => {
  const sql = readFileSync(
    new URL("../../db/035_benutzer_zugang.sql", import.meta.url),
    "utf8",
  );
  const route = readFileSync(
    new URL("../app/api/mandant/route.ts", import.meta.url),
    "utf8",
  );

  test("die Rechteprüfung steht in der Funktion, nicht nur in der Route", () => {
    // Die Funktion verteilt Zugriff und läuft unter dem Eigentümer.
    // Stünde die Prüfung nur in der Route, wäre sie offen für jeden, der
    // die Funktion aufrufen kann.
    const fn = sql.slice(sql.indexOf("FUNCTION mandant_anlegen"));
    assert.match(fn, /AND b\.rolle = 'verwalter'/);
    assert.match(fn, /IF v_benutzer IS NULL THEN\s*\n\s*RAISE EXCEPTION 'nicht berechtigt'/);
  });

  test("freigegeben wird genau der prüfende Benutzer", () => {
    // v_benutzer stammt aus der Prüfung oben. Käme hier ein anderer Wert
    // hin, könnte die Anwendung einen fremden Benutzer freigeben.
    const fn = sql.slice(sql.indexOf("FUNCTION mandant_anlegen"));
    assert.match(
      fn,
      /INSERT INTO benutzer_zugang \(benutzer_id, ziel_mandant_id, rolle\)\s*\n\s*VALUES \(v_benutzer, v_neu, 'verwalter'\)/,
    );
  });

  test("Name und Heimatmandant kommen aus der Sitzung", () => {
    // Nicht aus der Anfrage -- sonst gäbe sich jemand als ein anderer aus.
    assert.match(route, /sitzung\.name,\s*\n?\s*heimat/);
    assert.match(route, /const heimat = sitzung\.heimat \?\? sitzung\.mandant;/);
    assert.ok(
      !/b\.benutzer|b\.heimat|body\.benutzer/.test(route),
      "die Route liest Benutzer oder Heimat aus der Anfrage",
    );
  });

  test("nur ein Verwalter darf anlegen", () => {
    assert.match(route, /sitzung\.rolle !== "verwalter"/);
  });

  test("das Kürzel wird geprüft, es landet in Adressen", () => {
    assert.match(route, /\^\[a-z0-9\]\[a-z0-9-\]\{1,23\}\$/);
  });
});

describe("Der Umschalter in der Kopfzeile", () => {
  const wahl = readFileSync(
    new URL("../components/MandantWahl.tsx", import.meta.url),
    "utf8",
  );
  const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");

  test("mit nur einem Mandanten bleibt die Kopfzeile, was sie war", () => {
    // Ein Umschalter mit einem Eintrag ist eine Frage ohne Antwort.
    assert.match(wahl, /zugaenge\.length < 2/);
  });

  test("der aktive Mandant steht in der Kopfzeile", () => {
    assert.match(layout, /<MandantWahl/);
    assert.match(layout, /zugaenge\.find\(\(z\) => z\.mandant === sitzung\?\.mandant\)/);
  });

  test("nach dem Wechsel wird alles neu geladen", () => {
    // router.refresh() genügt nicht: Die Zwischenspeicher des Routers
    // halten Seiten des alten Mandanten.
    assert.match(wahl, /window\.location\.assign/);
  });

  test("das Auswahlfeld hat eine Beschriftung", () => {
    // Ohne sie heisst es in der Vorlesesoftware nur "Auswahlfeld".
    assert.match(wahl, /htmlFor="mandantwahl"/);
    assert.match(wahl, /id="mandantwahl"/);
  });
});
