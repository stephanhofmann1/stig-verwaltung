import { one, query } from "./db";
import { erstelleEntwurf } from "./versand";
import { istPortal, waLink } from "./nachfassen";
import type { Kategorie } from "./typen";

/**
 * Der Agent schreibt Antworten vor. Er versendet nie.
 *
 * Zwei Stufen:
 *   1. Regelwerk — deckt die wiederkehrenden Fälle sicher ab und kommt
 *      ohne Sprachmodell aus. Läuft auch, wenn die API nicht erreichbar ist.
 *   2. Sprachmodell — übernimmt, sobald ein Schlüssel hinterlegt ist, und
 *      formuliert freier. Die Leitplanken darunter bleiben dieselben.
 *
 * Leitplanken, die in beiden Stufen gelten:
 *   - Heikle Vorgänge (Mahnwesen, Behörde) bekommen nie einen Entwurf.
 *   - Keine Zusagen zu Preis, Termin oder Verfügbarkeit ohne Deckung.
 *   - Bei Unsicherheit lieber nichts schreiben als etwas Falsches.
 */

const UNTERSCHRIFT = `Beste Grüße
Stephan Hofmann
STIG Immobilien eGbR`;

export interface AgentErgebnis {
  vorgang_id: string;
  referenz: string;
  entwurf: boolean;
  nachricht_id?: string;
  grund?: string;
  quelle?: "regel" | "modell";
}

interface Fall {
  vorgang_id: string;
  referenz: string;
  kategorie: Kategorie;
  heikel: boolean;
  herkunft: string;
  betreff: string;
  nachricht_id: string;
  von_name: string | null;
  von_email: string;
  koerper_text: string;
}

/** Vorgänge mit eingegangener, aber noch unbeantworteter Nachricht. */
export async function offeneFaelle(): Promise<Fall[]> {
  return query<Fall>(`
    SELECT v.id AS vorgang_id, v.referenz, v.kategorie, v.heikel, v.herkunft,
           v.betreff, n.id AS nachricht_id, n.von_name, n.von_email,
           n.koerper_text
      FROM vorgang v
      JOIN LATERAL (
            SELECT id, von_name, von_email, koerper_text
              FROM nachricht
             WHERE vorgang_id = v.id AND richtung = 'ein'
             ORDER BY angelegt_am DESC LIMIT 1) n ON true
     WHERE v.status = 'offen'
       AND NOT EXISTS (
             SELECT 1 FROM nachricht a
              WHERE a.vorgang_id = v.id
                AND a.richtung = 'aus'
                AND a.status IN ('entwurf','gesendet'))
     ORDER BY v.geaendert_am ASC
     LIMIT 50
  `);
}

function vorname(name: string | null, email: string): string {
  const n = (name ?? "").trim();
  if (n && !n.includes("@")) return n.split(/\s+/)[0];
  return email.split("@")[0];
}

/** Stufe 1: Regelwerk. Gibt null zurück, wenn kein Muster sicher passt. */
export function regelEntwurf(f: Fall): { text: string; notiz: string } | null {
  const anrede = vorname(f.von_name, f.von_email);

  switch (f.kategorie) {
    case "interessent": {
      const link = waLink(f.referenz);
      return {
        text: `Hallo ${anrede},

vielen Dank für Ihre Anfrage zur Westanlage 9.

Welches Zimmer aktuell frei ist und ab wann, sehen Sie jederzeit auf westanlage9.de. Gern schicke ich Ihnen Fotos und den Grundriss zur passenden Einheit.

Am schnellsten geht es per WhatsApp — dort kann ich Ihnen Unterlagen direkt senden und offene Fragen sofort klären:
${link}

Schreiben Sie mir kurz, ab wann Sie einziehen möchten und ob Sie möbliert oder unmöbliert suchen.

${UNTERSCHRIFT}

Vorgang ${f.referenz}`,
        notiz:
          "Standardantwort auf Interessentenanfrage. Bewusst ohne Zusage zu Zimmer, Preis oder Termin — das steht auf der Website und ändert sich laufend.",
      };
    }

    case "handwerker":
      return {
        text: `Guten Tag ${anrede},

vielen Dank für Ihre Nachricht.

Ich schaue mir das an und melde mich mit einer Rückmeldung bei Ihnen.

${UNTERSCHRIFT}

Vorgang ${f.referenz}`,
        notiz:
          "Nur Eingangsbestätigung. Zu Angebot, Preis und Terminen äußert sich der Agent nicht — bitte selbst ergänzen.",
      };

    case "mieter":
      return {
        text: `Hallo ${anrede},

danke für deine Nachricht — ist angekommen.

Ich kümmere mich darum und melde mich, sobald ich mehr sagen kann.

${UNTERSCHRIFT}

Vorgang ${f.referenz}`,
        notiz:
          "Eingangsbestätigung an Mieter. Kein Lösungsversprechen und keine Frist zugesagt.",
      };

    case "rechnung":
      return {
        text: `Guten Tag ${anrede},

vielen Dank, die Rechnung ist bei uns eingegangen und wird geprüft.

${UNTERSCHRIFT}

Vorgang ${f.referenz}`,
        notiz:
          "Eingangsbestätigung. Keine Zahlungszusage und kein Zahlungsziel genannt.",
      };

    // werbung, sonstige, mahnwesen, behoerde: bewusst kein Entwurf
    default:
      return null;
  }
}

/** Stufe 2: Sprachmodell, sofern ein Schlüssel hinterlegt ist. */
async function modellEntwurf(
  f: Fall,
): Promise<{ text: string; notiz: string } | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;

  const anweisung = `Du schreibst eine Antwortmail für die Hausverwaltung STIG Immobilien eGbR (Westanlage 9 in Gießen, Welserstraße 10 in Ludwigshafen).

Regeln, die du nie brichst:
- Keine Zusagen zu Preisen, Terminen, Verfügbarkeiten oder Zahlungen.
- Keine rechtlichen Erklärungen, keine Fristen, keine Mahnungen.
- Wenn du etwas nicht sicher weißt, schreibst du es nicht.
- Deutsch, höflich, knapp. Mieter werden geduzt, Geschäftspartner gesiezt.
- Schließe mit:
${UNTERSCHRIFT}

Vorgang ${f.referenz}

Antworte ausschließlich mit dem Mailtext, ohne Betreff und ohne Erklärungen.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.AGENT_MODELL ?? "claude-sonnet-4-6",
        max_tokens: 900,
        system: anweisung,
        messages: [
          {
            role: "user",
            content: `Kategorie: ${f.kategorie}\nBetreff: ${f.betreff}\nAbsender: ${f.von_name ?? f.von_email}\n\nNachricht:\n${f.koerper_text.slice(0, 4000)}`,
          },
        ],
      }),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = (d.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("")
      .trim();
    if (text.length < 40) return null;
    return {
      text,
      notiz: "Vom Sprachmodell formuliert. Bitte vor dem Senden gegenlesen.",
    };
  } catch {
    return null;
  }
}

export async function bearbeite(f: Fall): Promise<AgentErgebnis> {
  if (f.heikel) {
    return {
      vorgang_id: f.vorgang_id,
      referenz: f.referenz,
      entwurf: false,
      grund: "Heikler Vorgang — hier schreibt der Agent grundsätzlich nichts vor.",
    };
  }
  if (f.kategorie === "werbung") {
    await query(`UPDATE vorgang SET status = 'erledigt' WHERE id = $1`, [
      f.vorgang_id,
    ]);
    return {
      vorgang_id: f.vorgang_id,
      referenz: f.referenz,
      entwurf: false,
      grund: "Als Werbung eingeordnet und geschlossen.",
    };
  }

  const regel = regelEntwurf(f);
  const modell = regel ? null : await modellEntwurf(f);
  const gewaehlt = regel ?? modell;

  if (!gewaehlt) {
    return {
      vorgang_id: f.vorgang_id,
      referenz: f.referenz,
      entwurf: false,
      grund: "Kein sicheres Muster erkannt — bitte selbst beantworten.",
    };
  }

  const { nachricht_id } = await erstelleEntwurf({
    vorgangId: f.vorgang_id,
    antwortAufNachrichtId: f.nachricht_id,
    koerper: gewaehlt.text,
    verfasstVon: "agent",
    agentNotiz: gewaehlt.notiz,
  });

  // Portalvorgänge kann die Plattform nicht selbst versenden.
  if (istPortal(f.herkunft)) {
    await query(
      `UPDATE nachricht SET versandweg = 'zum_kopieren' WHERE id = $1`,
      [nachricht_id],
    );
  }

  // Interessenten bekommen den Kanalwechsel samt Nachfassen.
  if (f.kategorie === "interessent") {
    await query(
      `UPDATE vorgang
          SET kanalwechsel = CASE WHEN kanalwechsel = 'nicht_noetig'
                                  THEN 'offen' ELSE kanalwechsel END,
              naechste_nachfassung = COALESCE(naechste_nachfassung,
                                              now() + interval '3 days')
        WHERE id = $1`,
      [f.vorgang_id],
    );
  }

  return {
    vorgang_id: f.vorgang_id,
    referenz: f.referenz,
    entwurf: true,
    nachricht_id,
    quelle: regel ? "regel" : "modell",
  };
}

export async function laufAgent() {
  const faelle = await offeneFaelle();
  const ergebnisse: AgentErgebnis[] = [];
  for (const f of faelle) ergebnisse.push(await bearbeite(f));
  return {
    geprueft: faelle.length,
    entwuerfe: ergebnisse.filter((e) => e.entwurf).length,
    ergebnisse,
  };
}

/** Einzelnen Vorgang erneut durch den Agenten schicken. */
export async function bearbeiteVorgang(
  vorgangId: string,
): Promise<AgentErgebnis | null> {
  const f = await one<Fall>(
    `SELECT v.id AS vorgang_id, v.referenz, v.kategorie, v.heikel, v.herkunft,
            v.betreff, n.id AS nachricht_id, n.von_name, n.von_email,
            n.koerper_text
       FROM vorgang v
       JOIN LATERAL (
             SELECT id, von_name, von_email, koerper_text
               FROM nachricht
              WHERE vorgang_id = v.id AND richtung = 'ein'
              ORDER BY angelegt_am DESC LIMIT 1) n ON true
      WHERE v.id = $1`,
    [vorgangId],
  );
  if (!f) return null;
  return bearbeite(f);
}
