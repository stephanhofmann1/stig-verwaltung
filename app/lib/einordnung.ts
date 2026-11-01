import type { Kategorie } from "./typen";
import { HEIKLE_KATEGORIEN } from "./typen";
import { query, one } from "./db";

/** Entfernt Re:/AW:/Fwd:-Präfixe, damit Betreffs vergleichbar werden. */
export function normalisiereBetreff(betreff: string): string {
  let s = betreff ?? "";
  // Mehrfach verschachtelte Präfixe abschälen (AW: Re: Fwd: ...)
  for (;;) {
    const neu = s.replace(
      /^\s*(re|aw|antw|wg|fw|fwd|weiterleitung)\s*(\[\d+\])?\s*:\s*/i,
      "",
    );
    if (neu === s) break;
    s = neu;
  }
  return s.trim();
}

/** Zerlegt einen Header-Wert in einzelne Message-IDs. */
export function parseMessageIds(roh: string | null | undefined): string[] {
  if (!roh) return [];
  return (roh.match(/<[^<>\s]+>/g) ?? []).map((s) => s.trim());
}

const SCHLUESSELWOERTER: Array<{ kategorie: Kategorie; muster: RegExp }> = [
  {
    kategorie: "mahnwesen",
    muster:
      /\b(mahnung|zahlungsverzug|rückstand|rueckstand|kündigung|kuendigung|fristlos|räumung|raeumung|mahnbescheid|inkasso|vollstreck)/i,
  },
  {
    kategorie: "behoerde",
    muster:
      /\b(finanzamt|bauamt|ordnungsamt|bürgerbüro|buergerbuero|gewerbeamt|stadt gießen|stadt giessen|amtsgericht|bescheid|ladung)/i,
  },
  {
    kategorie: "rechnung",
    muster:
      /\b(rechnung|rechnungsnr|zahlungsavis|gutschrift|abschlagsrechnung|teilrechnung|schlussrechnung|lastschrift)/i,
  },
  // Schadensmeldungen gehören zum Mieter, auch wenn sie ein Gewerk nennen.
  // "Heizung defekt" ist eine Meldung, "Angebot Heizung" ein Handwerker.
  // Darum steht dieses Muster vor dem der Handwerker.
  {
    kategorie: "mieter",
    muster:
      /\b(defekt|kaputt|geht nicht|funktioniert nicht|undicht|tropft|verstopft|schimmel|kein warmwasser|wird nicht warm|ausgefallen|klemmt)/i,
  },
  {
    kategorie: "handwerker",
    muster:
      /\b(angebot|kostenvoranschlag|montage|aufmaß|aufmass|auftragsbestätigung|auftragsbestaetigung|terminvorschlag|anfahrt|gewerk|nachtrag zum auftrag)/i,
  },
  {
    kategorie: "interessent",
    muster:
      /\b(wg-gesucht|wg gesucht|zimmeranfrage|besichtigung|noch frei|anfrage zum zimmer|bewerbung um)/i,
  },
  {
    kategorie: "mieter",
    muster:
      /\b(mietvertrag|nebenkosten|betriebskosten|kaution|wohnungsgeber|schlüssel|schluessel|heizung kaputt|defekt|schimmel|nachbar)/i,
  },
  {
    kategorie: "werbung",
    muster:
      /\b(newsletter|abmelden|unsubscribe|sonderangebot|jetzt sparen|gewinnspiel|rabattcode)/i,
  },
];

export interface Einordnung {
  kategorie: Kategorie;
  heikel: boolean;
  begruendung: string;
}

/**
 * Regelbasierte Erstklassifizierung. Bewusst konservativ: Im Zweifel
 * "sonstige" und nicht heikel-frei. Ein Sprachmodell kann das später
 * verfeinern — die Heikel-Regel bleibt aber hart, damit niemals eine
 * Mahnung oder Behördenpost automatisch beantwortet wird.
 */
export async function ordneEin(
  betreff: string,
  koerper: string,
  vonEmail: string,
): Promise<Einordnung> {
  const text = `${betreff}\n${koerper}`;

  // 1. Bekannter Kontakt schlägt Stichwörter — außer bei heiklen Mustern.
  const kontakt = await one<{ rolle: string; anzeigename: string }>(
    `SELECT k.rolle, k.anzeigename
       FROM kontakt k
       JOIN kontakt_email e ON e.kontakt_id = k.id
      WHERE lower(e.email) = lower($1)
      LIMIT 1`,
    [vonEmail],
  );

  for (const { kategorie, muster } of SCHLUESSELWOERTER) {
    if (!muster.test(text)) continue;
    // Heikles gewinnt immer, egal wer schreibt.
    if (HEIKLE_KATEGORIEN.includes(kategorie)) {
      return {
        kategorie,
        heikel: true,
        begruendung: `Stichwort für "${kategorie}" gefunden — wird nicht automatisch beantwortet.`,
      };
    }
    // Ein Kontakt mit der Rolle "sonstige" ist nur automatisch angelegt
    // worden und sagt nichts aus. Dann entscheidet das Stichwort.
    if (!kontakt || kontakt.rolle === "sonstige") {
      return {
        kategorie,
        heikel: false,
        begruendung: kontakt
          ? `Stichwort für "${kategorie}" gefunden; der Absender ist noch keiner Rolle zugeordnet.`
          : `Stichwort für "${kategorie}" gefunden, Absender unbekannt.`,
      };
    }
    break;
  }

  if (kontakt) {
    const abbildung: Record<string, Kategorie> = {
      mieter: "mieter",
      handwerker: "handwerker",
      behoerde: "behoerde",
      versorger: "rechnung",
      interessent: "interessent",
      sonstige: "sonstige",
    };
    const kategorie = abbildung[kontakt.rolle] ?? "sonstige";
    return {
      kategorie,
      heikel: HEIKLE_KATEGORIEN.includes(kategorie),
      begruendung: `Bekannter Kontakt: ${kontakt.anzeigename} (${kontakt.rolle}).`,
    };
  }

  return {
    kategorie: "sonstige",
    heikel: false,
    begruendung: "Kein Stichwort getroffen, Absender unbekannt.",
  };
}

/**
 * Findet den Vorgang für eine eingehende Nachricht.
 * Reihenfolge: echte Thread-Header, dann Betreff+Kontakt, dann neu.
 */
export async function findeVorgangId(opts: {
  inReplyTo: string | null;
  referenzen: string[];
  betreff: string;
  vonEmail: string;
}): Promise<string | null> {
  const ids = [
    ...(opts.inReplyTo ? [opts.inReplyTo] : []),
    ...opts.referenzen,
  ].filter(Boolean);

  if (ids.length > 0) {
    const treffer = await one<{ vorgang_id: string }>(
      `SELECT vorgang_id FROM nachricht
        WHERE message_id = ANY($1::text[])
        ORDER BY angelegt_am DESC
        LIMIT 1`,
      [ids],
    );
    if (treffer) return treffer.vorgang_id;
  }

  // Fallback: gleicher Betreff vom gleichen Absender, Vorgang noch nicht erledigt.
  const norm = normalisiereBetreff(opts.betreff);
  if (norm.length >= 4) {
    const treffer = await one<{ id: string }>(
      `SELECT v.id
         FROM vorgang v
         JOIN nachricht n ON n.vorgang_id = v.id
        WHERE v.status <> 'erledigt'
          AND lower(n.von_email) = lower($1)
          AND lower(regexp_replace(v.betreff,
                '^((re|aw|antw|wg|fw|fwd)\\s*:\\s*)+', '', 'i')) = lower($2)
        ORDER BY v.geaendert_am DESC
        LIMIT 1`,
      [opts.vonEmail, norm],
    );
    if (treffer) return treffer.id;
  }

  return null;
}

/** Legt einen Kontakt an, falls die Adresse noch unbekannt ist. */
export async function kontaktFuerEmail(
  email: string,
  name: string | null,
): Promise<string> {
  const vorhanden = await one<{ kontakt_id: string }>(
    `SELECT kontakt_id FROM kontakt_email WHERE lower(email) = lower($1)`,
    [email],
  );
  if (vorhanden) return vorhanden.kontakt_id;

  const [kontakt] = await query<{ id: string }>(
    `INSERT INTO kontakt (anzeigename, rolle) VALUES ($1, 'sonstige') RETURNING id`,
    [name?.trim() || email],
  );
  await query(
    `INSERT INTO kontakt_email (kontakt_id, email, ist_primaer)
     VALUES ($1, $2, true)`,
    [kontakt.id, email],
  );
  return kontakt.id;
}
