import { tx } from "./db";
import {
  findeVorgangId,
  kontaktFuerEmail,
  ordneEin,
  parseMessageIds,
} from "./einordnung";

export interface EingehendeMail {
  von_email: string;
  von_name?: string | null;
  an_emails: string[];
  cc_emails?: string[];
  betreff: string;
  koerper_text: string;
  message_id?: string | null;
  in_reply_to?: string | null;
  referenzen?: string | string[] | null;
  empfangen_am?: string | null;
}

export interface EingangErgebnis {
  vorgang_id: string;
  vorgang_nummer: number;
  nachricht_id: string;
  neu_angelegt: boolean;
  kategorie: string;
  heikel: boolean;
  begruendung: string;
}

/**
 * Nimmt eine eingehende Mail an, ordnet sie einem Vorgang zu und legt sie ab.
 * Idempotent über die Message-ID: Dieselbe Mail zweimal einzuliefern erzeugt
 * keinen zweiten Eintrag — Webhooks werden regelmäßig doppelt zugestellt.
 */
export async function verarbeiteEingang(
  mail: EingehendeMail,
): Promise<EingangErgebnis> {
  const referenzen = Array.isArray(mail.referenzen)
    ? mail.referenzen
    : parseMessageIds(mail.referenzen);

  const einordnung = await ordneEin(
    mail.betreff ?? "",
    mail.koerper_text ?? "",
    mail.von_email,
  );

  return tx(async (c) => {
    if (mail.message_id) {
      const doppelt = await c.query<{ id: string; vorgang_id: string }>(
        `SELECT n.id, n.vorgang_id FROM nachricht n WHERE n.message_id = $1`,
        [mail.message_id],
      );
      if (doppelt.rows.length > 0) {
        const v = await c.query<{ nummer: number }>(
          `SELECT nummer FROM vorgang WHERE id = $1`,
          [doppelt.rows[0].vorgang_id],
        );
        return {
          vorgang_id: doppelt.rows[0].vorgang_id,
          vorgang_nummer: v.rows[0]?.nummer ?? 0,
          nachricht_id: doppelt.rows[0].id,
          neu_angelegt: false,
          kategorie: einordnung.kategorie,
          heikel: einordnung.heikel,
          begruendung: "Bereits eingeliefert (gleiche Message-ID).",
        };
      }
    }

    const kontaktId = await kontaktFuerEmail(
      mail.von_email,
      mail.von_name ?? null,
    );

    let vorgangId = await findeVorgangId({
      inReplyTo: mail.in_reply_to ?? null,
      referenzen,
      betreff: mail.betreff ?? "",
      vonEmail: mail.von_email,
    });

    let neu = false;
    let nummer: number;

    if (vorgangId) {
      const v = await c.query<{ nummer: number }>(
        `SELECT nummer FROM vorgang WHERE id = $1`,
        [vorgangId],
      );
      nummer = v.rows[0].nummer;
      // Eine heikle Nachricht macht den ganzen Vorgang heikel.
      if (einordnung.heikel) {
        await c.query(`UPDATE vorgang SET heikel = true WHERE id = $1`, [
          vorgangId,
        ]);
      }
      await c.query(
        `UPDATE vorgang SET status = 'offen' WHERE id = $1 AND status = 'wartet'`,
        [vorgangId],
      );
    } else {
      const v = await c.query<{ id: string; nummer: number }>(
        `INSERT INTO vorgang (betreff, kategorie, heikel, kontakt_id)
         VALUES ($1, $2, $3, $4) RETURNING id, nummer`,
        [
          (mail.betreff ?? "").trim() || "(ohne Betreff)",
          einordnung.kategorie,
          einordnung.heikel,
          kontaktId,
        ],
      );
      vorgangId = v.rows[0].id;
      nummer = v.rows[0].nummer;
      neu = true;
    }

    const n = await c.query<{ id: string }>(
      `INSERT INTO nachricht
         (vorgang_id, richtung, status, von_email, von_name, an_emails,
          cc_emails, betreff, koerper_text, message_id, in_reply_to,
          referenzen, empfangen_am)
       VALUES ($1,'ein','empfangen',$2,$3,$4,$5,$6,$7,$8,$9,$10,
               COALESCE($11::timestamptz, now()))
       RETURNING id`,
      [
        vorgangId,
        mail.von_email,
        mail.von_name ?? null,
        mail.an_emails ?? [],
        mail.cc_emails ?? [],
        mail.betreff ?? "",
        mail.koerper_text ?? "",
        mail.message_id ?? null,
        mail.in_reply_to ?? null,
        referenzen,
        mail.empfangen_am ?? null,
      ],
    );

    await c.query(
      `INSERT INTO protokoll (vorgang_id, nachricht_id, ereignis, details)
       VALUES ($1,$2,'mail_empfangen',$3::jsonb)`,
      [
        vorgangId,
        n.rows[0].id,
        JSON.stringify({
          kategorie: einordnung.kategorie,
          heikel: einordnung.heikel,
          begruendung: einordnung.begruendung,
          vorgang_neu: neu,
        }),
      ],
    );

    return {
      vorgang_id: vorgangId,
      vorgang_nummer: nummer,
      nachricht_id: n.rows[0].id,
      neu_angelegt: neu,
      kategorie: einordnung.kategorie,
      heikel: einordnung.heikel,
      begruendung: einordnung.begruendung,
    };
  });
}
