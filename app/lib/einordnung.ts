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

export const SCHLUESSELWOERTER: Array<{ kategorie: Kategorie; muster: RegExp }> = [
  {
    kategorie: "mahnwesen",
    muster:
      /\b(mahnung|zahlungsverzug|rückstand|rueckstand|kündigung|kuendigung|fristlos|räumung|raeumung|mahnbescheid|inkasso|vollstreck)/i,
  },
  {
    kategorie: "behoerde",
    // "bescheid" meint den Behoerdenbescheid -- traf aber "Bescheid geben",
    // die alltaeglichste Wendung der deutschen Geschaeftssprache. Am
    // 03.11.2026 landete so eine Mail des Messdienstleisters als
    // Behoerdenpost in der Akte, wurde heikel markiert, und der Agent
    // durfte dort keinen Entwurf mehr schreiben. Der Schaden ist still:
    // die Automatik hoert auf zu arbeiten, ohne dass jemand erfaehrt warum.
    // Der tragfaehige Unterschied ist nicht die Verbform -- im Deutschen
    // steht das Verb davor ("Geben Sie mir Bescheid") -- sondern die
    // Begleitung: Ein Behoerdenbescheid traegt einen Artikel oder eine
    // Praeposition ("der Bescheid", "Bescheid des Finanzamts"), die
    // Redewendung nie. Faellt ein echter Bescheid dadurch einmal durch,
    // greifen meist die uebrigen Stichwoerter derselben Zeile.
    muster:
      /\b(finanzamt|bauamt|ordnungsamt|bürgerbüro|buergerbuero|gewerbeamt|stadt gießen|stadt giessen|amtsgericht|(?:(?:der|die|den|dem|des|ein|einen|einem|eines|ihr|ihre|ihren|ihrem|unser|unseren|unserem|beiliegende[nrs]?|anliegende[nrs]?)\s+bescheid|bescheid\s+(?:des|der|vom|von|über|ueber|gemäß|gemaess|nach|zur|zum|betreffend))|ladung)/i,
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

/**
 * Ein Stichworttreffer mit Fundstelle.
 *
 * Bis zum 03.11.2026 wurde vom Treffer nur der Wahrheitswert genommen
 * (`muster.test(text)`), und damit war die teuerste Frage nicht mehr zu
 * beantworten: WAS hat getroffen. An jenem Tag landete eine Mail des
 * Messdienstleisters als Behoerdenpost in der Akte, weil sie "Geben Sie
 * mir Bescheid" enthielt -- wurde dadurch heikel markiert, der Agent
 * durfte dort nichts mehr vorschreiben, und niemand erfuhr warum. Der
 * Schaden war nicht die falsche Kategorie, sondern das Schweigen danach.
 *
 * `stichwort` ist deshalb der tatsaechlich getroffene Text und nicht die
 * Quelle des Musters: "Bescheid" sagt nichts, "Geben Sie mir Bescheid"
 * erklaert den Fehler in einer Zeile.
 */
export interface Treffer {
  kategorie: Kategorie;
  /** Der tatsaechlich getroffene Text. */
  stichwort: string;
  /** Der Ausschnitt, in dem er stand -- mit Auslassungszeichen am Rand. */
  fundstelle: string;
  /** Zeichenposition im geprueften Text (Betreff + Koerper). */
  position: number;
  /** Stelle in SCHLUESSELWOERTER -- welche Zeile der Liste gewonnen hat. */
  musterNr: number;
}

/** So viele Zeichen Umgebung kommen links und rechts in die Fundstelle. */
export const FUNDSTELLE_UMGEBUNG = 60;

/**
 * Schneidet den Ausschnitt um einen Treffer heraus.
 *
 * Zeilenumbrueche und Mehrfachleerzeichen fallen weg: Die Fundstelle steht
 * einzeilig in einer Tabellenzelle, und ein umgebrochener Mailtext sprengt
 * sie. Gekuerzte Raender bekommen ein Auslassungszeichen, damit niemand
 * den Ausschnitt fuer die ganze Nachricht haelt.
 */
export function schneideFundstelle(
  text: string,
  position: number,
  laenge: number,
  umgebung = FUNDSTELLE_UMGEBUNG,
): string {
  const von = Math.max(0, position - umgebung);
  const bis = Math.min(text.length, position + laenge + umgebung);
  const kern = text.slice(von, bis).replace(/\s+/g, " ").trim();
  return `${von > 0 ? "… " : ""}${kern}${bis < text.length ? " …" : ""}`;
}

/**
 * Das erste Stichwortmuster, das wirklich trifft -- samt Fundstelle.
 *
 * Die Reihenfolge von SCHLUESSELWOERTER entscheidet: Das erste Muster
 * gewinnt, auch wenn ein spaeteres ebenfalls passen wuerde. Das ist
 * Absicht und steht in den Kommentaren dort (Schadensmeldung vor
 * Handwerker).
 *
 * `exec` statt `test`: Beides prueft dasselbe, aber nur `exec` gibt den
 * Treffer und seine Stelle heraus. Die Muster tragen bewusst kein /g --
 * sonst truege jedes einen eigenen lastIndex, und derselbe Aufruf
 * lieferte beim zweiten Mal ein anderes Ergebnis.
 */
export function findeStichwort(text: string): Treffer | null {
  for (let i = 0; i < SCHLUESSELWOERTER.length; i++) {
    const { kategorie, muster } = SCHLUESSELWOERTER[i];
    const t = muster.exec(text);
    if (!t) continue;
    return {
      kategorie,
      stichwort: t[0],
      fundstelle: schneideFundstelle(text, t.index, t[0].length),
      position: t.index,
      musterNr: i,
    };
  }
  return null;
}

export interface Einordnung {
  kategorie: Kategorie;
  heikel: boolean;
  begruendung: string;
  /**
   * Worauf die Kategorie beruht. Die Frage des Eigentuemers lautete
   * woertlich "auf welcher Basis erstellen die sich" -- sie ist hier
   * beantwortet und nicht nur im Kopf des Entwicklers.
   */
  quelle: "regel" | "kontakt" | "keine";
  /** Der getroffene Text, falls die Regel entschieden hat. */
  stichwort: string | null;
  /** Der Ausschnitt um den Treffer. */
  fundstelle: string | null;
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

  // Dieselbe Entscheidung wie vorher, nur dass der Treffer nicht mehr
  // weggeworfen wird. Die alte Schleife brach beim ersten passenden
  // Muster ab, sobald ein Kontakt mit echter Rolle vorlag -- nur das
  // erste Muster war also je wirksam. findeStichwort() liefert genau
  // dieses erste.
  const treffer = findeStichwort(text);
  if (treffer) {
    const { kategorie, stichwort, fundstelle } = treffer;
    // Heikles gewinnt immer, egal wer schreibt.
    if (HEIKLE_KATEGORIEN.includes(kategorie)) {
      return {
        kategorie,
        heikel: true,
        begruendung:
          `Stichwort „${stichwort}“ für "${kategorie}" gefunden — wird ` +
          "nicht automatisch beantwortet.",
        quelle: "regel",
        stichwort,
        fundstelle,
      };
    }
    // Ein Kontakt mit der Rolle "sonstige" ist nur automatisch angelegt
    // worden und sagt nichts aus. Dann entscheidet das Stichwort.
    if (!kontakt || kontakt.rolle === "sonstige") {
      return {
        kategorie,
        heikel: false,
        begruendung: kontakt
          ? `Stichwort „${stichwort}“ für "${kategorie}" gefunden; der Absender ist noch keiner Rolle zugeordnet.`
          : `Stichwort „${stichwort}“ für "${kategorie}" gefunden, Absender unbekannt.`,
        quelle: "regel",
        stichwort,
        fundstelle,
      };
    }
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
      quelle: "kontakt",
      // Hier hat kein Stichwort entschieden, auch wenn eines getroffen
      // haben mag. Es hier mitzuschreiben wuerde eine Begruendung
      // behaupten, die nicht die wirksame war.
      stichwort: null,
      fundstelle: null,
    };
  }

  return {
    kategorie: "sonstige",
    heikel: false,
    begruendung: "Kein Stichwort getroffen, Absender unbekannt.",
    quelle: "keine",
    stichwort: null,
    fundstelle: null,
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
