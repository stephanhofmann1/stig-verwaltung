import { query, one, tx } from "./db";
import { erstelleEntwurf } from "./versand";

/** Höchstens zwei Nachfassversuche, dann ist Schluss. */
export const MAX_NACHFASS = 2;
/** Abstand zwischen den Versuchen. */
export const ABSTAND_TAGE = [3, 5];

const PORTALE = new Set(["kleinanzeigen", "wg_gesucht"]);

export function istPortal(herkunft: string) {
  return PORTALE.has(herkunft);
}

const HERKUNFT_LABEL: Record<string, string> = {
  kleinanzeigen: "Kleinanzeigen",
  wg_gesucht: "WG-Gesucht",
  email: "E-Mail",
  whatsapp: "WhatsApp",
  telefon: "Telefon",
  sonstige: "Sonstige",
};

/**
 * Markiert einen Vorgang als Lead, bei dem der Wechsel nach WhatsApp
 * noch aussteht, und setzt die erste Nachfassung.
 */
export async function starteKanalwechsel(vorgangId: string, herkunft: string) {
  await query(
    `UPDATE vorgang
        SET herkunft = $2,
            kanalwechsel = 'offen',
            nachfass_anzahl = 0,
            letzter_kontakt_am = COALESCE(letzter_kontakt_am, now()),
            naechste_nachfassung = now() + ($3 || ' days')::interval
      WHERE id = $1`,
    [vorgangId, herkunft, ABSTAND_TAGE[0]],
  );
}

export interface Faellig {
  id: string;
  nummer: number;
  referenz: string;
  betreff: string;
  herkunft: string;
  nachfass_anzahl: number;
  kontakt_name: string | null;
}

/** Leads, bei denen heute nachgefasst werden sollte. */
export async function faelligeNachfassungen(): Promise<Faellig[]> {
  return query<Faellig>(
    `SELECT v.id, v.nummer, v.referenz, v.betreff, v.herkunft,
            v.nachfass_anzahl, k.anzeigename AS kontakt_name
       FROM vorgang v
       LEFT JOIN kontakt k ON k.id = v.kontakt_id
      WHERE v.kanalwechsel = 'offen'
        AND v.status <> 'erledigt'
        AND v.nachfass_anzahl < $1
        AND v.naechste_nachfassung IS NOT NULL
        AND v.naechste_nachfassung <= now()
      ORDER BY v.naechste_nachfassung ASC`,
    [MAX_NACHFASS],
  );
}

/** Der Text, den der Interessent bekommt. Kurz, ohne Druck. */
export function nachfassText(opts: {
  anrede: string;
  versuch: number;
  referenz: string;
  waLink: string;
}): string {
  const { anrede, versuch, referenz, waLink } = opts;

  if (versuch === 1) {
    return `Hallo ${anrede},

ich wollte kurz nachhaken — meine Nachricht zum Zimmer ist vielleicht untergegangen.

Am schnellsten erreichen Sie mich über WhatsApp, dort kann ich Ihnen auch Fotos und Unterlagen direkt schicken:
${waLink}

Falls das Zimmer für Sie nicht mehr infrage kommt, sagen Sie gern kurz Bescheid, dann vergebe ich es weiter.

Beste Grüße
Stephan Hofmann
STIG Immobilien

Vorgang ${referenz}`;
  }

  return `Hallo ${anrede},

ich melde mich ein letztes Mal zum Zimmer. Ohne Rückmeldung gehe ich davon aus, dass sich die Sache für Sie erledigt hat, und schließe die Anfrage.

Falls doch noch Interesse besteht:
${waLink}

Beste Grüße
Stephan Hofmann
STIG Immobilien

Vorgang ${referenz}`;
}

/** Baut den wa.me-Link mit vorausgefülltem Text samt Vorgangsreferenz. */
export function waLink(referenz: string): string {
  const nummer = (process.env.WHATSAPP_NUMMER ?? "4915100000000").replace(
    /\D/g,
    "",
  );
  const text = encodeURIComponent(
    `Hallo, ich melde mich zum Zimmer in der Westanlage 9. Vorgang ${referenz}`,
  );
  return `https://wa.me/${nummer}?text=${text}`;
}

export interface NachfassErgebnis {
  vorgang_id: string;
  referenz: string;
  versuch: number;
  versandweg: "automatisch" | "zum_kopieren";
  nachricht_id: string | null;
  uebersprungen?: string;
}

/**
 * Legt für einen fälligen Lead den Nachfass-Entwurf an.
 * Bei Portalvorgängen als "zum Kopieren", weil dort kein Versand möglich ist.
 */
export async function fasseNach(f: Faellig): Promise<NachfassErgebnis> {
  const versuch = f.nachfass_anzahl + 1;
  const link = waLink(f.referenz);
  const anrede = f.kontakt_name?.split(" ")[0] ?? "zusammen";
  const text = nachfassText({ anrede, versuch, referenz: f.referenz, waLink: link });

  const letzte = await one<{ id: string }>(
    `SELECT id FROM nachricht
      WHERE vorgang_id = $1 AND richtung = 'ein'
      ORDER BY angelegt_am DESC LIMIT 1`,
    [f.id],
  );

  if (!letzte) {
    await query(
      `UPDATE vorgang SET kanalwechsel = 'aufgegeben', naechste_nachfassung = NULL
        WHERE id = $1`,
      [f.id],
    );
    return {
      vorgang_id: f.id,
      referenz: f.referenz,
      versuch,
      versandweg: "automatisch",
      nachricht_id: null,
      uebersprungen: "Keine eingegangene Nachricht als Bezug vorhanden.",
    };
  }

  const portal = istPortal(f.herkunft);
  const { nachricht_id } = await erstelleEntwurf({
    vorgangId: f.id,
    antwortAufNachrichtId: letzte.id,
    koerper: text,
    verfasstVon: "agent",
    agentNotiz: portal
      ? `Nachfassen ${versuch} von ${MAX_NACHFASS}. Herkunft ${HERKUNFT_LABEL[f.herkunft]} — bitte im Portal einfügen, Versand von hier ist nicht möglich.`
      : `Nachfassen ${versuch} von ${MAX_NACHFASS}. Noch kein Wechsel zu WhatsApp.`,
  });

  await tx(async (c) => {
    if (portal) {
      await c.query(
        `UPDATE nachricht SET versandweg = 'zum_kopieren' WHERE id = $1`,
        [nachricht_id],
      );
    }
    const naechsterAbstand = ABSTAND_TAGE[versuch] ?? null;
    await c.query(
      `UPDATE vorgang
          SET nachfass_anzahl = $2::int,
              kanalwechsel = CASE WHEN $2::int >= $4::int
                                  THEN 'aufgegeben' ELSE 'offen' END,
              naechste_nachfassung = CASE
                  WHEN $3::int IS NULL THEN NULL
                  ELSE now() + ($3 || ' days')::interval END
        WHERE id = $1`,
      [f.id, versuch, naechsterAbstand, MAX_NACHFASS],
    );
    await c.query(
      `INSERT INTO protokoll (vorgang_id, nachricht_id, ereignis, details)
       VALUES ($1,$2,'nachfass_entwurf',$3::jsonb)`,
      [
        f.id,
        nachricht_id,
        JSON.stringify({ versuch, herkunft: f.herkunft, portal }),
      ],
    );
  });

  return {
    vorgang_id: f.id,
    referenz: f.referenz,
    versuch,
    versandweg: portal ? "zum_kopieren" : "automatisch",
    nachricht_id,
  };
}

/** Der tägliche Lauf. */
export async function laufNachfassen() {
  const faellig = await faelligeNachfassungen();
  const ergebnisse: NachfassErgebnis[] = [];
  for (const f of faellig) ergebnisse.push(await fasseNach(f));
  return { geprueft: faellig.length, ergebnisse };
}
