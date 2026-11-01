import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { query } from "./db";

/**
 * Belege aus Mailanhängen.
 *
 * Ziel ist, dass später zu jeder Bankbewegung ein Beleg liegt. Die meisten
 * kommen ohnehin per Mail: Handwerkerrechnungen, Versorgerabrechnungen,
 * Bescheide. Sie werden beim Eingang gesichert, damit sie nicht im
 * Postfach versickern.
 *
 * Aus Dateiname und Mailtext werden Rechnungsnummer, Betrag und Datum
 * gelesen, soweit sie dort stehen. Was nicht sicher erkannt wird, bleibt
 * leer — ein falsch gelesener Betrag wäre schlimmer als gar keiner.
 */

export const ABLAGE = process.env.BELEG_ABLAGE ?? "/daten/belege";

const BELEGHAFTE_ENDUNGEN = /\.(pdf|jpe?g|png|tiff?|docx?|xlsx?)$/i;

/** Anhänge, die offensichtlich keine Belege sind. */
const RAUSCHEN =
  /^(image\d+\.(png|jpe?g|gif)|logo\.|signature|smime\.p7s|winmail\.dat)/i;

export function istBelegKandidat(dateiname: string): boolean {
  if (RAUSCHEN.test(dateiname)) return false;
  return BELEGHAFTE_ENDUNGEN.test(dateiname);
}

/** Rechnungsnummer aus Dateiname oder Text. */
export function findeBelegnummer(...texte: string[]): string | null {
  const alles = texte.filter(Boolean).join("\n");
  const muster = [
    /\b(?:rechnungs?-?(?:nr\.?|nummer)|re-?nr\.?)\s*[:.]?\s*([A-Z0-9][A-Z0-9\-\/]{2,24})/i,
    /\b(RE|AB|ANG|GS)[-\s]?(\d{3,8})\b/,
    /\b(\d{4,10}[-\/]\d{2,6})\b/,
  ];
  for (const m of muster) {
    const t = alles.match(m);
    if (t) return (t[2] ? `${t[1]}-${t[2]}` : t[1]).trim().toUpperCase();
  }
  return null;
}

/**
 * Bruttobetrag. Bevorzugt eine Zeile, die ihn ausdrücklich benennt —
 * sonst wird gar nichts zurückgegeben, statt irgendeine Zahl zu raten.
 */
export function findeBetrag(text: string): number | null {
  const muster = [
    /\b(?:gesamt(?:summe|betrag)?|rechnungsbetrag|endbetrag|zu zahlen(?:der betrag)?|brutto)\b[^0-9\-]{0,24}([0-9][0-9.\s]*,[0-9]{2})/i,
    /\b(?:gesamt(?:summe|betrag)?|rechnungsbetrag|endbetrag|zu zahlen|brutto)\b[^0-9\-]{0,24}([0-9][0-9,\s]*\.[0-9]{2})/i,
  ];
  for (const m of muster) {
    const t = text.match(m);
    if (!t) continue;
    const roh = t[1].replace(/\s/g, "");
    const zahl = roh.includes(",")
      ? Number(roh.replace(/\./g, "").replace(",", "."))
      : Number(roh.replace(/,/g, ""));
    if (Number.isFinite(zahl) && zahl > 0) return zahl;
  }
  return null;
}

/** Datum im Format 31.10.2026 oder 2026-10-31. */
export function findeDatum(text: string): string | null {
  let m = text.match(/\b(\d{1,2})\.(\d{1,2})\.(20\d{2})\b/);
  if (m)
    return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

export interface AnhangEingang {
  dateiname: string;
  mime_typ?: string | null;
  inhalt_base64: string;
}

export interface BelegErgebnis {
  beleg_id: string | null;
  dateiname: string;
  uebersprungen?: string;
  belegnummer: string | null;
  betrag: number | null;
}

/**
 * Sichert einen Anhang auf der Platte und legt ihn als Beleg an.
 * Der Dateiname auf der Platte enthält einen Hash des Inhalts, damit
 * derselbe Anhang aus zwei Mails nicht zweimal liegt.
 */
export async function sichereAnhang(
  anhang: AnhangEingang,
  bezug: {
    vorgang_id: string;
    nachricht_id: string;
    kontakt_id: string | null;
    betreff: string;
    koerper: string;
  },
): Promise<BelegErgebnis> {
  if (!istBelegKandidat(anhang.dateiname)) {
    return {
      beleg_id: null,
      dateiname: anhang.dateiname,
      uebersprungen: "Kein Belegformat (vermutlich Signaturbild).",
      belegnummer: null,
      betrag: null,
    };
  }

  const daten = Buffer.from(anhang.inhalt_base64, "base64");
  const hash = createHash("sha256").update(daten).digest("hex").slice(0, 24);
  const endung = anhang.dateiname.match(/\.[a-z0-9]+$/i)?.[0] ?? "";
  const heute = new Date().toISOString().slice(0, 7);
  const ordner = join(ABLAGE, heute);
  const pfad = join(ordner, `${hash}${endung}`);

  await mkdir(ordner, { recursive: true });
  await writeFile(pfad, daten);

  const suchtext = `${anhang.dateiname}\n${bezug.betreff}\n${bezug.koerper}`;
  const belegnummer = findeBelegnummer(anhang.dateiname, bezug.betreff, bezug.koerper);
  const betrag = findeBetrag(suchtext);
  const datum = findeDatum(bezug.koerper) ?? findeDatum(anhang.dateiname);

  const [a] = await query<{ id: string }>(
    `INSERT INTO anhang (nachricht_id, dateiname, mime_typ, groesse_bytes, ablage_pfad)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [bezug.nachricht_id, anhang.dateiname, anhang.mime_typ ?? null, daten.length, pfad],
  );

  const [b] = await query<{ id: string }>(
    `INSERT INTO beleg (art, richtung, vorgang_id, nachricht_id, anhang_id,
                        kontakt_id, belegnummer, belegdatum, betrag_brutto,
                        dateiname, ablage_pfad)
     VALUES ('rechnung','eingang',$1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id`,
    [
      bezug.vorgang_id, bezug.nachricht_id, a.id, bezug.kontakt_id,
      belegnummer, datum, betrag, anhang.dateiname, pfad,
    ],
  );

  return {
    beleg_id: b.id,
    dateiname: anhang.dateiname,
    belegnummer,
    betrag,
  };
}
