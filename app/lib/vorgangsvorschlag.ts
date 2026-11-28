/**
 * Einen neuen Vorgang anlegen -- von Hand oder mit KI ausgefuellt.
 *
 * Bis zum 27.11.2026 entstand ein Vorgang nur aus einer eingehenden Mail.
 * Wer selbst etwas anstossen wollte -- einen Handwerker anfragen, einer
 * Behoerde schreiben, einem Mieter etwas ankuendigen --, hatte dafuer
 * keinen Ort in der Verwaltung und schrieb aus Apple Mail.
 *
 * Jetzt gibt es das Fenster "Neuer Vorgang" (components/NeuerVorgang.tsx):
 * In eigenen Worten beschreiben, was zu tun ist, die KI fuellt Betreff,
 * Kategorie, Objekt, Einheit, Kontakt und Frist aus und schreibt die erste
 * Nachricht vor. Stephan prueft, aendert und legt an.
 *
 * Was hier NICHT passiert, und zwar mit Absicht:
 *   - Es wird nichts verschickt. Die erste Nachricht ist ein Entwurf und
 *     geht ueber die Freigabe in der Akte raus, wie jeder andere.
 *   - Die KI legt nichts an. Sie fuellt ein Formular; anlegen tut der Klick.
 *   - Mahnwesen und Behoerdenpost sind heikel (HEIKLE_KATEGORIEN) -- dort
 *     schreibt die KI keinen Brieftext vor, und der Vorgang wird heikel
 *     markiert, damit auch der naechtliche Agent nichts vorschreibt.
 */

import { one, query, tx } from "./db";
import { frageModell, OHNE_SCHLUESSEL, type Holer, type Werkzeug } from "./ki";
import { HEIKLE_KATEGORIEN, KATEGORIE_LABEL, type Kategorie } from "./typen";

export const KATEGORIEN: Kategorie[] = [
  "mieter",
  "handwerker",
  "behoerde",
  "rechnung",
  "interessent",
  "mahnwesen",
  "sonstige",
];

const ABSENDER = process.env.ABSENDER_EMAIL ?? "verwaltung@stig-immobilien.de";
const ABSENDER_NAME = process.env.ABSENDER_NAME ?? "STIG Immobilien";

// ---------------------------------------------------------------------------
// Was das Formular zur Auswahl braucht
// ---------------------------------------------------------------------------

export interface Auswahl {
  objekte: Array<{ id: string; name: string }>;
  einheiten: Array<{ id: string; bezeichnung: string; objekt_id: string; objekt: string }>;
}

export async function ladeAuswahl(): Promise<Auswahl> {
  const [objekte, einheiten] = await Promise.all([
    query<{ id: string; name: string }>(
      `SELECT id, name FROM objekt ORDER BY name`,
    ),
    query<{ id: string; bezeichnung: string; objekt_id: string; objekt: string }>(
      `SELECT e.id, e.bezeichnung, e.objekt_id, o.name AS objekt
         FROM einheit e
         JOIN objekt o ON o.id = e.objekt_id
        ORDER BY o.name, e.bezeichnung`,
    ),
  ]);
  return { objekte, einheiten };
}

// ---------------------------------------------------------------------------
// Der Datensatz, den Formular, KI und Assistent gemeinsam haben
// ---------------------------------------------------------------------------

export interface VorgangEntwurf {
  betreff: string;
  kategorie: Kategorie;
  objekt_id: string | null;
  einheit_id: string | null;
  kontakt_id: string | null;
  kontakt_name: string;
  kontakt_email: string;
  frist: string | null;
  /** Die erste Nachricht. Leer = Vorgang ohne Nachricht. */
  nachricht_betreff: string;
  nachricht_text: string;
  /** Was die KI dazu anmerkt -- unsicher, nachzufragen, fehlt. */
  hinweis: string;
}

export const LEERER_ENTWURF: VorgangEntwurf = {
  betreff: "",
  kategorie: "sonstige",
  objekt_id: null,
  einheit_id: null,
  kontakt_id: null,
  kontakt_name: "",
  kontakt_email: "",
  frist: null,
  nachricht_betreff: "",
  nachricht_text: "",
  hinweis: "",
};

const EMAIL = /^[^\s@<>(),;:]+@[^\s@<>(),;:]+\.[^\s@<>(),;:]{2,}$/;
const DATUM = /^\d{4}-\d{2}-\d{2}$/;

const text = (w: unknown, max: number) =>
  typeof w === "string" ? w.trim().slice(0, max) : "";

/**
 * Was immer hereinkommt -- vom Modell, vom Assistenten oder aus dem
 * Formular --, wird hier auf das gebracht, was die Datenbank annimmt.
 *
 * Objekt und Einheit nur, wenn es sie in der Auswahl gibt. Eine Kennung,
 * die das Modell erfunden hat, faellt still weg, statt beim Anlegen einen
 * Fremdschluesselfehler zu werfen -- oder, schlimmer, auf ein Haus eines
 * anderen Mandanten zu zeigen.
 */
export function normalisiere(
  roh: Record<string, unknown>,
  auswahl: Auswahl,
  opts: { vonKi?: boolean } = {},
): VorgangEntwurf {
  const kategorie = KATEGORIEN.includes(roh.kategorie as Kategorie)
    ? (roh.kategorie as Kategorie)
    : "sonstige";

  let einheit = auswahl.einheiten.find((e) => e.id === roh.einheit_id) ?? null;
  let objekt = auswahl.objekte.find((o) => o.id === roh.objekt_id) ?? null;
  // Eine Einheit bringt ihr Haus mit; widersprechen sich beide, gilt die
  // Einheit -- sie ist die genauere Angabe.
  if (einheit) objekt = auswahl.objekte.find((o) => o.id === einheit!.objekt_id) ?? objekt;
  if (einheit && objekt && einheit.objekt_id !== objekt.id) einheit = null;

  const email = text(roh.kontakt_email, 200).toLowerCase();
  const frist = text(roh.frist, 10);

  return {
    betreff: text(roh.betreff, 200),
    kategorie,
    objekt_id: objekt?.id ?? null,
    einheit_id: einheit?.id ?? null,
    kontakt_id: typeof roh.kontakt_id === "string" && roh.kontakt_id ? roh.kontakt_id : null,
    kontakt_name: text(roh.kontakt_name, 160),
    kontakt_email: EMAIL.test(email) ? email : "",
    frist: DATUM.test(frist) && !Number.isNaN(Date.parse(frist)) ? frist : null,
    // In heiklen Kategorien schreibt die KI keine Nachricht vor -- siehe
    // Kopf. Was Stephan dort selbst ins Formular schreibt, bleibt stehen.
    nachricht_betreff:
      opts.vonKi && HEIKLE_KATEGORIEN.includes(kategorie)
        ? ""
        : text(roh.nachricht_betreff, 200),
    nachricht_text:
      opts.vonKi && HEIKLE_KATEGORIEN.includes(kategorie)
        ? ""
        : text(roh.nachricht_text, 6000),
    hinweis: text(roh.hinweis, 600),
  };
}

// ---------------------------------------------------------------------------
// Kontakt wiederfinden
// ---------------------------------------------------------------------------

/**
 * Der Kern eines Namens fuer den Vergleich mit einer Mail-Domain:
 * klein, Umlaute ausgeschrieben, nur Buchstaben und Ziffern.
 * "ML Hauselemente" -> "mlhauselemente", passend zu "ml-hauselemente.de".
 */
export function suchkern(name: string): string {
  return name
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]/g, "");
}

const ILIKE = (w: string) => `%${w.replace(/[\\%_]/g, (z) => "\\" + z)}%`;

/**
 * Den genannten Kontakt im Bestand suchen, in drei Stufen:
 *   1. ueber die E-Mail-Adresse
 *   2. ueber den Namen oder die Firma, genau (gross/klein egal)
 *   3. ungefaehr: Name oder Firma enthaelt das Wort, oder die Domain
 *      einer Adresse passt zum Namen -- so findet "ML Hauselemente" den
 *      Kontakt "Dennis Harsch <d.harsch@ml-hauselemente.de>"
 *
 * Nur ein eindeutiger Treffer zaehlt -- bei zwei "Anna" lieber keinen als
 * den falschen. Stufe 3 erst ab vier Zeichen, sonst passt "Bau" auf jeden
 * Handwerker.
 */
export async function findeKontakt(
  name: string,
  email: string,
): Promise<{ id: string; anzeigename: string; email: string | null } | null> {
  if (email) {
    const k = await one<{ id: string; anzeigename: string; email: string }>(
      `SELECT k.id, k.anzeigename, ke.email
         FROM kontakt_email ke
         JOIN kontakt k ON k.id = ke.kontakt_id
        WHERE lower(ke.email) = lower($1)
        LIMIT 1`,
      [email],
    );
    if (k) return k;
  }
  if (!name) return null;

  const MIT_ADRESSE = `SELECT k.id, k.anzeigename,
            (SELECT ke.email FROM kontakt_email ke
              WHERE ke.kontakt_id = k.id
              ORDER BY ke.ist_primaer DESC LIMIT 1) AS email
       FROM kontakt k`;

  const genau = await query<{ id: string; anzeigename: string; email: string | null }>(
    `${MIT_ADRESSE}
      WHERE k.aktiv
        AND (lower(k.anzeigename) = lower($1)
             OR lower(coalesce(k.firma, '')) = lower($1))
      LIMIT 2`,
    [name],
  );
  if (genau.length === 1) return genau[0];
  if (genau.length > 1) return null;

  const kern = suchkern(name);
  if (kern.length < 4) return null;
  const ungefaehr = await query<{ id: string; anzeigename: string; email: string | null }>(
    `${MIT_ADRESSE}
      WHERE k.aktiv
        AND (k.anzeigename ILIKE $1
             OR coalesce(k.firma, '') ILIKE $1
             OR EXISTS (
               SELECT 1 FROM kontakt_email ke
                WHERE ke.kontakt_id = k.id
                  AND regexp_replace(lower(split_part(ke.email, '@', 2)), '[^a-z0-9]', '', 'g')
                      LIKE '%' || $2 || '%'))
      LIMIT 2`,
    [ILIKE(name), kern],
  );
  return ungefaehr.length === 1 ? ungefaehr[0] : null;
}

// ---------------------------------------------------------------------------
// Ausfuellen mit KI
// ---------------------------------------------------------------------------

export const WERKZEUG_AUSFUELLEN: Werkzeug = {
  name: "vorgang_ausfuellen",
  description:
    "Füllt das Formular für einen neuen Vorgang aus. Nur Werte aus der " +
    "Beschreibung oder den mitgegebenen Listen; was nicht feststeht, bleibt leer.",
  input_schema: {
    type: "object",
    properties: {
      betreff: {
        type: "string",
        description: "Kurzer, klarer Betreff des Vorgangs, höchstens 80 Zeichen.",
      },
      kategorie: { type: "string", enum: KATEGORIEN },
      objekt_id: { type: "string", description: "ID aus der Objektliste oder leer." },
      einheit_id: { type: "string", description: "ID aus der Einheitenliste oder leer." },
      kontakt_name: { type: "string", description: "Name oder Firma des Gegenübers." },
      kontakt_email: { type: "string", description: "Nur wenn in der Beschreibung genannt." },
      frist: {
        type: "string",
        description: "Frist als JJJJ-MM-TT, nur wenn eine genannt oder klar gemeint ist.",
      },
      nachricht_betreff: { type: "string" },
      nachricht_text: {
        type: "string",
        description:
          "Die erste Nachricht an das Gegenüber, fertig zum Gegenlesen. Leer, " +
          "wenn keine Nachricht nötig ist oder die Kategorie Mahnwesen/Behörde ist.",
      },
      hinweis: {
        type: "string",
        description: "Ein Satz an Stephan: was unklar ist oder fehlt. Sonst leer.",
      },
    },
    required: ["betreff", "kategorie"],
  },
};

export function systemFuerVorschlag(auswahl: Auswahl, heute: string): string {
  const objekte = auswahl.objekte.map((o) => `- ${o.id}: ${o.name}`).join("\n");
  const einheiten = auswahl.einheiten
    .map((e) => `- ${e.id}: ${e.bezeichnung} (${e.objekt})`)
    .join("\n");
  const kategorien = KATEGORIEN.map((k) => `${k} (${KATEGORIE_LABEL[k]})`).join(", ");
  return [
    "Du füllst in einer Hausverwaltung das Formular für einen neuen Vorgang aus.",
    "Stephan Hofmann beschreibt in eigenen Worten, was er anstoßen will.",
    `Heute ist ${heute}. Relative Angaben wie „bis Freitag“ rechnest du von heute aus.`,
    "",
    "Regeln:",
    "- Benutze ausschließlich das Werkzeug vorgang_ausfuellen.",
    "- Objekt und Einheit nur als ID aus den Listen unten. Passt nichts sicher, lass es leer.",
    "- Erfinde keine E-Mail-Adressen, Namen oder Termine.",
    `- Kategorien: ${kategorien}.`,
    "- Braucht es eine erste Nachricht (z. B. einen Handwerker anfragen, einem Mieter etwas",
    "  mitteilen), schreib sie auf Deutsch: höflich, knapp, konkret, mit Anrede und",
    "  der Unterschrift in drei Zeilen: „Beste Grüße“, „Stephan Hofmann“, „STIG Immobilien eGbR“.",
    "  Schreibt Stephan auf Englisch oder nennt er ein englischsprachiges Gegenüber, auf Englisch.",
    "- Bei Mahnwesen und Behördenpost schreibst du keine Nachricht.",
    "- Sage nichts zu, was Geld kostet oder Termine bindet, wenn Stephan es nicht so gesagt hat.",
    "",
    "Objekte:",
    objekte || "(keine)",
    "",
    "Einheiten:",
    einheiten || "(keine)",
  ].join("\n");
}

export type VorschlagErgebnis =
  | { ok: true; entwurf: VorgangEntwurf; modell: string }
  | { ok: false; fehler: string };

export async function schlageVor(
  beschreibung: string,
  opts: {
    holen?: Holer;
    schluessel?: string | null;
    heute?: Date;
    auswahl?: Auswahl;
    kontaktSuche?: typeof findeKontakt;
  } = {},
): Promise<VorschlagErgebnis> {
  const wunsch = beschreibung.trim().slice(0, 4000);
  if (!wunsch) return { ok: false, fehler: "Bitte zuerst beschreiben, worum es geht." };
  const schluessel = opts.schluessel ?? process.env.ANTHROPIC_API_KEY ?? null;
  if (!schluessel) return { ok: false, fehler: OHNE_SCHLUESSEL };

  const auswahl = opts.auswahl ?? (await ladeAuswahl());
  const heute = (opts.heute ?? new Date()).toISOString().slice(0, 10);
  const antwort = await frageModell({
    system: systemFuerVorschlag(auswahl, heute),
    nachrichten: [{ role: "user", content: wunsch }],
    werkzeuge: [WERKZEUG_AUSFUELLEN],
    werkzeugPflicht: WERKZEUG_AUSFUELLEN.name,
    maxTokens: 1800,
    holen: opts.holen,
    schluessel,
  });
  if (!antwort.ok) return { ok: false, fehler: antwort.fehler };

  const aufruf = antwort.inhalt.find(
    (b) => b.type === "tool_use" && b.name === WERKZEUG_AUSFUELLEN.name,
  );
  if (!aufruf || aufruf.type !== "tool_use") {
    return { ok: false, fehler: "Die KI hat kein Formular zurückgegeben." };
  }

  const entwurf = normalisiere(aufruf.input, auswahl, { vonKi: true });
  if (!entwurf.betreff) entwurf.betreff = wunsch.split("\n")[0].slice(0, 80);

  // Den genannten Kontakt im Bestand suchen -- dann steht seine Adresse
  // schon da, und es entsteht kein zweiter Kontakt mit demselben Namen.
  const suche = opts.kontaktSuche ?? findeKontakt;
  const k = await suche(entwurf.kontakt_name, entwurf.kontakt_email).catch(() => null);
  if (k) {
    entwurf.kontakt_id = k.id;
    entwurf.kontakt_name = k.anzeigename;
    if (!entwurf.kontakt_email && k.email) entwurf.kontakt_email = k.email;
  }
  return { ok: true, entwurf, modell: antwort.modell };
}

// ---------------------------------------------------------------------------
// Anlegen
// ---------------------------------------------------------------------------

/** Die Rolle eines neuen Kontakts folgt der Kategorie des Vorgangs. */
export function rolleFuer(kategorie: Kategorie): string {
  return ["mieter", "handwerker", "behoerde", "interessent"].includes(kategorie)
    ? kategorie
    : "sonstige";
}

export type AnlegeErgebnis =
  | { ok: true; id: string; nummer: number; entwurf: boolean }
  | { ok: false; fehler: string };

/**
 * Legt Kontakt (falls neu), Vorgang und -- wenn Text da ist -- den Entwurf
 * der ersten Nachricht in einer Transaktion an. Entweder alles oder nichts:
 * ein Vorgang ohne seinen Entwurf waere eine halbe Arbeit, die niemand
 * bemerkt.
 */
export async function legeVorgangAn(
  e: VorgangEntwurf,
  opts: { wer: string; mitKi: boolean; modell?: string | null },
): Promise<AnlegeErgebnis> {
  if (!e.betreff) return { ok: false, fehler: "Der Betreff fehlt." };

  return tx(async (c) => {
    // Objekt und Einheit noch einmal unter der Zeilensicherheit lesen: Was
    // hier nicht zu sehen ist, gehoert nicht diesem Mandanten.
    if (e.objekt_id) {
      const o = await c.query(`SELECT 1 FROM objekt WHERE id = $1`, [e.objekt_id]);
      if (o.rowCount === 0) return { ok: false as const, fehler: "Unbekanntes Objekt." };
    }
    if (e.einheit_id) {
      const u = await c.query(`SELECT 1 FROM einheit WHERE id = $1`, [e.einheit_id]);
      if (u.rowCount === 0) return { ok: false as const, fehler: "Unbekannte Einheit." };
    }

    // Kontakt: vorhandenen nehmen, sonst anlegen.
    let kontaktId: string | null = null;
    if (e.kontakt_id) {
      const k = await c.query<{ id: string }>(`SELECT id FROM kontakt WHERE id = $1`, [e.kontakt_id]);
      kontaktId = k.rows[0]?.id ?? null;
    }
    if (!kontaktId && e.kontakt_email) {
      const k = await c.query<{ kontakt_id: string }>(
        `SELECT kontakt_id FROM kontakt_email WHERE lower(email) = lower($1) LIMIT 1`,
        [e.kontakt_email],
      );
      kontaktId = k.rows[0]?.kontakt_id ?? null;
    }
    if (!kontaktId && e.kontakt_name) {
      const neu = await c.query<{ id: string }>(
        `INSERT INTO kontakt (anzeigename, rolle) VALUES ($1, $2) RETURNING id`,
        [e.kontakt_name, rolleFuer(e.kategorie)],
      );
      kontaktId = neu.rows[0].id;
      if (e.kontakt_email) {
        await c.query(
          `INSERT INTO kontakt_email (kontakt_id, email, ist_primaer) VALUES ($1, $2, true)`,
          [kontaktId, e.kontakt_email],
        );
      }
    }

    const heikel = HEIKLE_KATEGORIEN.includes(e.kategorie);
    const v = await c.query<{ id: string; nummer: string }>(
      `INSERT INTO vorgang
         (betreff, kategorie, status, heikel, objekt_id, einheit_id,
          kontakt_id, frist, herkunft)
       VALUES ($1, $2, 'offen', $3, $4, $5, $6, $7::date, 'sonstige')
       RETURNING id, nummer`,
      [e.betreff, e.kategorie, heikel, e.objekt_id, e.einheit_id, kontaktId, e.frist],
    );
    const vorgang = v.rows[0];

    let entwurf = false;
    // Als von der KI geschrieben zaehlt der Text nur, wenn die KI dort
    // ueberhaupt schreiben darf. In heiklen Kategorien kann er nur von
    // Stephan stammen -- normalisiere() hat den der KI verworfen.
    const kiText = opts.mitKi && !heikel;
    if (e.nachricht_text.trim()) {
      const an = e.kontakt_email ? [e.kontakt_email] : [];
      const notiz =
        (kiText ? "Mit KI vorgeschrieben beim Anlegen des Vorgangs." : "") +
        (an.length === 0
          ? " Keine E-Mail-Adresse angegeben — vor dem Senden eintragen oder den Text als Brief verwenden."
          : "");
      const n = await c.query<{ id: string }>(
        `INSERT INTO nachricht
           (vorgang_id, richtung, status, von_email, von_name, an_emails,
            betreff, koerper_text, verfasst_von, agent_notiz,
            entwurf_quelle, entwurf_modell)
         VALUES ($1, 'aus', 'entwurf', $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [
          vorgang.id,
          ABSENDER,
          ABSENDER_NAME,
          an,
          e.nachricht_betreff || e.betreff,
          e.nachricht_text.trim(),
          kiText ? "agent" : "mensch",
          notiz.trim() || null,
          kiText ? "modell" : "mensch",
          kiText ? (opts.modell ?? null) : null,
        ],
      );
      entwurf = n.rowCount === 1;
    }

    await c.query(
      `INSERT INTO protokoll (vorgang_id, ereignis, details)
       VALUES ($1, 'angelegt', $2::jsonb)`,
      [
        vorgang.id,
        JSON.stringify({ herkunft: "portal", wer: opts.wer, ki: opts.mitKi, entwurf }),
      ],
    );

    return { ok: true as const, id: vorgang.id, nummer: Number(vorgang.nummer), entwurf };
  });
}
