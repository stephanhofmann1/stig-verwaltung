import { tx, one } from "./db";
import type { Nachricht } from "./typen";
import {
  alsResendAnhaenge,
  alsSmtpAnhaenge,
  anhaengeZu,
  leseInhalt,
  pruefePaket,
  type AnhangNutzlast,
} from "./anhaenge";

const ABSENDER =
  process.env.ABSENDER_EMAIL ?? "verwaltung@stig-immobilien.de";
const ABSENDER_NAME = process.env.ABSENDER_NAME ?? "STIG Immobilien";
const MAIL_DOMAIN = ABSENDER.split("@")[1] ?? "stig-immobilien.de";

/**
 * Die stille Kopie jeder ausgehenden Mail.
 *
 * WOFÜR
 *
 * Am 07.11.2026 ging eine Antwort an einen Handwerker hinaus, und der
 * Absender konnte nicht feststellen, ob sie wirklich draußen war: Das
 * Portal sagte "gesendet", sein Postfach zeigte nichts, und nachsehen
 * liess sich das nur im Dienstleister-Protokoll. Eine Zustellung, die
 * man nur in einem Fremdsystem nachvollziehen kann, ist für den
 * Absender keine.
 *
 * WARUM BCC UND NICHT CC
 *
 * CC zeigt dem Empfänger die Kopie. Ein Handwerker, der eine Mail von
 * der Verwaltung bekommt und den Eigentümer sichtbar in Kopie sieht,
 * liest daraus etwas hinein -- und die private Adresse steht dann in
 * jedem Postfach und jedem Weiterleitungsverlauf. Die Kopie dient dem
 * Nachvollziehen, nicht der Mitteilung; BCC genügt dafür und verrät
 * nichts.
 *
 * WARUM NICHT DIE EINGANGSADRESSE
 *
 * Eine Kopie an eine Adresse, die ihrerseits in das Portal einliefert
 * (der Cloudflare-Worker auf STIGIMMO@gmx.de), würde jede ausgehende
 * Mail als neue eingehende wieder hereinholen. Darum trägt
 * VERSAND_KOPIE eine Adresse, die NICHT einliefert, und der Absender
 * selbst wird als Kopieempfänger abgewiesen.
 *
 * WARUM LAGEBERICHT_AN ALS RÜCKFALL
 *
 * Weil die Kopie sonst eine Einstellung bräuchte, die jemand erst auf
 * dem Server einträgt -- und bis dahin wäre die Zustellung weiter nicht
 * nachvollziehbar, also genau das Problem, um das es geht. Unter
 * LAGEBERICHT_AN steht schon die Adresse, an die das Portal täglich
 * seinen Lagebericht schickt: die Person, die dieses System betreibt.
 * Wer eine andere Adresse will, setzt VERSAND_KOPIE. Wer gar keine
 * Kopie will, setzt dort etwas ohne "@" -- "aus" etwa: Was keine
 * Adresse ist, wird unten ohnehin abgewiesen, und ein eigener
 * Sonderfall dafür wäre ein Zweig, den kein Test widerlegen kann.
 */
const KOPIE =
  (process.env.VERSAND_KOPIE ?? "").trim() ||
  (process.env.LAGEBERICHT_AN ?? "").trim();

/**
 * Die Adresse der stillen Kopie, oder leer.
 *
 * Die eigene Absenderadresse wird abgewiesen: Eine Mail an sich selbst
 * ist keine Bestätigung, und bei Resend wäre sie zusätzlich ein Weg,
 * den eigenen Zustellruf zu verfälschen.
 */
export function stilleKopie(
  an: string[] = [],
  cc: string[] = [],
): string[] {
  if (!KOPIE || !KOPIE.includes("@")) return [];
  const klein = KOPIE.toLowerCase();
  if (klein === ABSENDER.toLowerCase()) return [];
  // Steht die Adresse schon offen in An oder CC, braucht es keine
  // zweite, verdeckte Zustellung derselben Mail.
  const schon = [...an, ...cc].some((e) => e.toLowerCase() === klein);
  return schon ? [] : [KOPIE];
}

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
 * Baut das Zitat der Nachricht, auf die geantwortet wird.
 *
 * Warum überhaupt: Ohne Zitat geht beim Empfänger nur der neue Text ein.
 * Die Thread-Kopfzeilen sortieren die Mail zwar in den richtigen Strang,
 * aber wer sie einzeln öffnet, weiterleitet oder ausdruckt — und bei einer
 * Abrechnung mit Ausschlussfrist tut das irgendwann jemand — sieht eine
 * Antwort ohne Frage.
 *
 * Verschachtelung entsteht von selbst: Trägt die Elternnachricht schon ein
 * Zitat, bekommt deren ">" ein weiteres davor und wird zu ">>". Deshalb
 * wird hier nichts über Ebenen gerechnet.
 *
 * Reine Funktion ohne Datenbank: Was wörtlich an einen Dritten hinausgeht,
 * muss ohne Server prüfbar sein.
 */
export function zitiere(eltern: {
  von_name?: string | null;
  von_email: string;
  koerper_text?: string | null;
  gesendet_am?: string | null;
  empfangen_am?: string | null;
  angelegt_am?: string | null;
}): string {
  const text = (eltern.koerper_text ?? "").replace(/\s+$/, "");
  // Nichts zu zitieren ist kein Fehler -- eine leere Zeile "schrieb:" ohne
  // Inhalt waere schlechter als gar kein Zitat.
  if (!text) return "";

  const wer = eltern.von_name?.trim()
    ? `${eltern.von_name.trim()} <${eltern.von_email}>`
    : eltern.von_email;

  const roh = eltern.gesendet_am ?? eltern.empfangen_am ?? eltern.angelegt_am;
  const d = roh ? new Date(roh) : null;
  const gueltig = d && !Number.isNaN(d.getTime());

  // Feste Zeitzone: Der Server läuft in UTC, gelesen wird die Mail in
  // Deutschland. Ohne Angabe stünde im Zitat eine Uhrzeit, die niemand
  // wiedererkennt.
  const kopf = gueltig
    ? `Am ${new Intl.DateTimeFormat("de-DE", {
        timeZone: "Europe/Berlin",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }).format(d)} um ${new Intl.DateTimeFormat("de-DE", {
        timeZone: "Europe/Berlin",
        hour: "2-digit",
        minute: "2-digit",
      }).format(d)} schrieb ${wer}:`
    : `${wer} schrieb:`;

  const zeilen = text
    .split(/\r?\n/)
    .map((z) => (z.startsWith(">") ? `>${z}` : `> ${z}`))
    .join("\n");

  return `\n\n${kopf}\n\n${zeilen}`;
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

  // Das Zitat entsteht beim Anlegen, nicht beim Versand: In der Freigabe
  // soll woertlich stehen, was den Empfaenger erreicht. Ein Entwurf, der
  // weniger zeigt als die Mail enthaelt, ist dieselbe Art Luege wie ein
  // Status "gesendet" ohne Versand.
  const koerper = opts.koerper.replace(/\s+$/, "") + zitiere(bezug);
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
        koerper,
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
  /** Wohin die stille Kopie ging -- damit man dort nachsehen kann. */
  stille_kopie?: string[];
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

  // Die Anhänge werden VOR dem Versand geladen und geprüft, nicht
  // unterwegs. Zwei Gründe, und beide sind derselbe:
  //
  //   Eine Datei, die nicht mehr auf der Platte liegt, soll den Versand
  //   verhindern und nicht halb durchlassen. Eine Mail, bei der drei von
  //   sieben Bildern fehlen, ist schlimmer als eine, die nicht hinausgeht
  //   -- beim Empfänger sieht sie vollständig aus.
  //
  //   Die Größenprüfung muss greifen, bevor irgendetwas gesendet ist.
  //   Danach steht der Entwurf auf 'gesendet' und die Ablehnung des
  //   Gegenservers landet in einem anderen Postfach (siehe
  //   lib/anhaenge.ts, GRENZE_PAKET_BYTES).
  let nutzlast: AnhangNutzlast[] = [];
  const zeilen = await anhaengeZu(n.id);
  if (zeilen.length > 0) {
    const paket = pruefePaket(zeilen.map((z) => Number(z.groesse_bytes)));
    if (!paket.ok) return { ok: false, fehler: paket.fehler };

    try {
      nutzlast = await Promise.all(
        zeilen.map(async (z) => {
          const voll = await one<{ ablage_pfad: string }>(
            `SELECT ablage_pfad FROM nachricht_anhang WHERE id = $1`,
            [z.id],
          );
          if (!voll) throw new Error(`Anhang ${z.dateiname} nicht gefunden`);
          return { dateiname: z.dateiname, inhalt: await leseInhalt(voll.ablage_pfad) };
        }),
      );
    } catch (e) {
      return {
        ok: false,
        fehler: `Anhang nicht lesbar, nichts gesendet: ${(e as Error).message}`,
      };
    }
  }

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
      const bcc = stilleKopie(n.an_emails, n.cc_emails);
      await transport.sendMail({
        from: `${ABSENDER_NAME} <${ABSENDER}>`,
        to: n.an_emails,
        cc: n.cc_emails.length ? n.cc_emails : undefined,
        // Dieselbe stille Kopie wie im Resend-Zweig. Trüge sie nur ein
        // Weg, hinge die Nachvollziehbarkeit daran, welcher Weg gerade
        // konfiguriert ist.
        bcc: bcc.length ? bcc : undefined,
        subject: n.betreff,
        text: n.koerper_text,
        messageId,
        inReplyTo: n.in_reply_to ?? undefined,
        references: n.referenzen.length ? n.referenzen : undefined,
        // Derselbe Satz Dateien wie im Resend-Zweig, nur in der Form, die
        // nodemailer erwartet. Die beiden Umwandlungen stehen in
        // lib/anhaenge.ts nebeneinander und werden im Test gegeneinander
        // geprüft -- damit nicht ein Weg Anhänge trägt und der andere nicht.
        attachments: nutzlast.length ? alsSmtpAnhaenge(nutzlast) : undefined,
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
        // Siehe stilleKopie(): derselbe Satz Empfänger wie im
        // SMTP-Zweig.
        ...(stilleKopie(n.an_emails, n.cc_emails).length
          ? { bcc: stilleKopie(n.an_emails, n.cc_emails) }
          : {}),
        subject: n.betreff,
        text: n.koerper_text,
        ...(nutzlast.length
          ? { attachments: alsResendAnhaenge(nutzlast) }
          : {}),
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
      // Die stille Kopie wird mitprotokolliert. Eine verdeckte Zustellung,
      // von der auch im Protokoll nichts steht, waere eine verdeckte
      // Zustellung im schlechten Sinn.
      [
        n.vorgang_id,
        nachrichtId,
        JSON.stringify({
          versandweg: weg,
          ...(stilleKopie(n.an_emails, n.cc_emails).length
            ? { stille_kopie: stilleKopie(n.an_emails, n.cc_emails) }
            : {}),
        }),
      ],
    );
  });

  return {
    ok: true,
    message_id: messageId,
    // Der Aufrufer soll sagen koennen, wohin die Kopie ging -- sonst
    // weiss der Mensch am Knopf weiterhin nicht, wo er nachsehen kann.
    ...(stilleKopie(n.an_emails, n.cc_emails).length
      ? { stille_kopie: stilleKopie(n.an_emails, n.cc_emails) }
      : {}),
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
