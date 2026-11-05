import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { angemeldeteSitzung } from "@/lib/anmeldung";
import { query } from "@/lib/db";
import { lieseBeleg } from "@/lib/belegtext";
import { werteBelegAus } from "@/lib/belege";
import { uebernehmeSichereBelege } from "@/lib/belegabgleich";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Abgelegte Belege mit dem heutigen Regelwerk neu lesen.
 *
 * WOFÜR
 *
 * Das Regelwerk wird besser. Am 05.11.2026 lernte es zweierlei: dass
 * das Rechnungsdatum vor dem Bestelldatum geht (30 von 100
 * Amazon-Belegen lagen mit dem Bestelldatum in den Büchern), und dass
 * mehrere Rechnungen in einer Datei zusammenzuzählen sind (7 Dateien,
 * deren Summe auf den Cent der Abbuchung entsprach).
 *
 * Belege, die vorher eingeliefert wurden, tragen die alten Zahlen. Eine
 * Verbesserung am Leser nützt nichts, wenn sie nur für künftige Belege
 * gilt -- dieser Lauf holt den Bestand nach.
 *
 * ERST ZEIGEN, DANN ÄNDERN
 *
 * Ohne `uebernehmen: true` wird nichts geschrieben. Die Antwort zeigt,
 * was sich ändern würde. Ein Lauf, der ungefragt 300 Beträge in den
 * Büchern verschiebt, ist kein Werkzeug, sondern ein Unfall.
 *
 * WAS ER NIE ANFASST
 *
 * Belege, die schon einer Buchung zugeordnet sind (belegbuchung). Deren
 * Betrag zu ändern würde eine festgeschriebene Zuordnung von hinten
 * verbiegen -- die Zuordnung stimmte für den alten Betrag. Solche Fälle
 * werden gezählt und benannt, nicht geändert.
 *
 * Und er ändert nur Betrag und Datum. Kostenart, Objekt,
 * Umlagefähigkeit können von Hand gesetzt worden sein; ein
 * maschineller Lauf überschreibt keine menschliche Entscheidung.
 */
interface Wunsch {
  uebernehmen?: unknown;
  lieferung_id?: unknown;
}

export async function POST(anfrage: Request) {
  const sitzung = await angemeldeteSitzung();
  if (!sitzung || sitzung.rolle === "mieter" || sitzung.rolle === "lesen") {
    return NextResponse.json({ fehler: "nicht berechtigt" }, { status: 403 });
  }

  let wunsch: Wunsch = {};
  try {
    const roh = await anfrage.json();
    if (roh && typeof roh === "object") wunsch = roh as Wunsch;
  } catch {
    // Kein Körper ist in Ordnung: dann ist es ein Probelauf über alles.
  }
  const uebernehmen = wunsch.uebernehmen === true;
  const nurLieferung =
    typeof wunsch.lieferung_id === "string" && /^[0-9a-f-]{36}$/i.test(wunsch.lieferung_id)
      ? wunsch.lieferung_id
      : null;

  const belege = await query<{
    id: string;
    dateiname: string | null;
    ablage_pfad: string;
    betrag_brutto: string | null;
    belegdatum: string | null;
    notizen: string | null;
    zugeordnet: string;
  }>(
    `SELECT bg.id, bg.dateiname, bg.ablage_pfad, bg.betrag_brutto::text,
            bg.belegdatum::text, bg.notizen,
            (SELECT count(*) FROM belegbuchung bb WHERE bb.beleg_id = bg.id)::text
              AS zugeordnet
       FROM beleg bg
      WHERE bg.ablage_pfad IS NOT NULL
        AND ($1::uuid IS NULL OR bg.lieferung_id = $1::uuid)
      ORDER BY bg.angelegt_am`,
    [nurLieferung],
  );

  const aenderungen: Array<{
    beleg_id: string;
    datei: string | null;
    betrag_alt: number | null;
    betrag_neu: number | null;
    datum_alt: string | null;
    datum_neu: string | null;
  }> = [];
  const gesperrt: Array<{ datei: string | null; grund: string }> = [];
  let gelesen = 0;
  let ohneDatei = 0;
  let ohneTextebene = 0;
  let unveraendert = 0;
  let geschrieben = 0;

  for (const b of belege) {
    let inhalt: Buffer;
    try {
      inhalt = await readFile(b.ablage_pfad);
    } catch {
      ohneDatei += 1;
      continue;
    }
    const d = await lieseBeleg(inhalt);
    gelesen += 1;
    if (!d.text || d.text.trim().length < 40) {
      ohneTextebene += 1;
      continue;
    }
    const neu = werteBelegAus(d.text, b.dateiname ?? undefined);
    const betragAlt = b.betrag_brutto === null ? null : Number(b.betrag_brutto);
    const datumAlt = b.belegdatum;

    const betragAnders =
      neu.betrag_brutto !== null &&
      (betragAlt === null ||
        Math.round(neu.betrag_brutto * 100) !== Math.round(betragAlt * 100));
    const datumAnders = neu.belegdatum !== null && neu.belegdatum !== datumAlt;

    if (!betragAnders && !datumAnders) {
      unveraendert += 1;
      continue;
    }
    if (Number(b.zugeordnet) > 0) {
      gesperrt.push({
        datei: b.dateiname,
        grund:
          "Schon einer Buchung zugeordnet. Die Zuordnung gilt für den " +
          "alten Betrag und wird nicht von hinten verändert.",
      });
      continue;
    }

    aenderungen.push({
      beleg_id: b.id,
      datei: b.dateiname,
      betrag_alt: betragAlt,
      betrag_neu: betragAnders ? neu.betrag_brutto : betragAlt,
      datum_alt: datumAlt,
      datum_neu: datumAnders ? neu.belegdatum : datumAlt,
    });

    if (!uebernehmen) continue;

    const vermerk = [
      betragAnders
        ? `Betrag ${betragAlt === null ? "ohne" : betragAlt.toFixed(2)} -> ${neu.betrag_brutto!.toFixed(2)}`
        : null,
      datumAnders ? `Datum ${datumAlt ?? "ohne"} -> ${neu.belegdatum}` : null,
    ]
      .filter(Boolean)
      .join(", ");

    await query(
      `UPDATE beleg
          SET betrag_brutto = COALESCE($2, betrag_brutto),
              belegdatum    = COALESCE($3::date, belegdatum),
              notizen = COALESCE(notizen || ' ', '') || $4
        WHERE id = $1`,
      [
        b.id,
        betragAnders ? neu.betrag_brutto : null,
        datumAnders ? neu.belegdatum : null,
        `Nachgelesen: ${vermerk}.`,
      ],
    );
    geschrieben += 1;
  }

  const abgleich = geschrieben > 0 ? await uebernehmeSichereBelege() : null;

  return NextResponse.json({
    probelauf: !uebernehmen,
    belege: belege.length,
    gelesen,
    ohne_datei: ohneDatei,
    ohne_textebene: ohneTextebene,
    unveraendert,
    wuerde_sich_aendern: aenderungen.length,
    geschrieben,
    gesperrt: gesperrt.length,
    beispiele_gesperrt: gesperrt.slice(0, 10),
    aenderungen: aenderungen.slice(0, 200),
    abgleich,
  });
}
