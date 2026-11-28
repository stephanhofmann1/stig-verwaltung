/**
 * Der Assistent: eine KI, die man in der Verwaltung alles fragen kann.
 *
 * "Was ist heute zu tun?", "Wer ist im Rueckstand?", "Was stand in Vorgang
 * 12?", "Welche Zimmer werden im Januar frei?" -- und: "Leg einen Vorgang
 * an: Fensterbauer wegen der Scheibe in Zimmer 3 anfragen."
 *
 * Wie er arbeitet: Das Modell bekommt keine Datenbank, sondern eine Handvoll
 * Werkzeuge, die je eine Frage beantworten (WERKZEUGE unten). Jedes liest
 * ueber query() -- also unter der Zeilensicherheit des angemeldeten
 * Mandanten. Was der Mandant nicht sehen darf, sieht der Assistent auch
 * nicht.
 *
 * Was er nicht tut, und zwar mit Absicht:
 *   - Er aendert nichts und schickt nichts. Kein Werkzeug schreibt.
 *   - Einen Vorgang legt er nicht an, er SCHLAEGT ihn VOR. Der Vorschlag
 *     erscheint als Karte; angelegt wird im Fenster "Neuer Vorgang" per
 *     Klick, gesendet wird spaeter ueber die Freigabe -- wie bei allem
 *     anderen auch. Stephans Grundsatz vom 06.11.2026: Nichts geht ganz
 *     automatisch raus.
 */

import { query } from "./db";
import { frageModell, textAus, type Block, type Holer, type ModellNachricht, type Werkzeug } from "./ki";
import { ladeCockpit } from "./kennzahlen";
import { mahnstand } from "./rueckstaende";
import { laufName } from "./formate";
import {
  findeKontakt,
  KATEGORIEN,
  ladeAuswahl,
  normalisiere,
  type VorgangEntwurf,
} from "./vorgangsvorschlag";

/** Wie viele Werkzeugrunden eine Frage hoechstens braucht. */
const RUNDEN = 6;
/** Wie viel Gespraech mitgeht: die letzten Nachrichten, gekuerzt. */
const VERLAUF_MAX = 20;
const NACHRICHT_MAX = 4000;

export interface Gespraechsschritt {
  rolle: "nutzer" | "assistent";
  text: string;
}

// ---------------------------------------------------------------------------
// Die Werkzeuge
// ---------------------------------------------------------------------------

export const WERKZEUGE: Werkzeug[] = [
  {
    name: "lage_heute",
    description:
      "Der Überblick wie im Cockpit: was zur Freigabe wartet, Fristen, " +
      "Rückstände, Geld im laufenden Monat, Leerstand und ob die nächtlichen " +
      "Abläufe laufen. Für Fragen wie „Was ist heute zu tun?“.",
    input_schema: {
      type: "object",
      properties: {
        objekt_id: { type: "string", description: "Nur dieses Objekt; leer = alle." },
      },
    },
  },
  {
    name: "vorgaenge_suchen",
    description:
      "Vorgänge (Schriftwechsel mit Mietern, Handwerkern, Behörden …) suchen " +
      "oder auflisten, neueste zuerst.",
    input_schema: {
      type: "object",
      properties: {
        suche: { type: "string", description: "Wort aus Betreff, Kontakt oder Objekt." },
        status: { type: "string", enum: ["offen", "wartet", "erledigt", "alle"] },
        anzahl: { type: "integer", minimum: 1, maximum: 40 },
      },
    },
  },
  {
    name: "vorgang_lesen",
    description: "Einen Vorgang mit seinen Nachrichten lesen, über seine Nummer.",
    input_schema: {
      type: "object",
      properties: { nummer: { type: "integer" } },
      required: ["nummer"],
    },
  },
  {
    name: "mieter_suchen",
    description:
      "Mietverhältnisse: Mieter, Einheit, Objekt, Beginn, Ende, Miete, Kaution, " +
      "Kontakt. Ohne Suchwort alle laufenden.",
    input_schema: {
      type: "object",
      properties: {
        suche: { type: "string", description: "Name, Einheit oder Objekt." },
        auch_ehemalige: { type: "boolean" },
      },
    },
  },
  {
    name: "rueckstaende",
    description: "Wer mit wie viel Miete im Rückstand ist, mit Mahnstufe.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "einheiten",
    description:
      "Einheiten (Wohnungen, Zimmer, Gewerbe) mit Belegung, Mietende und " +
      "Angebotsmiete.",
    input_schema: {
      type: "object",
      properties: { objekt: { type: "string", description: "Name des Objekts; leer = alle." } },
    },
  },
  {
    name: "vorgang_vorschlagen",
    description:
      "Einen neuen Vorgang vorschlagen. Es wird NICHTS angelegt: Stephan sieht " +
      "den Vorschlag als Karte und legt ihn selbst an. Für Mahnwesen und " +
      "Behördenpost keinen Nachrichtentext.",
    input_schema: {
      type: "object",
      properties: {
        betreff: { type: "string" },
        kategorie: { type: "string", enum: KATEGORIEN },
        objekt_id: { type: "string" },
        einheit_id: { type: "string" },
        kontakt_name: { type: "string" },
        kontakt_email: { type: "string" },
        frist: { type: "string", description: "JJJJ-MM-TT" },
        nachricht_betreff: { type: "string" },
        nachricht_text: { type: "string" },
        hinweis: { type: "string" },
      },
      required: ["betreff", "kategorie"],
    },
  },
];

const text = (w: unknown) => (typeof w === "string" && w.trim() ? w.trim() : null);
const muster = (w: string | null) => (w ? `%${w.replace(/[\\%_]/g, (z) => "\\" + z)}%` : null);

/**
 * Fuehrt ein Werkzeug aus. Liefert, was das Modell lesen soll -- knapp,
 * ohne interne Kennungen ausser denen, aus denen Verweise werden.
 */
export async function fuehreAus(
  name: string,
  eingabe: Record<string, unknown>,
  vorschlaege: VorgangEntwurf[],
): Promise<unknown> {
  switch (name) {
    case "lage_heute": {
      const d = await ladeCockpit(new Date(), text(eingabe.objekt_id), 12);
      return {
        stand: d.heute,
        zur_freigabe: {
          entwuerfe: d.freigaben.entwuerfe,
          ohne_antwort: d.freigaben.unbeantwortet,
        },
        fristen: d.fristen.slice(0, 12).map((f) => ({
          was: f.bezeichnung,
          faellig: f.faellig_am,
          resttage: f.resttage,
          dringlichkeit: f.dringlichkeit,
          betrag: f.betrag,
        })),
        rueckstaende: { ...d.rueckstaende, mahnwesen_freigegeben: d.mahnwesenFreigegeben },
        monat: { monat: d.monat.monat, ...d.monat.geld },
        leerstand: {
          frei: d.leerstand.frei.map((e) => ({ einheit: e.einheit, objekt: e.objekt })),
          bald_frei: d.leerstand.bald.map((e) => ({
            einheit: e.einheit,
            objekt: e.objekt,
            frei_ab: e.frei_ab,
          })),
          belegt: d.leerstand.belegt,
          vermietbar: d.leerstand.gesamt,
        },
        automatik: d.automatik.map((a) => ({
          ablauf: laufName(a.name),
          lage: a.lage,
          zuletzt: a.begonnen_am,
        })),
        nicht_gelesen: d.fehler,
      };
    }

    case "vorgaenge_suchen": {
      const status = text(eingabe.status);
      const anzahl = Math.min(Math.max(Number(eingabe.anzahl) || 15, 1), 40);
      return query(
        `SELECT v.id, v.nummer, v.betreff, v.kategorie, v.status, v.heikel,
                v.frist, v.geaendert_am, k.anzeigename AS kontakt, o.name AS objekt,
                (SELECT count(*)::int FROM nachricht n
                  WHERE n.vorgang_id = v.id AND n.status = 'entwurf') AS entwuerfe
           FROM vorgang v
           LEFT JOIN kontakt k ON k.id = v.kontakt_id
           LEFT JOIN objekt o  ON o.id = v.objekt_id
          WHERE ($1::text IS NULL
                 OR v.betreff ILIKE $1 OR k.anzeigename ILIKE $1 OR o.name ILIKE $1)
            AND ($2::text IS NULL OR $2 = 'alle' OR v.status = $2)
          ORDER BY v.geaendert_am DESC
          LIMIT $3`,
        [muster(text(eingabe.suche)), status, anzahl],
      );
    }

    case "vorgang_lesen": {
      const nummer = Number(eingabe.nummer);
      if (!Number.isInteger(nummer)) return { fehler: "Keine gültige Nummer." };
      const [kopf] = await query<{ id: string }>(
        `SELECT v.id, v.nummer, v.betreff, v.kategorie, v.status, v.heikel, v.frist,
                v.angelegt_am, k.anzeigename AS kontakt, o.name AS objekt,
                e.bezeichnung AS einheit
           FROM vorgang v
           LEFT JOIN kontakt k ON k.id = v.kontakt_id
           LEFT JOIN objekt o  ON o.id = v.objekt_id
           LEFT JOIN einheit e ON e.id = v.einheit_id
          WHERE v.nummer = $1`,
        [nummer],
      );
      if (!kopf) return { fehler: `Vorgang ${nummer} gibt es nicht.` };
      const nachrichten = await query(
        `SELECT richtung, status, coalesce(von_name, von_email) AS von, an_emails AS an,
                betreff, left(koerper_text, 1500) AS text,
                coalesce(empfangen_am, gesendet_am, angelegt_am) AS zeit
           FROM nachricht
          WHERE vorgang_id = $1 AND status <> 'verworfen'
          ORDER BY coalesce(empfangen_am, gesendet_am, angelegt_am)
          LIMIT 12`,
        [kopf.id],
      );
      return { ...kopf, nachrichten };
    }

    case "mieter_suchen": {
      const ehemalige = eingabe.auch_ehemalige === true;
      return query(
        `SELECT m.id AS mietverhaeltnis_id, k.anzeigename AS mieter,
                e.id AS einheit_id, e.bezeichnung AS einheit, o.name AS objekt,
                m.beginn, m.ende, m.kaltmiete, m.nebenkosten, m.gesamtmiete,
                m.kaution, k.telefon,
                (SELECT string_agg(ke.email, ', ') FROM kontakt_email ke
                  WHERE ke.kontakt_id = k.id) AS email
           FROM mietverhaeltnis m
           JOIN kontakt k ON k.id = m.kontakt_id
           JOIN einheit e ON e.id = m.einheit_id
           JOIN objekt o  ON o.id = e.objekt_id
          WHERE ($2 OR m.ende IS NULL OR m.ende >= current_date)
            AND ($1::text IS NULL
                 OR k.anzeigename ILIKE $1 OR e.bezeichnung ILIKE $1 OR o.name ILIKE $1)
          ORDER BY o.name, e.bezeichnung, m.beginn DESC
          LIMIT 60`,
        [muster(text(eingabe.suche)), ehemalige],
      );
    }

    case "rueckstaende": {
      const stand = await mahnstand(new Date(), null);
      return stand
        .filter((r) => r.offen >= 1 || r.offen_ohne_daten >= 1)
        .map((r) => ({
          mietverhaeltnis_id: r.mietverhaeltnis_id,
          mieter: r.kontakt_name,
          einheit: r.einheit,
          offen: r.offen,
          monatsmiete: r.monatsmiete,
          aeltester_offener_monat: r.aeltester_monat,
          tage_ueberfaellig: r.tage_ueberfaellig,
          stufe: r.stufe,
          ohne_kontoauszug: r.offen_ohne_daten,
        }));
    }

    case "einheiten": {
      return query(
        `SELECT e.id, e.bezeichnung, e.etage, e.art, o.name AS objekt, e.flaeche_qm,
                e.vermarktung, e.verfuegbar_ab, e.angebot_kaltmiete, e.angebot_nebenkosten,
                lauf.mieter, lauf.mietende
           FROM einheit e
           JOIN objekt o ON o.id = e.objekt_id
           LEFT JOIN LATERAL (
             SELECT k.anzeigename AS mieter, m.ende AS mietende
               FROM mietverhaeltnis m
               JOIN kontakt k ON k.id = m.kontakt_id
              WHERE m.einheit_id = e.id
                AND m.beginn <= current_date
                AND (m.ende IS NULL OR m.ende >= current_date)
              ORDER BY m.beginn DESC
              LIMIT 1) lauf ON true
          WHERE ($1::text IS NULL OR o.name ILIKE $1)
          ORDER BY o.name, e.bezeichnung
          LIMIT 150`,
        [muster(text(eingabe.objekt))],
      );
    }

    case "vorgang_vorschlagen": {
      const entwurf = normalisiere(eingabe, await ladeAuswahl(), { vonKi: true });
      if (!entwurf.betreff) return { fehler: "Ein Vorschlag braucht einen Betreff." };
      const k = await findeKontakt(entwurf.kontakt_name, entwurf.kontakt_email).catch(() => null);
      if (k) {
        entwurf.kontakt_id = k.id;
        entwurf.kontakt_name = k.anzeigename;
        if (!entwurf.kontakt_email && k.email) entwurf.kontakt_email = k.email;
      }
      vorschlaege.push(entwurf);
      return {
        ok: true,
        angezeigt: "Der Vorschlag steht als Karte unter deiner Antwort. Angelegt " +
          "wird er erst, wenn Stephan dort auf „Prüfen und anlegen“ klickt.",
        kontakt_gefunden: Boolean(k),
      };
    }

    default:
      return { fehler: `Unbekanntes Werkzeug: ${name}` };
  }
}

// ---------------------------------------------------------------------------
// Das Gespraech
// ---------------------------------------------------------------------------

export function systemprompt(lage: {
  heute: string;
  mandant: string;
  objekt: { id: string; name: string } | null;
}): string {
  return [
    `Du bist der Assistent in der Hausverwaltung von ${lage.mandant}.`,
    "Du hilfst Stephan Hofmann, den Bestand zu überblicken und Arbeit vorzubereiten.",
    `Heute ist ${lage.heute}.`,
    lage.objekt
      ? `In der Verwaltung ist gerade das Objekt „${lage.objekt.name}“ gewählt (ID ${lage.objekt.id}). ` +
        "Beziehe dich darauf, wenn die Frage nichts anderes sagt."
      : "In der Verwaltung sind gerade alle Objekte gewählt.",
    "",
    "So arbeitest du:",
    "- Antworte auf Deutsch, kurz und klar, wie ein guter Assistent — nicht wie eine Software.",
    "  Keine Tabellen-, Spalten- oder Werkzeugnamen in der Antwort.",
    "- Hole Fakten immer mit den Werkzeugen. Erfinde nichts. Steht etwas nicht in den",
    "  Daten, sag das in einem Satz.",
    "- Du änderst nichts und schickst nichts. Soll etwas angestoßen werden, schlägst du",
    "  mit vorgang_vorschlagen einen Vorgang vor; Stephan legt ihn selbst an, gesendet",
    "  wird erst nach seiner Freigabe.",
    "- Für Mahnwesen und Behördenpost formulierst du keine Schreiben, die rausgehen.",
    "- Verlinke, was du nennst, als Markdown-Link mit relativem Pfad:",
    "  Vorgang → [Vorgang 0006](/vorgang/ID), Mieter → [Name](/mietverhaeltnis/ID),",
    "  Einheit → [Bezeichnung](/einheit/ID), Objekt → [Name](/objekt/ID).",
    "  Seiten: /cockpit, /mietenbuch, /mahnwesen (Rückstände), /zahlungen, /belege, /konten.",
    "- Beträge wie 1.234,56 €, Daten wie 27.11.2026. Wichtige Zahlen **fett**.",
    "- Form: kurze Absätze und Listen mit „- “. Für Abschnitte eine fett gesetzte Zeile",
    "  (z. B. **Rückstände**). Keine Emojis, keine Trennlinien, keine Überschriften mit #.",
    "- Beginne direkt mit dem Wichtigsten, ohne Einleitung wie „Hier ist die Lage“.",
    "- Rechtliche Fragen: Orientierung geben und sagen, dass es keine Rechtsberatung ist.",
  ].join("\n");
}

/**
 * Aus dem Verlauf der Oberflaeche wird ein gueltiger Verlauf fuer die
 * Schnittstelle: beginnt beim Nutzer, wechselt sich ab, ist begrenzt.
 */
export function verlaufFuerModell(verlauf: Gespraechsschritt[]): ModellNachricht[] {
  const aus: ModellNachricht[] = [];
  for (const s of verlauf.slice(-VERLAUF_MAX)) {
    const inhalt = (s.text ?? "").toString().trim().slice(0, NACHRICHT_MAX);
    if (!inhalt) continue;
    const role = s.rolle === "assistent" ? "assistant" : "user";
    if (aus.length === 0 && role === "assistant") continue;
    const letzte = aus[aus.length - 1];
    if (letzte && letzte.role === role) {
      letzte.content = `${letzte.content as string}\n\n${inhalt}`;
    } else {
      aus.push({ role, content: inhalt });
    }
  }
  // Die letzte Nachricht muss vom Nutzer sein -- sonst gibt es nichts zu beantworten.
  while (aus.length > 0 && aus[aus.length - 1].role !== "user") aus.pop();
  return aus;
}

export type AssistentErgebnis =
  | { ok: true; text: string; vorschlaege: VorgangEntwurf[]; schritte: string[] }
  | { ok: false; fehler: string };

export async function beantworte(
  verlauf: Gespraechsschritt[],
  opts: {
    heute?: Date;
    mandant: string;
    objekt: { id: string; name: string } | null;
    holen?: Holer;
    schluessel?: string | null;
    ausfuehren?: typeof fuehreAus;
  },
): Promise<AssistentErgebnis> {
  const nachrichten = verlaufFuerModell(verlauf);
  if (nachrichten.length === 0) return { ok: false, fehler: "Keine Frage gestellt." };

  const ausfuehren = opts.ausfuehren ?? fuehreAus;
  const heute = new Intl.DateTimeFormat("de-DE", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(opts.heute ?? new Date());
  const system = systemprompt({ heute, mandant: opts.mandant, objekt: opts.objekt });
  const vorschlaege: VorgangEntwurf[] = [];
  const schritte: string[] = [];
  let zwischentext = "";

  for (let runde = 0; runde < RUNDEN; runde++) {
    const antwort = await frageModell({
      system,
      nachrichten,
      werkzeuge: WERKZEUGE,
      maxTokens: 1500,
      holen: opts.holen,
      schluessel: opts.schluessel,
    });
    if (!antwort.ok) return { ok: false, fehler: antwort.fehler };

    const aufrufe = antwort.inhalt.filter(
      (b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use",
    );
    const satz = textAus(antwort.inhalt);
    if (aufrufe.length === 0 || antwort.stopp !== "tool_use") {
      return {
        ok: true,
        text: satz || zwischentext || "Dazu habe ich keine Antwort gefunden.",
        vorschlaege,
        schritte,
      };
    }
    if (satz) zwischentext = satz;

    nachrichten.push({ role: "assistant", content: antwort.inhalt });
    const ergebnisse: Block[] = [];
    for (const a of aufrufe) {
      schritte.push(a.name);
      try {
        const wert = await ausfuehren(a.name, a.input ?? {}, vorschlaege);
        ergebnisse.push({
          type: "tool_result",
          tool_use_id: a.id,
          content: JSON.stringify(wert ?? null).slice(0, 24000),
        });
      } catch (e) {
        ergebnisse.push({
          type: "tool_result",
          tool_use_id: a.id,
          content: `Fehler beim Lesen: ${(e as Error).message}`,
          is_error: true,
        });
      }
    }
    nachrichten.push({ role: "user", content: ergebnisse });
  }

  return {
    ok: true,
    text:
      (zwischentext ? zwischentext + "\n\n" : "") +
      "Für diese Frage hätte ich mehr nachschlagen müssen, als hier vorgesehen ist. " +
      "Frag gern genauer.",
    vorschlaege,
    schritte,
  };
}
