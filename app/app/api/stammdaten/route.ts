import { NextResponse } from "next/server";
import { query, one, tx } from "@/lib/db";
import { erzeugeSollstellungen } from "@/lib/sollstellung";
import {
  alsE164,
  pruefeEmail,
  istRelayAdresse,
} from "@/lib/kontaktdaten";

export const dynamic = "force-dynamic";

/**
 * Stammdatenpflege: Mieter samt Mietverhaeltnis anlegen und aendern.
 * Nach jeder Aenderung werden die Sollstellungen nachgezogen, damit der
 * Kontoabgleich sofort etwas zum Pruefen hat.
 */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as {
    aktion?: string;
    kontakt_id?: string;
    mietverhaeltnis_id?: string;
    name?: string;
    email?: string;
    telefon?: string;
    einheit_id?: string;
    beginn?: string;
    ende?: string | null;
    kaltmiete?: number;
    nebenkosten?: number;
    kaution?: number;
    zahlt_im_voraus?: boolean;
    zahlungsnotiz?: string;
    muster?: string;
    // Felder, an denen Mietvertrag und Wohnungsgeberbestaetigung haengen.
    // Sie standen bisher in keiner Aktion -- die Pruefliste benannte den
    // Mangel, und es gab keinen Weg, ihn zu beheben ausser SQL.
    voller_name?: string;
    geburtsdatum?: string;
    geburtsort?: string;
    anschrift_vorher?: string;
    melde_zusatz?: string;
    vertrag_datum?: string;
    moeblierungszuschlag?: number;
    // Kontaktdaten. Bisher liessen sie sich nur beim Anlegen setzen --
    // ein bestehender Mieter bekam weder Nummer noch Adresse, ausser
    // jemand ging mit SQL an die Datenbank.
    email_zweit?: string;
    telefon_zweit?: string;
    whatsapp_ok?: boolean;
  } | null;

  if (!b?.aktion) {
    return NextResponse.json({ fehler: "aktion fehlt" }, { status: 400 });
  }

  try {
    switch (b.aktion) {
      case "mieter_anlegen": {
        if (!b.name?.trim() || !b.einheit_id || !b.beginn) {
          return NextResponse.json(
            { fehler: "Name, Einheit und Mietbeginn sind nötig" },
            { status: 400 },
          );
        }
        const ergebnis = await tx(async (c) => {
          const k = await c.query<{ id: string }>(
            `INSERT INTO kontakt (anzeigename, rolle, telefon)
             VALUES ($1,'mieter',$2) RETURNING id`,
            [b.name!.trim(), b.telefon?.trim() || null],
          );
          if (b.email?.trim()) {
            await c.query(
              // ON CONFLICT nennt (mandant_id, email) und nicht (email).
            //
            // Das ist kein Schoenheitsfehler: db/010 hat die globale
            // Eindeutigkeit auf kontakt_email durch (mandant_id, email)
            // ersetzt -- zwei Vermieter mit demselben Handwerker sind in
            // einer Region der Normalfall. Seitdem fand Postgres fuer
            // "ON CONFLICT (email)" keinen passenden Index mehr und wies
            // die ganze Anweisung ab ("no unique or exclusion constraint
            // matching the ON CONFLICT specification").
            //
            // Die Folge war nicht etwa eine Dublette, sondern: Einen
            // Mieter MIT E-Mail-Adresse anzulegen scheiterte vollstaendig,
            // samt Mietverhaeltnis, weil alles in einer Transaktion
            // laeuft. Ohne Adresse ging es. Ein Fehler, der nur den
            // sorgfaeltigen Benutzer trifft.
            `INSERT INTO kontakt_email (kontakt_id, email, ist_primaer)
               VALUES ($1,$2,true)
               ON CONFLICT (mandant_id, email) DO NOTHING`,
              [k.rows[0].id, b.email.trim().toLowerCase()],
            );
          }
          const mv = await c.query<{ id: string }>(
            `INSERT INTO mietverhaeltnis
               (einheit_id, kontakt_id, beginn, ende, kaltmiete, nebenkosten,
                kaution, zahlt_im_voraus, zahlungsnotiz)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
            [b.einheit_id, k.rows[0].id, b.beginn, b.ende || null,
             b.kaltmiete ?? null, b.nebenkosten ?? null, b.kaution ?? null,
             b.zahlt_im_voraus ?? false, b.zahlungsnotiz?.trim() || null],
          );
          return { kontakt_id: k.rows[0].id, mietverhaeltnis_id: mv.rows[0].id };
        });
        const soll = await erzeugeSollstellungen();
        return NextResponse.json({ ok: true, ...ergebnis, soll });
      }

      case "mietverhaeltnis_aendern": {
        if (!b.mietverhaeltnis_id) {
          return NextResponse.json({ fehler: "mietverhaeltnis_id fehlt" }, { status: 400 });
        }
        await query(
          `UPDATE mietverhaeltnis
              SET ende = COALESCE($2::date, ende),
                  kaltmiete = COALESCE($3::numeric, kaltmiete),
                  nebenkosten = COALESCE($4::numeric, nebenkosten),
                  zahlt_im_voraus = COALESCE($5::boolean, zahlt_im_voraus),
                  zahlungsnotiz = COALESCE($6, zahlungsnotiz)
            WHERE id = $1`,
          [b.mietverhaeltnis_id, b.ende ?? null, b.kaltmiete ?? null,
           b.nebenkosten ?? null, b.zahlt_im_voraus ?? null,
           b.zahlungsnotiz?.trim() || null],
        );
        const soll = await erzeugeSollstellungen();
        return NextResponse.json({ ok: true, soll });
      }

      /**
       * Die Felder, ohne die Mietvertrag und Wohnungsgeberbestaetigung
       * nicht gedruckt werden koennen.
       *
       * Eigene Aktion statt einer Erweiterung von mietverhaeltnis_aendern:
       * Die aendert Geld und Laufzeit. Sieben der acht Felder hier
       * beruehren das Geld nicht -- ein Lauf ueber alle Sollstellungen
       * waere dann nur Last ohne Wirkung.
       *
       * Eine Ausnahme gibt es, und sie war in der ersten Fassung dieser
       * Aktion uebersehen: Der Moeblierungszuschlag geht ueber
       * summePosten() in die gestellte Soll ein, solange keine
       * gesamtmiete vereinbart ist. Wer nur ihn aendert, haette ihn
       * sonst in den Stammdaten stehen, und keine Forderung kennt ihn --
       * genau der Fehler, den fehlendeFelder() schon einmal benennt
       * ("in der Sollstellung fehlt er dann jeden Monat"). Deshalb hier
       * derselbe Nachlauf wie bei mietverhaeltnis_aendern, aber nur wenn
       * der Zuschlag dabei war.
       *
       * COALESCE wie dort: Ein nicht geschicktes Feld bleibt unveraendert.
       * Leeren geht ueber diesen Weg also nicht; das ist gewollt, weil ein
       * versehentlich leeres Formularfeld sonst einen gepflegten Wert
       * loeschen koennte.
       */
      case "vertragsdaten_aendern": {
        if (!b.mietverhaeltnis_id) {
          return NextResponse.json(
            { fehler: "mietverhaeltnis_id fehlt" },
            { status: 400 },
          );
        }
        const mv = await one<{ kontakt_id: string }>(
          `SELECT kontakt_id::text FROM mietverhaeltnis WHERE id = $1`,
          [b.mietverhaeltnis_id],
        );
        if (!mv) {
          return NextResponse.json(
            { fehler: "Mietverhältnis unbekannt" },
            { status: 404 },
          );
        }
        await tx(async (c) => {
          await c.query(
            `UPDATE mietverhaeltnis
                SET anschrift_vorher    = COALESCE($2, anschrift_vorher),
                    melde_zusatz        = COALESCE($3, melde_zusatz),
                    vertrag_datum       = COALESCE($4::date, vertrag_datum),
                    moeblierungszuschlag= COALESCE($5::numeric, moeblierungszuschlag),
                    kaution             = COALESCE($6::numeric, kaution)
              WHERE id = $1`,
            [
              b.mietverhaeltnis_id,
              b.anschrift_vorher?.trim() || null,
              b.melde_zusatz?.trim() || null,
              b.vertrag_datum || null,
              b.moeblierungszuschlag ?? null,
              b.kaution ?? null,
            ],
          );
          // Passname, Geburtsdatum und Geburtsort haengen am Kontakt, nicht
          // am Mietverhaeltnis -- derselbe Mensch kann mehrere haben.
          await c.query(
            `UPDATE kontakt
                SET anzeigename  = COALESCE($2, anzeigename),
                    geburtsdatum = COALESCE($3::date, geburtsdatum),
                    geburtsort   = COALESCE($4, geburtsort)
              WHERE id = $1`,
            [
              mv.kontakt_id,
              b.voller_name?.trim() || null,
              b.geburtsdatum || null,
              b.geburtsort?.trim() || null,
            ],
          );
        });
        const zuschlagGeaendert = b.moeblierungszuschlag !== undefined
          && b.moeblierungszuschlag !== null;
        const soll = zuschlagGeaendert ? await erzeugeSollstellungen() : null;
        return NextResponse.json({ ok: true, soll });
      }

      /**
       * Telefon und E-Mail eines BESTEHENDEN Kontakts.
       *
       * Eigene Aktion, aus zwei Gruenden. Erstens beruehrt sie kein Geld
       * und keine Laufzeit -- ein Lauf ueber alle Sollstellungen waere
       * nur Last ohne Wirkung. Zweitens ist sie die einzige Stelle, an
       * der Kontaktdaten zusammenlaufen: Nummern und Adressen stammen aus
       * Vertraegen, Telefonbuechern und Kontaktlisten und sind dort in
       * jeder denkbaren Schreibweise notiert. Vereinheitlicht wird einmal,
       * hier, ueber lib/kontaktdaten.ts.
       *
       * Was NICHT gespeichert wird:
       *
       *  - eine Nummer, die sich nicht sicher deuten laesst. "176 72843960"
       *    koennte Inland ohne 0 oder Ausland ohne + sein; eine geratene
       *    Vorwahl ergibt eine Nummer, die es gibt, nur nicht die des
       *    Mieters.
       *  - eine Relayadresse von WG-Gesucht oder Kleinanzeigen. Die sieht
       *    aus wie eine Adresse, wird aber abgeschaltet -- eine Mahnung
       *    darueber kommt nie an, und niemand erfaehrt es.
       *
       * Beides wird abgewiesen und benannt, nicht stillschweigend
       * uebergangen: Wer eine Nummer eintippt und keine Fehlermeldung
       * bekommt, glaubt sie stehe drin.
       */
      case "kontaktdaten_aendern": {
        const ziel = b.kontakt_id
          ? { kontakt_id: b.kontakt_id }
          : b.mietverhaeltnis_id
            ? await one<{ kontakt_id: string }>(
                `SELECT kontakt_id::text FROM mietverhaeltnis WHERE id = $1`,
                [b.mietverhaeltnis_id],
              )
            : null;
        if (!ziel) {
          return NextResponse.json(
            { fehler: "kontakt_id oder mietverhaeltnis_id nötig" },
            { status: b.mietverhaeltnis_id ? 404 : 400 },
          );
        }

        const abgewiesen: string[] = [];
        const uebernommen: string[] = [];

        const nummern: Array<{ roh: string; primaer: boolean }> = [];
        for (const [roh, primaer] of [
          [b.telefon, true],
          [b.telefon_zweit, false],
        ] as Array<[string | undefined, boolean]>) {
          if (!roh?.trim()) continue;
          const e164 = alsE164(roh);
          if (!e164) {
            abgewiesen.push(
              `Telefonnummer „${roh.trim()}" ist nicht eindeutig zu deuten — ` +
                `bitte mit Vorwahl schreiben (0176… oder +49176…).`,
            );
            continue;
          }
          nummern.push({ roh: e164, primaer });
        }

        const adressen: Array<{ wert: string; primaer: boolean }> = [];
        for (const [roh, primaer] of [
          [b.email, true],
          [b.email_zweit, false],
        ] as Array<[string | undefined, boolean]>) {
          if (!roh?.trim()) continue;
          const adresse = pruefeEmail(roh);
          if (!adresse) {
            abgewiesen.push(`„${roh.trim()}" ist keine gültige E-Mail-Adresse.`);
            continue;
          }
          if (istRelayAdresse(adresse)) {
            abgewiesen.push(
              `„${adresse}" ist eine Weiterleitungsadresse eines Portals. ` +
                `Sie wird abgeschaltet; eine Mahnung darüber käme nie an.`,
            );
            continue;
          }
          adressen.push({ wert: adresse, primaer });
        }

        await tx(async (c) => {
          const ersteNummer = nummern.find((n) => n.primaer) ?? nummern[0];
          if (ersteNummer) {
            // kontakt.telefon ist die Nummer fuer den Menschen am
            // Bildschirm; kontakt_telefon die fuer die Zuordnung
            // eingehender Nachrichten. Beide, sonst laufen sie auseinander.
            await c.query(`UPDATE kontakt SET telefon = $2 WHERE id = $1`, [
              ziel.kontakt_id,
              ersteNummer.roh,
            ]);
            uebernommen.push("telefon");
          }
          for (const n of nummern) {
            await c.query(
              `INSERT INTO kontakt_telefon (kontakt_id, nummer_e164, whatsapp_ok)
               VALUES ($1,$2,$3)
               ON CONFLICT (mandant_id, nummer_e164) DO UPDATE
                 SET whatsapp_ok = kontakt_telefon.whatsapp_ok OR EXCLUDED.whatsapp_ok`,
              [ziel.kontakt_id, n.roh, b.whatsapp_ok ?? false],
            );
          }
          for (const a of adressen) {
            await c.query(
              `INSERT INTO kontakt_email (kontakt_id, email, ist_primaer)
               VALUES ($1,$2,$3)
               ON CONFLICT (mandant_id, email) DO UPDATE
                 SET kontakt_id = EXCLUDED.kontakt_id`,
              [ziel.kontakt_id, a.wert, a.primaer],
            );
            uebernommen.push(a.primaer ? "email" : "email_zweit");
          }
        });

        return NextResponse.json({
          ok: true,
          kontakt_id: ziel.kontakt_id,
          uebernommen,
          // Abgewiesenes steht im Ergebnis und nicht nur im Log. Eine
          // Nummer, die lautlos verschwindet, ist schlimmer als eine
          // Fehlermeldung -- der Benutzer glaubt sonst, sie stehe drin.
          abgewiesen,
        });
      }

      case "zahlerkennung_anlegen": {
        if (!b.kontakt_id || !b.muster?.trim()) {
          return NextResponse.json(
            { fehler: "kontakt_id und muster sind nötig" },
            { status: 400 },
          );
        }
        const k = await one(`SELECT id FROM kontakt WHERE id = $1`, [b.kontakt_id]);
        if (!k) return NextResponse.json({ fehler: "Kontakt unbekannt" }, { status: 404 });
        await query(
          `INSERT INTO zahlerkennung (kontakt_id, muster, feld, notizen)
           VALUES ($1,$2,'beide',$3)
           ON CONFLICT (kontakt_id, muster) DO NOTHING`,
          [b.kontakt_id, b.muster.trim(), "Von Hand eingetragen."],
        );
        return NextResponse.json({ ok: true });
      }

      default:
        return NextResponse.json({ fehler: `Aktion "${b.aktion}" unbekannt` }, { status: 400 });
    }
  } catch (e) {
    console.error("[stammdaten]", e);
    return NextResponse.json({ fehler: (e as Error).message }, { status: 500 });
  }
}
