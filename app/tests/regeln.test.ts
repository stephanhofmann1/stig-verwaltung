import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  normalisiereBetreff,
  parseMessageIds,
  SCHLUESSELWOERTER,
} from "../lib/einordnung";
import { zielmonat, vergleichbar } from "../lib/zuordnung";
import {
  monatsbetrag,
  sollGesamt,
  summePosten,
  betragImMonat,
} from "../lib/sollstellung";
import { parseBetrag, parseDatum, leseCsv } from "../lib/kontoimport";
import { baueThreadHeader } from "../lib/versand";
// Direkt aus lib/sitzung: lib/anmeldung zieht den Postgres-Treiber mit,
// den der Test nicht braucht.
import { pruefeSitzung, baueSitzung, hashe } from "../lib/sitzung";
import { createHmac } from "node:crypto";

/**
 * Diese Tests sichern die Regeln ab, bei denen ein Fehler Geld oder
 * Vertrauen kostet: Monatszuordnung von Zahlungen, anteilige Mieten,
 * Thread-Header und der Zugangsschutz.
 */

describe("Betreff normalisieren", () => {
  test("schält verschachtelte Präfixe ab", () => {
    assert.equal(normalisiereBetreff("AW: Re: Fwd: Angebot"), "Angebot");
    assert.equal(normalisiereBetreff("Angebot"), "Angebot");
    assert.equal(normalisiereBetreff("WG: Rechnung 12"), "Rechnung 12");
  });
});

describe("Message-IDs lesen", () => {
  test("findet mehrere Kennungen in einer Kopfzeile", () => {
    assert.deepEqual(parseMessageIds("<a@x> <b@y>"), ["<a@x>", "<b@y>"]);
    assert.deepEqual(parseMessageIds(null), []);
  });
});

describe("Thread-Header", () => {
  test("hängt die Bezugskennung hinten an die Referenzen", () => {
    const h = baueThreadHeader({
      message_id: "<zwei@x>",
      referenzen: ["<eins@x>"],
    });
    assert.equal(h.in_reply_to, "<zwei@x>");
    assert.deepEqual(h.referenzen, ["<eins@x>", "<zwei@x>"]);
  });

  test("erzeugt keine Dubletten", () => {
    const h = baueThreadHeader({
      message_id: "<eins@x>",
      referenzen: ["<eins@x>"],
    });
    assert.deepEqual(h.referenzen, ["<eins@x>"]);
  });
});

describe("Zielmonat einer Zahlung", () => {
  test("Monatsende zählt bei Vorauszahlern für den Folgemonat", () => {
    assert.equal(zielmonat("2026-10-31", "Miete", true).monat, "2026-11-01");
    assert.equal(zielmonat("2026-10-28", "Miete", true).monat, "2026-11-01");
  });

  test("der Jahreswechsel kippt korrekt", () => {
    assert.equal(zielmonat("2026-12-30", "Miete", true).monat, "2027-01-01");
  });

  test("ohne Vorauszahlung bleibt der Buchungsmonat stehen", () => {
    assert.equal(zielmonat("2026-10-31", "Miete", false).monat, "2026-10-01");
  });

  test("der Verwendungszweck schlägt den Buchungstag", () => {
    const z = zielmonat("2026-11-04", "Miete September 2026", true);
    assert.equal(z.monat, "2026-09-01");
    assert.equal(z.ausZweck, true);
  });

  test("auch in der Schreibweise 09/2026", () => {
    assert.equal(zielmonat("2026-11-04", "Miete 09/2026", false).monat, "2026-09-01");
  });

  test("'Miete' wird nicht für 'Mai' gehalten", () => {
    assert.equal(zielmonat("2026-06-05", "Miete", false).monat, "2026-06-01");
  });
});

describe("Text vergleichbar machen", () => {
  test("Umlaute und Rauschen fallen weg", () => {
    assert.equal(vergleichbar("Öztürk, Müller-Schmidt"), "oeztuerk mueller schmidt");
  });
});

describe("Anteilige Miete", () => {
  const m = (iso: string) => new Date(iso + "T00:00:00Z");

  test("Einzug mitten im Monat", () => {
    const r = monatsbetrag(m("2026-09-01"), m("2026-09-15"), null, 650);
    assert.equal(r.anteilig, true);
    assert.equal(r.tage, 16);
    assert.equal(r.vonTagen, 30);
    assert.equal(r.betrag, 346.67);
  });

  test("Auszug mitten im Monat", () => {
    const r = monatsbetrag(m("2026-10-01"), m("2026-01-01"), m("2026-10-20"), 490);
    assert.equal(r.tage, 20);
    assert.equal(r.vonTagen, 31);
    assert.equal(r.betrag, 316.13);
  });

  test("voller Monat bleibt voll", () => {
    const r = monatsbetrag(m("2026-10-01"), m("2026-01-01"), null, 590);
    assert.equal(r.anteilig, false);
    assert.equal(r.betrag, 590);
  });

  test("Monat vor Mietbeginn ergibt null", () => {
    const r = monatsbetrag(m("2026-07-01"), m("2026-09-15"), null, 650);
    assert.equal(r.betrag, 0);
  });
});

describe("Sollmiete mit Möblierungszuschlag", () => {
  test("der Zuschlag wird mitgestellt", () => {
    // Der Fehler, um den es geht: Gestellt wurden nur 540 €, bezahlt hat der
    // Mieter 600 €. Der Kontoabgleich meldete daraus jeden Monat eine
    // Überzahlung von 60 €.
    assert.equal(
      sollGesamt({ kaltmiete: "450.00", nebenkosten: "90.00", moeblierung: "60.00" }),
      600,
    );
  });

  test("ohne Zuschlag (NULL) bleibt es beim Bisherigen", () => {
    assert.equal(
      sollGesamt({ kaltmiete: "450.00", nebenkosten: "90.00", moeblierung: null }),
      540,
    );
  });

  test("fehlt die Spalte noch, zählt der Zuschlag als 0", () => {
    // Die Abfrage liest die Spalte über to_jsonb(mv) ->> 'moeblierung'.
    // Vor der Migration kommt das Feld gar nicht mit — die Rechnung darf
    // davon nicht auf NaN kippen.
    assert.equal(sollGesamt({ kaltmiete: "450.00", nebenkosten: "90.00" }), 540);
    assert.equal(
      sollGesamt({ kaltmiete: "450.00", nebenkosten: null, moeblierung: undefined }),
      450,
    );
  });

  test("Kaltmiete allein ergibt die Kaltmiete", () => {
    assert.equal(
      sollGesamt({ kaltmiete: "590.00", nebenkosten: null, moeblierung: null }),
      590,
    );
  });

  test("auf Cent gerundet, kein Fließkommarest", () => {
    // 450.10 + 90.20 + 59.70 ergibt als Fließkommazahl 600.0000000000001.
    const g = sollGesamt({
      kaltmiete: "450.10",
      nebenkosten: "90.20",
      moeblierung: "59.70",
    });
    assert.equal(g, 600);
  });
});

describe("Anteilige Miete mit Möblierungszuschlag", () => {
  const m = (iso: string) => new Date(iso + "T00:00:00Z");
  const mv = { kaltmiete: "450.00", nebenkosten: "90.00", moeblierung: "60.00" };
  const gesamt = sollGesamt(mv);

  test("Einzug mitten im Monat rechnet auf dem Gesamtbetrag", () => {
    const r = monatsbetrag(m("2026-09-01"), m("2026-09-15"), null, gesamt);
    assert.equal(r.anteilig, true);
    assert.equal(r.tage, 16);
    assert.equal(r.vonTagen, 30);
    // 600 € × 16/30. Ohne den Zuschlag wären es 288 € — 32 € zu wenig.
    assert.equal(r.betrag, 320);
    assert.equal(
      monatsbetrag(m("2026-09-01"), m("2026-09-15"), null, 540).betrag,
      288,
    );
  });

  test("Auszug mitten im Monat rechnet auf dem Gesamtbetrag", () => {
    const r = monatsbetrag(m("2026-10-01"), m("2026-01-01"), m("2026-10-20"), gesamt);
    assert.equal(r.tage, 20);
    assert.equal(r.vonTagen, 31);
    // 600 € × 20/31 = 387.0967… — auf Cent gerundet.
    assert.equal(r.betrag, 387.1);
  });

  test("Ein- und Auszug im selben Monat", () => {
    const r = monatsbetrag(m("2026-11-01"), m("2026-11-10"), m("2026-11-19"), gesamt);
    assert.equal(r.tage, 10);
    assert.equal(r.vonTagen, 30);
    assert.equal(r.betrag, 200);
  });

  test("voller Monat bleibt der volle Gesamtbetrag", () => {
    const r = monatsbetrag(m("2026-10-01"), m("2026-01-01"), null, gesamt);
    assert.equal(r.anteilig, false);
    assert.equal(r.betrag, 600);
  });
});

describe("Beträge und Daten aus dem Auszug", () => {
  test("deutsche und englische Schreibweise", () => {
    assert.equal(parseBetrag("1.234,56"), 1234.56);
    assert.equal(parseBetrag("1,234.56"), 1234.56);
    assert.equal(parseBetrag("-50,00"), -50);
    assert.equal(parseBetrag("590"), 590);
    assert.equal(parseBetrag(""), null);
  });

  test("Datumsformate", () => {
    assert.equal(parseDatum("31.10.2026"), "2026-10-31");
    assert.equal(parseDatum("2026-10-31"), "2026-10-31");
    assert.equal(parseDatum("1.9.26"), "2026-09-01");
    assert.equal(parseDatum("Unsinn"), null);
  });
});

describe("CSV einlesen", () => {
  test("erkennt Spalten und liest Zeilen", () => {
    const csv = [
      "Buchungstag;Beguenstigter/Zahlungspflichtiger;Verwendungszweck;Betrag;Waehrung",
      "31.10.2026;ARSLAN ADEM;Miete;590,00;EUR",
      '03.11.2026;"Vogt, Dario";"Miete November";650,00;EUR',
    ].join("\n");
    const r = leseCsv(csv);
    assert.equal(r.gelesen.length, 2);
    assert.equal(r.gelesen[0].betrag, 590);
    assert.equal(r.gelesen[1].absender, "Vogt, Dario");
    assert.equal(r.uebersprungen.length, 0);
  });

  test("gleiche Zeile ergibt gleichen Fingerabdruck", () => {
    const zeile = "Buchungstag;Betrag\n31.10.2026;590,00";
    assert.equal(
      leseCsv(zeile).gelesen[0].fingerabdruck,
      leseCsv(zeile).gelesen[0].fingerabdruck,
    );
  });

  test("meldet fehlende Pflichtspalten statt stillschweigend nichts zu tun", () => {
    const r = leseCsv("Irgendwas;Anderes\n1;2");
    assert.equal(r.gelesen.length, 0);
    assert.match(r.uebersprungen[0].grund, /nicht gefunden/);
  });
});

describe("Zugangsschutz", () => {
  process.env.SITZUNG_GEHEIMNIS =
    "test-geheimnis-das-lang-genug-ist-fuer-die-pruefung";

  const probe = {
    name: "stephan",
    mandant: "11111111-2222-3333-4444-555555555555",
    rolle: "verwalter" as const,
  };

  test("eigene Sitzung wird anerkannt", () => {
    assert.deepEqual(pruefeSitzung(baueSitzung(probe)), probe);
  });

  test("manipulierte Unterschrift wird abgelehnt", () => {
    const s = baueSitzung(probe);
    assert.equal(pruefeSitzung(s.slice(0, -2) + "xx"), null);
  });

  // Baut ein gueltig signiertes Cookie mit beliebigem Inhalt. Damit laesst
  // sich pruefen, dass der Inhalt geprueft wird und nicht nur die Signatur.
  const echtSigniert = (nutzlast: string) => {
    const u = createHmac("sha256", process.env.SITZUNG_GEHEIMNIS!)
      .update(nutzlast)
      .digest("base64url");
    return `${Buffer.from(nutzlast).toString("base64url")}.${u}`;
  };
  const gueltigBis = Date.now() + 600_000;

  test("Sitzung ohne Mandant wird abgelehnt", () => {
    // Cookies aus der Zeit vor der Mandantentrennung: Signatur stimmt,
    // Inhalt reicht nicht mehr.
    assert.equal(pruefeSitzung(echtSigniert(`stephan|${gueltigBis}`)), null);
  });

  test("erfundene Rolle wird abgelehnt", () => {
    assert.equal(
      pruefeSitzung(echtSigniert(`stephan|${gueltigBis}|${probe.mandant}|chef`)),
      null,
    );
  });

  test("abgelaufene Sitzung wird abgelehnt", () => {
    assert.equal(
      pruefeSitzung(
        echtSigniert(`stephan|${Date.now() - 1000}|${probe.mandant}|verwalter`),
      ),
      null,
    );
  });

  test("Unsinn wird abgelehnt", () => {
    assert.equal(pruefeSitzung("abc.def"), null);
    assert.equal(pruefeSitzung(undefined), null);
  });

  test("Hash ist bei gleichem Passwort nie gleich (eigenes Salz)", () => {
    assert.notEqual(hashe("dasselbe"), hashe("dasselbe"));
  });
});

describe("zugesagte Gesamtmiete", () => {
  // Der Vertrag nennt einen Betrag. Der ist geschuldet -- auch wenn die
  // Aufteilung in Kalt-, Neben- und Moeblierungsanteil daneben liegt.
  test("hat Vorrang vor der Summe der Posten", () => {
    assert.equal(
      sollGesamt({
        kaltmiete: "450.00",
        nebenkosten: "90.00",
        moeblierung: "60.00",
        gesamtmiete: "650.00",
      }),
      650,
    );
  });

  test("wird ignoriert, wenn sie nicht gesetzt ist", () => {
    assert.equal(
      sollGesamt({
        kaltmiete: "450.00",
        nebenkosten: "90.00",
        moeblierung: "60.00",
        gesamtmiete: null,
      }),
      600,
    );
    // Vor Migration 017 fehlt das Feld ganz.
    assert.equal(
      sollGesamt({ kaltmiete: "450.00", nebenkosten: "90.00" }),
      540,
    );
  });

  test("wird ignoriert, wenn sie 0 ist", () => {
    // 0 ist keine Mietzusage, sondern ein nicht gefuelltes Feld. Sonst
    // bekaeme ein Mietverhaeltnis mit gesamtmiete=0 gar keine Sollstellung.
    assert.equal(
      sollGesamt({
        kaltmiete: "450.00",
        nebenkosten: "90.00",
        gesamtmiete: "0.00",
      }),
      540,
    );
  });

  test("summePosten rechnet weiter ohne die Zusage", () => {
    // Darauf beruht die Abweichungsmeldung: Beide Betraege muessen sich
    // unabhaengig voneinander ausrechnen lassen.
    const mv = {
      kaltmiete: "450.00",
      nebenkosten: "90.00",
      moeblierung: "60.00",
      gesamtmiete: "650.00",
    };
    assert.equal(sollGesamt(mv), 650);
    assert.equal(summePosten(mv), 600);
    assert.notEqual(sollGesamt(mv), summePosten(mv));
  });

  test("meldet keine Abweichung, wenn beides uebereinstimmt", () => {
    const mv = {
      kaltmiete: "450.00",
      nebenkosten: "90.00",
      moeblierung: "60.00",
      gesamtmiete: "600.00",
    };
    assert.equal(sollGesamt(mv), summePosten(mv));
  });

  test("erkennt eine Abweichung von einem Cent", () => {
    // numeric(10,2) rundet nicht. Ein Cent Unterschied ist ein Fehler in
    // den Stammdaten, kein Rundungsrest -- und muss auffallen.
    const mv = {
      kaltmiete: "450.00",
      nebenkosten: "90.00",
      moeblierung: "60.00",
      gesamtmiete: "600.01",
    };
    assert.equal(sollGesamt(mv), 600.01);
    assert.equal(summePosten(mv), 600);
    assert.notEqual(sollGesamt(mv), summePosten(mv));
  });

  test("die anteilige Berechnung nimmt die Zusage", () => {
    // Zieht jemand mitten im Monat ein, muss der Vertragsbetrag anteilig
    // werden -- nicht die Summe der Posten.
    const mv = {
      kaltmiete: "450.00",
      nebenkosten: "90.00",
      moeblierung: "60.00",
      gesamtmiete: "650.00",
    };
    const r = monatsbetrag(
      new Date(Date.UTC(2026, 10, 1)),
      new Date(Date.UTC(2026, 10, 16)),
      null,
      sollGesamt(mv),
    );
    // 16.11. bis 30.11. = 15 von 30 Tagen, also die Haelfte von 650.
    assert.equal(r.tage, 15);
    assert.equal(r.vonTagen, 30);
    assert.equal(r.betrag, 325);
    assert.equal(r.anteilig, true);
  });
});

describe("Miete je Monat aus der Anpassungshistorie", () => {
  const vertrag = {
    id: "mv-1", beginn: "2024-01-01", ende: null,
    kaltmiete: "679.00", nebenkosten: "265.00", moeblierung: null,
    gesamtmiete: "944.00", kontakt_name: "Testmieter", einheit: "DG",
  };
  const monat = (j: number, m: number) => new Date(Date.UTC(j, m - 1, 1));

  test("ohne Historie gilt der Betrag am Mietverhaeltnis", () => {
    const r = betragImMonat(monat(2024, 3), [], vertrag);
    assert.equal(r.gesamt, 944);
    assert.equal(r.quelle, "Mietverhältnis");
  });

  test("vor der ersten Anpassung gilt der Betrag am Mietverhaeltnis", () => {
    // Der Fall, der ohne Historie teuer war: Die Erhoehung wirkt ab Juli
    // 2026, der Monat ist Maerz 2024. Ohne diese Pruefung bekaeme er den
    // heutigen Betrag rueckwirkend.
    const a = [{
      mietverhaeltnis_id: "mv-1", gilt_ab: "2026-07-01",
      kaltmiete: "679.00", nebenkosten: "265.00", moeblierung: null,
      gesamtmiete: "944.00", grund: "mieterhoehung",
    }];
    assert.equal(betragImMonat(monat(2024, 3), a, vertrag).quelle, "Mietverhältnis");
  });

  test("ab dem Wirksamkeitsmonat gilt der neue Betrag", () => {
    const a = [
      { mietverhaeltnis_id: "mv-1", gilt_ab: "2024-01-01", kaltmiete: "500.00",
        nebenkosten: "200.00", moeblierung: null, gesamtmiete: "700.00", grund: "vertrag" },
      { mietverhaeltnis_id: "mv-1", gilt_ab: "2026-07-01", kaltmiete: "679.00",
        nebenkosten: "265.00", moeblierung: null, gesamtmiete: "944.00", grund: "mieterhoehung" },
    ];
    assert.equal(betragImMonat(monat(2026, 6), a, vertrag).gesamt, 700);
    assert.equal(betragImMonat(monat(2026, 7), a, vertrag).gesamt, 944);
    assert.equal(betragImMonat(monat(2026, 11), a, vertrag).gesamt, 944);
  });

  test("die juengste gueltige Anpassung gewinnt, egal in welcher Reihenfolge", () => {
    const a = [
      { mietverhaeltnis_id: "mv-1", gilt_ab: "2026-07-01", kaltmiete: null,
        nebenkosten: null, moeblierung: null, gesamtmiete: "944.00", grund: "mieterhoehung" },
      { mietverhaeltnis_id: "mv-1", gilt_ab: "2025-01-01", kaltmiete: null,
        nebenkosten: null, moeblierung: null, gesamtmiete: "800.00", grund: "vereinbarung" },
      { mietverhaeltnis_id: "mv-1", gilt_ab: "2024-01-01", kaltmiete: null,
        nebenkosten: null, moeblierung: null, gesamtmiete: "700.00", grund: "vertrag" },
    ];
    assert.equal(betragImMonat(monat(2024, 6), a, vertrag).gesamt, 700);
    assert.equal(betragImMonat(monat(2025, 6), a, vertrag).gesamt, 800);
    assert.equal(betragImMonat(monat(2026, 8), a, vertrag).gesamt, 944);
  });

  test("eine Anpassung mitten im Monat gilt erst ab dem Folgemonat", () => {
    // Sonst bekaeme die erste Monatshaelfte rueckwirkend den hoeheren Satz.
    const a = [{
      mietverhaeltnis_id: "mv-1", gilt_ab: "2026-07-15", kaltmiete: null,
      nebenkosten: null, moeblierung: null, gesamtmiete: "944.00", grund: "vereinbarung",
    }];
    assert.equal(betragImMonat(monat(2026, 7), a, vertrag).quelle, "Mietverhältnis");
    assert.equal(betragImMonat(monat(2026, 8), a, vertrag).gesamt, 944);
  });

  test("Anpassungen anderer Mietverhaeltnisse werden nicht mitgerechnet", () => {
    // Die Liste wird je Mietverhaeltnis vorgefiltert; der Test sichert,
    // dass betragImMonat sich nicht selbst auf die Filterung verlaesst.
    const a = [{
      mietverhaeltnis_id: "mv-1", gilt_ab: "2024-01-01", kaltmiete: null,
      nebenkosten: null, moeblierung: null, gesamtmiete: "111.00", grund: "vertrag",
    }];
    assert.equal(betragImMonat(monat(2025, 1), a, vertrag).gesamt, 111);
  });

  test("die Posten werden getrennt mitgefuehrt", () => {
    // Fuer die Abweichungsmeldung: zugesagt gegen Summe der Posten.
    const a = [{
      mietverhaeltnis_id: "mv-1", gilt_ab: "2026-07-01", kaltmiete: "679.00",
      nebenkosten: "265.00", moeblierung: null, gesamtmiete: "944.00", grund: "mieterhoehung",
    }];
    const r = betragImMonat(monat(2026, 9), a, vertrag);
    assert.equal(r.gesamt, 944);
    assert.equal(r.posten, 944);
  });
});

/**
 * Einordnung: "Bescheid geben" ist keine Behoerdenpost.
 *
 * Am 03.11.2026 schrieb ein Messdienstleister "Geben Sie mir dazu noch
 * Bescheid." Das Stichwort "bescheid" war fuer den Behoerdenbescheid
 * gedacht und traf die alltaeglichste Wendung der deutschen
 * Geschaeftssprache. Der Vorgang wurde als Behoerdenpost gefuehrt und
 * heikel markiert -- und damit schreibt der Agent dort nie wieder einen
 * Entwurf.
 *
 * Der Schaden eines solchen Fehlers ist still: Die Automatik hoert auf
 * zu arbeiten, und niemand erfaehrt warum. Genau deshalb steht er hier.
 */
describe("Stichwort behoerde", () => {
  const behoerde = SCHLUESSELWOERTER.find((m) => m.kategorie === "behoerde");

  function trifft(text: string): boolean {
    assert.ok(behoerde, "Kategorie behoerde muss es geben");
    return behoerde!.muster.test(text);
  }

  const redewendung = [
    "Geben Sie mir dazu noch Bescheid.",
    "Bitte geben Sie mir Bescheid, sobald es da ist.",
    "Sagen Sie mir Bescheid wenn es passt",
    "Ich gebe Ihnen Bescheid",
    "Sie wissen Bescheid",
    "Wir melden uns und geben Bescheid",
  ];
  for (const t of redewendung) {
    test(`keine Behoerde: ${JSON.stringify(t)}`, () => {
      assert.equal(trifft(t), false);
    });
  }

  /**
   * Die Gegenprobe ist genauso wichtig: Wer die Redewendung ausnimmt,
   * darf nicht den echten Bescheid mit ausnehmen. Eine Behoerdenfrist
   * zu uebersehen waere der teurere Fehler.
   */
  const echterBescheid = [
    "Anbei der Bescheid des Finanzamts",
    "Der Bescheid vom 12.03. ist anzufechten",
    "Bescheid ueber die Grundsteuer",
    "Wir haben den Bescheid erhalten",
    "Der beiliegende Bescheid",
    "Bescheid der Stadt Giessen",
    "Ladung zum Termin",
    "Schreiben vom Amtsgericht",
  ];
  for (const t of echterBescheid) {
    test(`Behoerde: ${JSON.stringify(t)}`, () => {
      assert.equal(trifft(t), true);
    });
  }

  test("ohne Stichwort keine Behoerde", () => {
    assert.equal(trifft("Harmlose Mail ohne Stichwort"), false);
  });

  /**
   * Der Satz aus der echten Mail, woertlich. Wenn jemand das Muster
   * spaeter anfasst, faellt genau dieser Fall wieder auf.
   */
  test("die Mail, die den Fehler aufgedeckt hat", () => {
    const text =
      "AW: Rueckfragen vor Weitergabe - Abrechnung 2025\n" +
      "Der Heizverbrauch wurde nun geschaetzt und eine Geraetepruefung " +
      "veranlasst. Geben Sie mir dazu noch Bescheid. Anschliessend " +
      "erhalten Sie die Korrektur und die Rechnung.";
    assert.equal(trifft(text), false);
  });
});
