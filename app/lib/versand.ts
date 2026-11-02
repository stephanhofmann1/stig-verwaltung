import { tx, one } from "./db";
import type { Nachricht } from "./typen";

const ABSENDER =
  process.env.ABSENDER_EMAIL ?? "verwaltung@stig-immobilien.de";
const ABSENDER_NAME = process.env.ABSENDER_NAME ?? "STIG Immobilien";
const MAIL_DOMAIN = ABSENDER.split("@")[1] ?? "stig-immobilien.de";

/** Erzeugt eine eigene Message-ID im Format <uuid@domain>. */
export function neueMessageId(): string {
  return `<${crypto.randomUUID()}@${MAIL_DOMAIN}>`;
}

/**
 * Baut die Thread-Header für eine Antwort.
 * In-Reply-To = Message-ID der Nachricht, auf die geantwortet wird.
 * References  = deren References plus deren Message-ID.
 * Ohne das reißt der Thread beim Empfänger und jede Antwort erscheint
 * als neue Mail.
 */
export function baueThreadHeader(bezug: {
  message_id: string | null;
  referenzen: string[];
}): { in_reply_to: string | null; referenzen: string[] } {
  if (!bezug.message_id) {
    return { in_reply_to: null, referenzen: bezug.referenzen ?? [] };
  }
  const refs = [...(bezug.referenzen ?? []), bezug.message_id];
  // Doppelte entfernen, Reihenfolge erhalten
  const eindeutig = refs.filter((r, i) => refs.indexOf(r) === i);
  return { in_reply_to: bezug.message_id, referenzen: eindeutig };
}

/**
 * Legt einen Entwurf an, der auf eine eingegangene Nachricht antwortet.
 * Der Entwurf wird NICHT versendet — er landet in der Freigabe-Queue.
 */
export async function erstelleEntwurf(opts: {
  vorgangId: string;
  antwortAufNachrichtId: string;
  betreff?: string;
  koerper: string;
  verfasstVon: "agent" | "mensch";
  agentNotiz?: string | null;
}): Promise<{ nachricht_id: string }> {
  const bezug = await one<Nachricht>(
    `SELECT * FROM nachricht WHERE id = $1`,
    [opts.antwortAufNachrichtId],
  );
  if (!bezug) throw new Error("Bezugsnachricht nicht gefunden");

  const header = baueThreadHeader(bezug);
  const betreff =
    opts.betreff ??
    (/^\s*(re|aw)\s*:/i.test(bezug.betreff)
      ? bezug.betreff
      : `AW: ${bezug.betreff}`);

  // An den Absender zurück; weitere Empfänger der Originalmail in CC,
  // aber niemals die eigene Adresse.
  const an = [bezug.von_email];
  const cc = [...(bezug.an_emails ?? []), ...(bezug.cc_emails ?? [])].filter(
    (e) =>
      e.toLowerCase() !== ABSENDER.toLowerCase() &&
      e.toLowerCase() !== bezug.von_email.toLowerCase(),
  );

  return tx(async (c) => {
    const n = await c.query<{ id: string }>(
      `INSERT INTO nachricht
         (vorgang_id, richtung, status, von_email, von_name, an_emails,
          cc_emails, betreff, koerper_text, in_reply_to, referenzen,
          verfasst_von, agent_notiz)
       VALUES ($1,'aus','entwurf',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id`,
      [
        opts.vorgangId,
        ABSENDER,
        ABSENDER_NAME,
        an,
        Array.from(new Set(cc)),
        betreff,
        opts.koerper,
        header.in_reply_to,
        header.referenzen,
        opts.verfasstVon,
        opts.agentNotiz ?? null,
      ],
    );
    await c.query(
      `INSERT INTO protokoll (vorgang_id, nachricht_id, ereignis, details)
       VALUES ($1,$2,'entwurf_erstellt',$3::jsonb)`,
      [
        opts.vorgangId,
        n.rows[0].id,
        JSON.stringify({ verfasst_von: opts.verfasstVon }),
      ],
    );
    return { nachricht_id: n.rows[0].id };
  });
}

export interface VersandErgebnis {
  ok: boolean;
  message_id?: string;
  fehler?: string;
  /** Nichts hat das System verlassen (nur lokal möglich). */
  trocken?: boolean;
}

export interface Versandentscheidung {
  weg: "resend" | "smtp" | "trocken";
  darfSenden: boolean;
  grund?: string;
}

/**
 * Entscheidet, auf welchem Weg gesendet wird -- und ob überhaupt.
 *
 * Bewusst eine reine Funktion ohne Datenbank: "Darf das raus?" ist die
 * wichtigste Frage im ganzen Versand und muss ohne Server prüfbar sein.
 *
 * Im Trockenmodus verlässt nichts das System. Vorher wurde die Nachricht
 * trotzdem auf 'gesendet' gesetzt -- im Portal stand "gesendet", obwohl
 * niemand etwas erhalten hatte. Ein Status, der lügt, ist schlimmer als
 * ein Fehler: man verlässt sich darauf und merkt erst, dass die Antwort
 * nie ankam, wenn die Frist vorbei ist. Im Betrieb wird deshalb
 * abgewiesen und der Entwurf bleibt ein Entwurf; lokal bleibt der
 * Trockenmodus erlaubt, damit sich der Ablauf ohne Zugangsdaten
 * durchspielen lässt.
 *
 * Ein leer gesetzter Schlüssel ist kein Schlüssel -- "" gilt hier
 * bewusst als fehlend, nicht als vorhanden.
 */
export function entscheideVersandweg(lage: {
  resendKey?: string | null;
  smtpHost?: string | null;
  produktion: boolean;
}): Versandentscheidung {
  if (lage.resendKey) return { weg: "resend", darfSenden: true };
  if (lage.smtpHost) return { weg: "smtp", darfSenden: true };
  if (lage.produktion) {
    return {
      weg: "trocken",
      darfSenden: false,
      grund:
        "Kein Versandweg konfiguriert (RESEND_API_KEY oder SMTP_HOST fehlt) " +
        "— es wurde nichts gesendet, der Entwurf bleibt offen.",
    };
  }
  return { weg: "trocken", darfSenden: true };
}

/**
 * Versendet einen freigegebenen Entwurf.
 *
 * Ohne konfigurierten Versandweg wird im Betrieb abgewiesen, statt die
 * Nachricht fälschlich als gesendet zu markieren -- siehe
 * entscheideVersandweg().
 */
export async function sendeEntwurf(
  nachrichtId: string,
): Promise<VersandErgebnis> {
  const n = await one<Nachricht>(`SELECT * FROM nachricht WHERE id = $1`, [
    nachrichtId,
  ]);
  if (!n) return { ok: false, fehler: "Nachricht nicht gefunden" };
  if (n.status !== "entwurf")
    return { ok: false, fehler: `Status ist "${n.status}", nicht "entwurf"` };

  const messageId = neueMessageId();
  const key = process.env.RESEND_API_KEY;
  const smtpHost = process.env.SMTP_HOST;
  // Resend bevorzugt, SMTP als Rückfallebene, sonst Trockenmodus.
  const entscheidung = entscheideVersandweg({
    resendKey: key,
    smtpHost,
    produktion: process.env.NODE_ENV === "production",
  });
  if (!entscheidung.darfSenden) {
    return { ok: false, fehler: entscheidung.grund };
  }
  const weg = entscheidung.weg;

  if (weg === "smtp") {
    const { createTransport } = await import("nodemailer");
    const transport = createTransport({
      host: smtpHost,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: Number(process.env.SMTP_PORT ?? 587) === 465,
      auth: {
        user: process.env.SMTP_BENUTZER ?? "",
        pass: process.env.SMTP_PASSWORT ?? "",
      },
    });
    try {
      await transport.sendMail({
        from: `${ABSENDER_NAME} <${ABSENDER}>`,
        to: n.an_emails,
        cc: n.cc_emails.length ? n.cc_emails : undefined,
        subject: n.betreff,
        text: n.koerper_text,
        messageId,
        inReplyTo: n.in_reply_to ?? undefined,
        references: n.referenzen.length ? n.referenzen : undefined,
      });
    } catch (e) {
      return { ok: false, fehler: `SMTP: ${(e as Error).message}` };
    }
  }

  if (weg === "resend") {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${ABSENDER_NAME} <${ABSENDER}>`,
        to: n.an_emails,
        cc: n.cc_emails.length ? n.cc_emails : undefined,
        subject: n.betreff,
        text: n.koerper_text,
        headers: {
          "Message-ID": messageId,
          ...(n.in_reply_to ? { "In-Reply-To": n.in_reply_to } : {}),
          ...(n.referenzen.length
            ? { References: n.referenzen.join(" ") }
            : {}),
        },
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, fehler: `Resend ${res.status}: ${text.slice(0, 300)}` };
    }
  }

  await tx(async (c) => {
    await c.query(
      `UPDATE nachricht
          SET status = 'gesendet', gesendet_am = now(), message_id = $2
        WHERE id = $1`,
      [nachrichtId, messageId],
    );
    await c.query(
      `UPDATE vorgang SET status = 'wartet' WHERE id = $1 AND status = 'offen'`,
      [n.vorgang_id],
    );
    await c.query(
      `INSERT INTO protokoll (vorgang_id, nachricht_id, ereignis, details)
       VALUES ($1,$2,'freigegeben_und_gesendet',$3::jsonb)`,
      [n.vorgang_id, nachrichtId, JSON.stringify({ versandweg: weg })],
    );
  });

  return {
    ok: true,
    message_id: messageId,
    ...(weg === "trocken" ? { trocken: true } : {}),
  };
}

export async function verwirfEntwurf(nachrichtId: string) {
  await tx(async (c) => {
    const r = await c.query<{ vorgang_id: string }>(
      `UPDATE nachricht SET status = 'verworfen'
        WHERE id = $1 AND status = 'entwurf'
        RETURNING vorgang_id`,
      [nachrichtId],
    );
    if (r.rows[0]) {
      await c.query(
        `INSERT INTO protokoll (vorgang_id, nachricht_id, ereignis)
         VALUES ($1,$2,'entwurf_verworfen')`,
        [r.rows[0].vorgang_id, nachrichtId],
      );
    }
  });
}

/**
 * Eine einzelne Systemmail — Anmeldelink, Benachrichtigung.
 *
 * Bewusst getrennt von sendeEntwurf: Das hier haengt an keinem Vorgang,
 * braucht keine Freigabe und wird nirgends protokolliert. Ein Anmeldelink
 * ist keine Korrespondenz.
 *
 * Ohne RESEND_API_KEY landet die Mail im Log statt im Postfach. So laesst
 * sich der Ablauf auch ohne Versand testen — und man sieht, was gesendet
 * worden waere.
 */
export async function sendeSystemmail(opts: {
  an: string;
  betreff: string;
  text: string;
}): Promise<{ ok: boolean; fehler?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log(
      `[systemmail] Trockenmodus — an ${opts.an}: ${opts.betreff}\n${opts.text}`,
    );
    return { ok: true };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${ABSENDER_NAME} <${ABSENDER}>`,
      to: [opts.an],
      subject: opts.betreff,
      text: opts.text,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return { ok: false, fehler: `Resend ${res.status}: ${text.slice(0, 200)}` };
  }
  return { ok: true };
}
