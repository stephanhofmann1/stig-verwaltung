import { NextResponse } from "next/server";
import { verarbeiteEingang, type EingehendeMail } from "@/lib/eingang";
import { mitMandant, mandantFuerEmpfaenger, alleMandanten } from "@/lib/mandant";
import { simpleParser } from "mailparser";
import { one } from "@/lib/db";
import {
  sichereAnhang,
  type AnhangEingang,
  type BelegErgebnis,
} from "@/lib/belege";

export const dynamic = "force-dynamic";

/**
 * Webhook für eingehende Mails.
 *
 * Nimmt zwei Formate an:
 *   1. application/json  — bereits zerlegte Felder (EingehendeMail)
 *   2. message/rfc822 oder text/plain — die rohe MIME-Nachricht,
 *      so wie ein Cloudflare Email Worker sie weiterreicht.
 *
 * Abgesichert über einen gemeinsamen Schlüssel im Header
 * x-eingang-schluessel.
 *
 * Ohne gesetzte Umgebungsvariable läuft der Endpunkt nur in der lokalen
 * Entwicklung offen. Im Betrieb wird abgewiesen.
 *
 * Vorher war das nicht so, und der Kommentar hier sagte es auch: "Ohne
 * gesetzte Umgebungsvariable läuft der Endpunkt offen." Dieser Pfad ist in
 * proxy.ts von der Anmeldung ausgenommen — er muss es sein, der Cloudflare
 * Worker hat kein Sitzungscookie. Fehlt der Schlüssel auf dem Server, kann
 * damit jeder im Internet Mails in die Plattform einliefern: beliebige
 * Vorgänge unter beliebigem Absender, und der Agent schreibt darauf
 * Entwürfe. Eine vergessene Zeile in der .env reicht dafür.
 */
export async function POST(req: Request) {
  const erwartet = process.env.EINGANG_SCHLUESSEL;
  if (!erwartet) {
    if (process.env.NODE_ENV === "production") {
      console.error(
        "[maileingang] EINGANG_SCHLUESSEL ist nicht gesetzt — Mail abgewiesen.",
      );
      return NextResponse.json(
        { fehler: "nicht eingerichtet" },
        { status: 503 },
      );
    }
    // Lokal: offen, aber sichtbar. Ein stiller offener Endpunkt ist der
    // Zustand, der aus Versehen in den Betrieb wandert.
    console.warn(
      "[maileingang] Kein EINGANG_SCHLUESSEL gesetzt — Endpunkt offen (nur Entwicklung).",
    );
  } else {
    const gesendet = req.headers.get("x-eingang-schluessel");
    if (gesendet !== erwartet) {
      return NextResponse.json({ fehler: "nicht berechtigt" }, { status: 401 });
    }
  }

  const typ = req.headers.get("content-type") ?? "";
  let mail: EingehendeMail;
  let anhaenge: AnhangEingang[] = [];

  try {
    if (typ.includes("application/json")) {
      const body = (await req.json()) as EingehendeMail & {
        anhaenge?: AnhangEingang[];
      };
      anhaenge = body.anhaenge ?? [];
      if (!body?.von_email) {
        return NextResponse.json(
          { fehler: "von_email fehlt" },
          { status: 400 },
        );
      }
      mail = body;
    } else {
      const roh = await req.text();
      const p = await simpleParser(roh);
      const an = Array.isArray(p.to) ? p.to : p.to ? [p.to] : [];
      const cc = Array.isArray(p.cc) ? p.cc : p.cc ? [p.cc] : [];
      mail = {
        von_email: p.from?.value?.[0]?.address ?? "unbekannt@example.invalid",
        von_name: p.from?.value?.[0]?.name ?? null,
        an_emails: an.flatMap((a) =>
          a.value.map((v) => v.address ?? "").filter(Boolean),
        ),
        cc_emails: cc.flatMap((a) =>
          a.value.map((v) => v.address ?? "").filter(Boolean),
        ),
        betreff: p.subject ?? "",
        koerper_text: p.text ?? p.html?.toString() ?? "",
        message_id: p.messageId ?? null,
        in_reply_to: p.inReplyTo ?? null,
        referenzen: p.references ?? null,
        empfangen_am: p.date?.toISOString() ?? null,
      };
      anhaenge = (p.attachments ?? [])
        .filter((a) => a.filename)
        .map((a) => ({
          dateiname: a.filename!,
          mime_typ: a.contentType ?? null,
          inhalt_base64: Buffer.from(a.content).toString("base64"),
        }));
    }
  } catch (e) {
    return NextResponse.json(
      { fehler: `Nachricht nicht lesbar: ${(e as Error).message}` },
      { status: 400 },
    );
  }

  // Welcher Mandant? Die Empfaengeradresse sagt es (db/012). Hier gibt es
  // keine Sitzung, aus der sich das ableiten liesse.
  //
  // Faellt die Zuordnung aus und es gibt genau einen Mandanten, nehmen wir
  // den. Das haelt den Betrieb am Laufen, solange noch kein Kunde dazugekommen
  // ist, und hoert in dem Moment auf zu greifen, in dem es gefaehrlich wuerde:
  // Bei mehreren Mandanten raten wir nicht, sondern lehnen ab. Eine Mail im
  // falschen Mandanten waere schlimmer als eine abgelehnte.
  let mandant = await mandantFuerEmpfaenger(mail.an_emails ?? []);
  if (!mandant) {
    const alle = await alleMandanten();
    if (alle.length === 1) {
      mandant = alle[0];
      console.warn(
        `[eingang] Empfaenger ${JSON.stringify(mail.an_emails)} unbekannt — ` +
          `einziger Mandant verwendet. Adresse in mandant_adresse eintragen.`,
      );
    } else {
      console.error(
        `[eingang] Kein Mandant fuer ${JSON.stringify(mail.an_emails)}`,
      );
      return NextResponse.json(
        { fehler: "Empfaengeradresse keinem Mandanten zugeordnet" },
        { status: 422 },
      );
    }
  }

  try {
    const ergebnis = await mitMandant(mandant, async () => {
      const eingang = await verarbeiteEingang(mail);

      // Anhänge nur beim ersten Eingang sichern — bei einer doppelt
      // zugestellten Mail läge der Beleg sonst zweimal in der Akte.
      const belege: BelegErgebnis[] = [];
      if (eingang.begruendung !== "Bereits eingeliefert (gleiche Message-ID).") {
        const kontakt = await one<{ kontakt_id: string }>(
          `SELECT kontakt_id FROM kontakt_email WHERE lower(email) = lower($1)`,
          [mail.von_email],
        );
        for (const a of anhaenge) {
          try {
            belege.push(
              await sichereAnhang(a, {
                vorgang_id: eingang.vorgang_id,
                nachricht_id: eingang.nachricht_id,
                kontakt_id: kontakt?.kontakt_id ?? null,
                betreff: mail.betreff ?? "",
                koerper: mail.koerper_text ?? "",
              }),
            );
          } catch (e) {
            console.error("[eingang] Anhang nicht gesichert:", a.dateiname, e);
            belege.push({
              beleg_id: null,
              dateiname: a.dateiname,
              uebersprungen: (e as Error).message,
              belegnummer: null,
              betrag: null,
            });
          }
        }
      }

      return { ...eingang, belege };
    });

    return NextResponse.json(ergebnis, { status: 200 });
  } catch (e) {
    console.error("[eingang] Fehler:", e);
    return NextResponse.json(
      { fehler: (e as Error).message },
      { status: 500 },
    );
  }
}
