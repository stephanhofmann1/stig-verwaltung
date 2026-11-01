import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { one, query } from "./db";
import { verarbeiteEingang, type EingehendeMail } from "./eingang";
import { sichereAnhang, type BelegErgebnis } from "./belege";

/**
 * Holt neue Nachrichten aus dem Postfach.
 *
 * Statt auf einen Webhook zu warten, fragt die Plattform selbst an. Das
 * funktioniert mit jedem Postfach, auch mit GMX, und braucht weder eigene
 * Domain noch Cloudflare. Der Nachteil ist die Zustellbarkeit beim
 * Versand — darum ist das der Start, nicht das Ziel.
 *
 * Fortschritt wird über die IMAP-UID gemerkt. Das ist zuverlässiger als
 * das Gelesen-Kennzeichen, denn wer die Mail nebenbei im Mailprogramm
 * öffnet, soll den Abruf nicht durcheinanderbringen.
 */

export interface AbrufErgebnis {
  geholt: number;
  verarbeitet: number;
  belege: number;
  fehler: string[];
  letzte_uid: number;
  neu_begonnen?: boolean;
}

function zugang() {
  const host = process.env.IMAP_HOST;
  const benutzer = process.env.IMAP_BENUTZER;
  const passwort = process.env.IMAP_PASSWORT;
  if (!host || !benutzer || !passwort) {
    throw new Error(
      "IMAP_HOST, IMAP_BENUTZER und IMAP_PASSWORT müssen gesetzt sein.",
    );
  }
  return {
    host,
    port: Number(process.env.IMAP_PORT ?? 993),
    secure: (process.env.IMAP_TLS ?? "ja") !== "nein",
    auth: { user: benutzer, pass: passwort },
    logger: false as const,
  };
}

/** Wie viele Nachrichten höchstens pro Lauf — schützt vor dem ersten Lauf. */
const HOECHSTENS = Number(process.env.IMAP_STAPEL ?? 50);

export async function ruefeAb(): Promise<AbrufErgebnis> {
  const fach = await one<{
    id: string;
    ordner: string;
    letzte_uid: string;
    uidvalidity: string | null;
  }>(
    `SELECT id, ordner, letzte_uid::text, uidvalidity::text
       FROM postfach WHERE bezeichnung = 'standard' AND aktiv`,
  );
  if (!fach) throw new Error("Kein aktives Postfach eingerichtet.");

  const ergebnis: AbrufErgebnis = {
    geholt: 0,
    verarbeitet: 0,
    belege: 0,
    fehler: [],
    letzte_uid: Number(fach.letzte_uid),
  };

  const client = new ImapFlow(zugang());
  await client.connect();

  try {
    const schloss = await client.getMailboxLock(fach.ordner);
    try {
      const mb = client.mailbox;
      if (!mb || typeof mb === "boolean") {
        throw new Error(`Ordner ${fach.ordner} nicht erreichbar.`);
      }

      const gueltigkeit = Number(mb.uidValidity);
      let ab = Number(fach.letzte_uid);

      // Hat der Anbieter die Gültigkeit gewechselt, sind alle gemerkten
      // UIDs wertlos. Dann wird vom aktuellen Stand neu begonnen, statt
      // das ganze Postfach erneut einzuspielen.
      if (fach.uidvalidity && Number(fach.uidvalidity) !== gueltigkeit) {
        ergebnis.neu_begonnen = true;
        ab = Math.max(0, Number(mb.uidNext) - 1);
      }

      const bereich = `${ab + 1}:*`;
      const nachrichten: Array<{ uid: number; roh: Buffer }> = [];

      for await (const m of client.fetch(
        bereich,
        { uid: true, source: true },
        { uid: true },
      )) {
        // Der Bereich "n:*" liefert immer mindestens eine Nachricht,
        // auch wenn nichts Neues da ist — darum zusätzlich prüfen.
        if (m.uid <= ab) continue;
        nachrichten.push({ uid: m.uid, roh: m.source as Buffer });
        if (nachrichten.length >= HOECHSTENS) break;
      }

      nachrichten.sort((a, b) => a.uid - b.uid);
      ergebnis.geholt = nachrichten.length;

      for (const n of nachrichten) {
        try {
          const p = await simpleParser(n.roh);
          const an = Array.isArray(p.to) ? p.to : p.to ? [p.to] : [];
          const cc = Array.isArray(p.cc) ? p.cc : p.cc ? [p.cc] : [];

          const mail: EingehendeMail = {
            von_email:
              p.from?.value?.[0]?.address ?? "unbekannt@example.invalid",
            von_name: p.from?.value?.[0]?.name ?? null,
            an_emails: an.flatMap((a) =>
              a.value.map((v) => v.address ?? "").filter(Boolean),
            ),
            cc_emails: cc.flatMap((a) =>
              a.value.map((v) => v.address ?? "").filter(Boolean),
            ),
            betreff: p.subject ?? "",
            koerper_text: p.text ?? "",
            message_id: p.messageId ?? null,
            in_reply_to: p.inReplyTo ?? null,
            referenzen: p.references ?? null,
            empfangen_am: p.date?.toISOString() ?? null,
          };

          const r = await verarbeiteEingang(mail);
          ergebnis.verarbeitet++;

          if (r.begruendung !== "Bereits eingeliefert (gleiche Message-ID).") {
            const kontakt = await one<{ kontakt_id: string }>(
              `SELECT kontakt_id FROM kontakt_email WHERE lower(email) = lower($1)`,
              [mail.von_email],
            );
            for (const a of p.attachments ?? []) {
              if (!a.filename) continue;
              const b: BelegErgebnis = await sichereAnhang(
                {
                  dateiname: a.filename,
                  mime_typ: a.contentType ?? null,
                  inhalt_base64: Buffer.from(a.content).toString("base64"),
                },
                {
                  vorgang_id: r.vorgang_id,
                  nachricht_id: r.nachricht_id,
                  kontakt_id: kontakt?.kontakt_id ?? null,
                  betreff: mail.betreff ?? "",
                  koerper: mail.koerper_text ?? "",
                },
              );
              if (b.beleg_id) ergebnis.belege++;
            }
          }

          // Stand nach JEDER Nachricht fortschreiben. Bricht der Lauf ab,
          // geht höchstens die eine verloren, die gerade dran war.
          ergebnis.letzte_uid = n.uid;
          await query(
            `UPDATE postfach SET letzte_uid = $2, uidvalidity = $3 WHERE id = $1`,
            [fach.id, n.uid, gueltigkeit],
          );
        } catch (e) {
          ergebnis.fehler.push(`UID ${n.uid}: ${(e as Error).message}`);
          // Trotz Fehler weiterzählen, sonst hängt der Abruf für immer an
          // einer einzigen kaputten Nachricht fest.
          ergebnis.letzte_uid = n.uid;
          await query(
            `UPDATE postfach SET letzte_uid = $2, uidvalidity = $3 WHERE id = $1`,
            [fach.id, n.uid, gueltigkeit],
          );
        }
      }

      await query(
        `UPDATE postfach
            SET letzter_lauf = now(), uidvalidity = $2,
                letzter_fehler = $3
          WHERE id = $1`,
        [
          fach.id,
          gueltigkeit,
          ergebnis.fehler.length ? ergebnis.fehler.join(" | ").slice(0, 500) : null,
        ],
      );
    } finally {
      schloss.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }

  return ergebnis;
}
