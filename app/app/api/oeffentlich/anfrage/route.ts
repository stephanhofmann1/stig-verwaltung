import { NextResponse } from "next/server";
import { verarbeiteEingang } from "@/lib/eingang";
import { mitMandant, mandantFuerAdresse } from "@/lib/mandant";

export const dynamic = "force-dynamic";

/**
 * Das Anfrageformular der Objektwebsite.
 *
 * Bisher oeffnete der Absenden-Knopf das Mailprogramm. Auf einem Handy ohne
 * eingerichtetes Mailkonto passiert dann schlicht nichts, und der Interessent
 * ist weg. Hier landet die Anfrage direkt als Vorgang — denselben Weg, den
 * eine echte Mail auch geht, inklusive Einordnung und Agentenentwurf.
 *
 * Ohne Anmeldung erreichbar. Das ist ein Formular im Netz, also gilt:
 * nichts glauben, alles begrenzen.
 */

/** Grobe Plausibilitaet. Wer eine echte Adresse hat, kommt damit durch. */
const EMAIL = /^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/;

/**
 * Die Website liegt auf einer anderen Domain (westanlage9.de) als diese
 * Schnittstelle. Ohne diese Kopfzeile darf der Browser die Antwort nicht
 * lesen -- und zwar auch dann nicht, wenn sie inhaltlich in Ordnung ist.
 *
 * Deshalb steht sie an JEDER Antwort, nicht nur an der erfolgreichen. Vorher
 * war das so, und die Folge war unsichtbar, aber aergerlich: Bei einer
 * fehlerhaften Eingabe schickte der Server zwar "Bitte eine gueltige
 * E-Mail-Adresse angeben", der Browser verwarf die Antwort aber als
 * quellenfremd. Das Formular konnte den Satz nie anzeigen und bot statt
 * einer Korrekturhilfe den allgemeinen Rueckfallweg an -- der Interessent
 * haette seinen Tippfehler nie erfahren.
 */
const CORS = { "access-control-allow-origin": "*" } as const;

function antwort(rumpf: unknown, status = 200): NextResponse {
  return NextResponse.json(rumpf, { status, headers: CORS });
}

const MAX = { name: 120, email: 160, nachricht: 4000, einheit: 120 } as const;

function kurz(wert: unknown, max: number): string {
  return typeof wert === "string" ? wert.trim().slice(0, max) : "";
}

export async function POST(req: Request) {
  const host = new URL(req.url).searchParams.get("host") ?? "";
  const mandant = host ? await mandantFuerAdresse(host) : null;
  if (!mandant) {
    return antwort({ fehler: "Unbekannte Herkunft" }, 404);
  }

  const body = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body) {
    return antwort({ fehler: "Keine Daten" }, 400);
  }

  // Honigtopf: ein im Formular verstecktes Feld, das kein Mensch ausfuellt.
  // Ist es belegt, war es ein Bot. Wir antworten freundlich und tun nichts —
  // eine Fehlermeldung waere nur eine Rueckmeldung fuer den naechsten Versuch.
  if (kurz(body.webseite, 10)) {
    return antwort({ ok: true });
  }

  const name = kurz(body.name, MAX.name);
  const email = kurz(body.email, MAX.email);
  const nachricht = kurz(body.nachricht, MAX.nachricht);
  const einheit = kurz(body.einheit, MAX.einheit);
  const telefon = kurz(body.telefon, 40);

  if (!EMAIL.test(email)) {
    return antwort({ fehler: "Bitte eine gültige E-Mail-Adresse angeben." }, 400);
  }
  if (nachricht.length < 2 && !einheit) {
    return antwort({ fehler: "Bitte kurz schreiben, worum es geht." }, 400);
  }

  const betreff = einheit
    ? `Anfrage über die Website: ${einheit}`
    : "Anfrage über die Website";

  const koerper = [
    nachricht,
    "",
    "— über das Anfrageformular der Website —",
    einheit ? `Gewünschte Einheit: ${einheit}` : null,
    telefon ? `Telefon: ${telefon}` : null,
  ]
    .filter((z) => z !== null)
    .join("\n");

  try {
    const ergebnis = await mitMandant(mandant, () =>
      verarbeiteEingang({
        von_email: email,
        von_name: name || null,
        an_emails: [],
        betreff,
        koerper_text: koerper,
        // Keine Message-ID: Die Anfrage kommt nicht aus einem Mailprogramm.
        // Antwortet der Agent darauf, beginnt der Thread hier.
        message_id: null,
        empfangen_am: new Date().toISOString(),
      }),
    );

    // Nach aussen nur die Bestaetigung. Die Vorgangsnummer ist eine interne
    // Information und gehoert nicht in eine oeffentliche Antwort — ins Log
    // schon, damit sich eine Anfrage spaeter wiederfinden laesst.
    console.log(
      `[anfrage] angenommen als Vorgang ${ergebnis.vorgang_nummer} (${ergebnis.kategorie})`,
    );

    return antwort({ ok: true });
  } catch (e) {
    console.error("[anfrage] fehlgeschlagen:", e);
    return antwort({ fehler: "Die Anfrage konnte nicht angenommen werden." }, 500);
  }
}

/** Die Website liegt auf einer anderen Domain — Vorabanfrage beantworten. */
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "86400",
    },
  });
}
