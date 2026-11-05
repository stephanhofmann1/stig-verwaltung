import { query, tx } from "./db";
import { vergleichbar } from "./zuordnung";
import { stehtDrin } from "./referenzen";

/**
 * Ordnet Abbuchungen den passenden Belegen zu.
 *
 * Reihenfolge der Sicherheit:
 *   0. Eine Referenz des Belegs steht im Zweck    → sicher
 *   1. Belegnummer steht im Verwendungszweck      → sicher
 *   2. Aussteller erkannt und Betrag passt genau  → sicher
 *   3. nur der Betrag passt, genau ein Kandidat   → unsicher
 *   4. alles andere                               → bleibt offen
 *
 * Nichts wird stillschweigend gebucht. Was unsicher ist, landet in der
 * Lückenliste — eine falsche Zuordnung fällt in der Steuererklärung
 * später niemandem mehr auf, und genau das wollen wir vermeiden.
 */

export interface OffeneAusgabe {
  id: string;
  buchungstag: string;
  betrag: string;
  absender: string | null;
  verwendungszweck: string | null;
}

export interface BelegKandidat {
  id: string;
  belegnummer: string | null;
  betrag_brutto: string | null;
  belegdatum: string | null;
  dateiname: string | null;
  aussteller: string | null;
  kontakt_name: string | null;
  vorgang_referenz: string | null;
  offen: string;
}

export interface BelegVorschlag {
  buchung_id: string;
  beleg_id: string | null;
  betrag: number;
  sicherheit: "sicher" | "unsicher";
  begruendung: string;
  beleg_bezeichnung?: string;
  /**
   * Weitere Belege zu DERSELBEN Abbuchung.
   *
   * Eine Amazon-Bestellung kann in mehreren Lieferungen kommen, und jede
   * traegt ihre eigene Rechnung -- abgebucht wird trotzdem einmal, unter
   * der gemeinsamen Bestellnummer. Ein Vorschlag je Abbuchung bliebe
   * dann unvollstaendig, und die Bewegung staende weiter als "teilweise
   * belegt" da.
   *
   * Die Oberflaeche zeigt weiterhin einen Eintrag je Bewegung; beim
   * Festschreiben werden alle gebucht.
   */
  weitere?: Array<{ beleg_id: string; betrag: number }>;
}

/** Abbuchungen ohne (vollständigen) Beleg. */
export async function offeneAusgaben(): Promise<OffeneAusgabe[]> {
  return query<OffeneAusgabe>(`
    SELECT b.id, b.buchungstag::text, b.betrag::text, b.absender,
           b.verwendungszweck
      FROM buchung b
     WHERE b.betrag < 0
       AND b.beleg_nicht_noetig = false
       AND abs(b.betrag) > COALESCE(
             (SELECT sum(bb.betrag) FROM belegbuchung bb
               WHERE bb.buchung_id = b.id), 0)
     ORDER BY b.buchungstag DESC
  `);
}

/** Belege, die noch nicht vollständig durch Zahlungen gedeckt sind. */
export async function offeneBelege(): Promise<BelegKandidat[]> {
  return query<BelegKandidat>(`
    SELECT bg.id, bg.belegnummer, bg.betrag_brutto::text, bg.belegdatum::text,
           bg.dateiname, bg.aussteller,
           k.anzeigename AS kontakt_name, v.referenz AS vorgang_referenz,
           (COALESCE(bg.betrag_brutto,0) - COALESCE(
              (SELECT sum(bb.betrag) FROM belegbuchung bb
                WHERE bb.beleg_id = bg.id), 0))::text AS offen
      FROM beleg bg
      LEFT JOIN kontakt k ON k.id = bg.kontakt_id
      LEFT JOIN vorgang v ON v.id = bg.vorgang_id
     WHERE bg.richtung = 'eingang'
       -- Belege, bei denen die beiden Auswertungen sich über Betrag oder
       -- Datum nicht einig waren (db/033, api/belege/einlieferung), bleiben
       -- hier aussen vor. Sonst würde der selbsttätige Abgleich genau die
       -- Zeilen festschreiben, deren Zahlen zweifelhaft sind -- und ein
       -- bestätigter falscher Treffer ist schlimmer als keiner: Er sieht
       -- wie Arbeit aus, die erledigt ist.
       AND bg.abweichung IS NULL
     ORDER BY bg.belegdatum DESC NULLS LAST
  `);
}

/**
 * Die normierten Referenzen je Beleg.
 *
 * Einmal geladen und als Karte gehalten: Der Abgleich vergleicht jede
 * Abbuchung gegen jeden Beleg, und eine Abfrage je Paar waere bei 500
 * Bewegungen und 230 Belegen 115.000 Abfragen.
 */
async function referenzenJeBeleg(): Promise<Map<string, string[]>> {
  const zeilen = await query<{ beleg_id: string; normiert: string }>(
    `SELECT beleg_id, normiert FROM beleg_referenz`,
  );
  const karte = new Map<string, string[]>();
  for (const z of zeilen) {
    const vorhanden = karte.get(z.beleg_id);
    if (vorhanden) vorhanden.push(z.normiert);
    else karte.set(z.beleg_id, [z.normiert]);
  }
  return karte;
}

function bezeichne(b: BelegKandidat): string {
  const teile = [
    b.aussteller ?? b.kontakt_name ?? "Unbekannt",
    b.belegnummer ?? b.dateiname ?? "ohne Nummer",
  ];
  return teile.join(" · ");
}

export async function schlageBelegeVor(): Promise<BelegVorschlag[]> {
  const ausgaben = await offeneAusgaben();
  const belege = await offeneBelege();
  const referenzen = await referenzenJeBeleg();
  const vorschlaege: BelegVorschlag[] = [];

  for (const a of ausgaben) {
    const betrag = Math.abs(Number(a.betrag));
    const text = vergleichbar(`${a.absender ?? ""} ${a.verwendungszweck ?? ""}`);
    const rohText = `${a.absender ?? ""} ${a.verwendungszweck ?? ""}`.toUpperCase();
    const normierterZweck = `${a.absender ?? ""} ${a.verwendungszweck ?? ""}`;

    // 0. Eine Referenz des Belegs steht im Verwendungszweck.
    //
    // Das ist der verlaesslichste Treffer, den es gibt: Die Nummer hat
    // der Zahlungsempfaenger vergeben, sie steht auf dem Beleg und sie
    // steht in der Abbuchung. Bei Amazon ist das die Bestellnummer
    // ("304-2954807-8841912 Amazon.de ..."), bei Versorgern die
    // Kundennummer, bei der Stadtkasse das Kassenzeichen.
    //
    // Vorher suchte nur Regel 1 nach der BELEGNUMMER -- und die steht in
    // einer Amazon-Abbuchung nie. 162 Abbuchungen und 211 Rechnungen
    // lagen deshalb am 05.11.2026 nebeneinander, ohne einen Treffer.
    const perReferenz = belege.filter(
      (b) =>
        Number(b.offen) > 0.005 &&
        (referenzen.get(b.id) ?? []).some((r) => stehtDrin(r, normierterZweck)),
    );
    if (perReferenz.length === 1) {
      const b = perReferenz[0];
      vorschlaege.push({
        buchung_id: a.id,
        beleg_id: b.id,
        betrag: Math.min(betrag, Number(b.offen)),
        sicherheit: "sicher",
        begruendung: "Referenznummer des Belegs steht im Verwendungszweck.",
        beleg_bezeichnung: bezeichne(b),
      });
      continue;
    }
    if (perReferenz.length > 1) {
      // Mehrere Belege tragen dieselbe Referenz -- eine Bestellung, in
      // Teillieferungen berechnet. Nur wenn ihre offenen Betraege
      // zusammen genau die Abbuchung ergeben, ist das eindeutig.
      const summe = perReferenz.reduce((s, b) => s + Number(b.offen), 0);
      if (Math.abs(summe - betrag) < 0.005) {
        const [erster, ...rest] = perReferenz;
        vorschlaege.push({
          buchung_id: a.id,
          beleg_id: erster.id,
          betrag: Number(erster.offen),
          sicherheit: "sicher",
          begruendung:
            `${perReferenz.length} Belege mit derselben Referenz, zusammen genau ` +
            "der Betrag der Abbuchung (Teillieferungen einer Bestellung).",
          beleg_bezeichnung: bezeichne(erster),
          weitere: rest.map((b) => ({ beleg_id: b.id, betrag: Number(b.offen) })),
        });
        continue;
      }
    }

    // 1. Belegnummer im Verwendungszweck
    const perNummer = belege.filter(
      (b) =>
        b.belegnummer &&
        Number(b.offen) > 0.005 &&
        rohText.replace(/[\s\-\/]/g, "").includes(
          b.belegnummer.replace(/[\s\-\/]/g, ""),
        ),
    );
    if (perNummer.length === 1) {
      const b = perNummer[0];
      vorschlaege.push({
        buchung_id: a.id,
        beleg_id: b.id,
        betrag: Math.min(betrag, Number(b.offen)),
        sicherheit: "sicher",
        begruendung: `Belegnummer ${b.belegnummer} steht im Verwendungszweck.`,
        beleg_bezeichnung: bezeichne(b),
      });
      continue;
    }

    // 2. Aussteller erkannt und Betrag stimmt
    const perName = belege.filter((b) => {
      if (Number(b.offen) <= 0.005) return false;
      const name = vergleichbar(b.aussteller ?? b.kontakt_name ?? "");
      const teile = name.split(" ").filter((t) => t.length >= 4);
      return teile.length > 0 && teile.some((t) => text.includes(t));
    });
    const nameUndBetrag = perName.filter(
      (b) => Math.abs(Number(b.offen) - betrag) < 0.005,
    );
    if (nameUndBetrag.length === 1) {
      const b = nameUndBetrag[0];
      vorschlaege.push({
        buchung_id: a.id,
        beleg_id: b.id,
        betrag,
        sicherheit: "sicher",
        begruendung: "Aussteller erkannt und Betrag stimmt auf den Cent.",
        beleg_bezeichnung: bezeichne(b),
      });
      continue;
    }

    // 3. nur der Betrag
    const nurBetrag = belege.filter(
      (b) => Math.abs(Number(b.offen) - betrag) < 0.005,
    );
    if (nurBetrag.length === 1) {
      const b = nurBetrag[0];
      vorschlaege.push({
        buchung_id: a.id,
        beleg_id: b.id,
        betrag,
        sicherheit: "unsicher",
        begruendung:
          "Nur der Betrag passt. Aussteller und Belegnummer stimmen nicht überein — bitte prüfen.",
        beleg_bezeichnung: bezeichne(b),
      });
      continue;
    }

    vorschlaege.push({
      buchung_id: a.id,
      beleg_id: null,
      betrag,
      sicherheit: "unsicher",
      begruendung:
        nurBetrag.length > 1
          ? `${nurBetrag.length} Belege mit diesem Betrag — nicht eindeutig.`
          : "Kein passender Beleg vorhanden.",
    });
  }

  return vorschlaege;
}

/** Schreibt die sicheren Treffer fest. */
export async function uebernehmeSichereBelege(): Promise<{
  uebernommen: number;
  offen: number;
}> {
  const v = await schlageBelegeVor();
  const sicher = v.filter((x) => x.sicherheit === "sicher" && x.beleg_id);

  let gebucht = 0;
  await tx(async (c) => {
    for (const x of sicher) {
      // Der Haupttreffer und, bei Teillieferungen, die weiteren Belege
      // derselben Bestellung. Ohne sie bliebe die Bewegung als
      // "teilweise belegt" stehen -- und niemand wuesste, was fehlt.
      const alle = [
        { beleg_id: x.beleg_id!, betrag: x.betrag },
        ...(x.weitere ?? []),
      ];
      for (const t of alle) {
        await c.query(
          `INSERT INTO belegbuchung (buchung_id, beleg_id, betrag, sicherheit, begruendung)
           VALUES ($1,$2,$3,'sicher',$4)
           ON CONFLICT (buchung_id, beleg_id) DO NOTHING`,
          [x.buchung_id, t.beleg_id, t.betrag, x.begruendung],
        );
        gebucht += 1;
      }
    }
  });

  return { uebernommen: gebucht, offen: v.length - sicher.length };
}

/**
 * Mieteingänge brauchen keinen Beleg — die Sollstellung ist der Beleg.
 * Ebenso Umbuchungen zwischen eigenen Konten.
 */
export async function markiereOhneBelegpflicht(): Promise<number> {
  const r = await query<{ id: string }>(`
    UPDATE buchung b
       SET beleg_nicht_noetig = true,
           beleg_vermerk = 'Mieteingang, über die Sollstellung belegt.'
     WHERE b.betrag > 0
       AND b.beleg_nicht_noetig = false
       AND EXISTS (SELECT 1 FROM zuordnung z WHERE z.buchung_id = b.id)
    RETURNING b.id
  `);
  return r.length;
}
