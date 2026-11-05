import { NextResponse } from "next/server";
import { angemeldeteSitzung } from "@/lib/anmeldung";
import { one } from "@/lib/db";
import {
  anhaengeZu,
  endungFuerAblage,
  mimeGroesse,
  pruefePaket,
  speichereAnhang,
} from "@/lib/anhaenge";
import {
  GRENZE_BYTES,
  darfSchreiben,
  erkenneTyp,
  pruefeDatei,
  sichererDateiname,
} from "@/lib/dokumente";

export const dynamic = "force-dynamic";

/**
 * Eine Datei an einen Entwurf hängen.
 *
 * Nur an einen Entwurf. Eine Nachricht, die das Haus verlassen hat, ist
 * ein Protokoll dessen, was gesendet wurde -- wer dort nachträglich
 * einen Anhang einfügt, baut eine Akte, die etwas anderes behauptet als
 * das, was beim Empfänger liegt. Dieselbe Überlegung wie bei PATCH auf
 * einem Entwurf (app/api/entwurf/[id]), nur eine Ebene tiefer.
 *
 * Der Typ wird am INHALT bestimmt, nicht am Namen (lib/dokumente.ts:
 * pruefeDatei). Was hier hochgeladen wird, geht später an einen
 * Empfänger hinaus -- eine Datei, deren Inhalt nicht zu ihrem Namen
 * passt, ist entweder ein Versehen oder ein Versuch, und beides soll
 * hier aufhören und nicht beim Handwerker ankommen.
 */

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;

  const sitzung = await angemeldeteSitzung();
  if (!sitzung || !darfSchreiben(sitzung.rolle)) {
    return NextResponse.json({ fehler: "nicht berechtigt" }, { status: 403 });
  }
  if (!UUID.test(id)) {
    return NextResponse.json({ fehler: "keine Kennung" }, { status: 400 });
  }

  const typ = req.headers.get("content-type") ?? "";
  if (!typ.includes("multipart/form-data")) {
    return NextResponse.json(
      { fehler: "Erwartet wird ein Formular mit Datei (multipart/form-data)." },
      { status: 415 },
    );
  }

  // Über one() und damit über RLS: Ein Entwurf eines anderen Mandanten
  // ist von hier aus nicht vorhanden, nicht etwa verboten. Der
  // Unterschied ist wichtig -- "nicht gefunden" verrät nicht, dass es
  // ihn gibt.
  const nachricht = await one<{ id: string; status: string }>(
    `SELECT id, status FROM nachricht WHERE id = $1`,
    [id],
  );
  if (!nachricht) {
    return NextResponse.json({ fehler: "Nachricht nicht gefunden" }, { status: 404 });
  }
  if (nachricht.status !== "entwurf") {
    return NextResponse.json(
      {
        fehler:
          `Die Nachricht steht auf "${nachricht.status}". Anhänge lassen ` +
          `sich nur an einem Entwurf ändern -- was gesendet wurde, bleibt, ` +
          `wie es gesendet wurde.`,
      },
      { status: 409 },
    );
  }

  const form = await req.formData();
  const datei = form.get("datei");
  if (!(datei instanceof File) || datei.size === 0) {
    return NextResponse.json({ fehler: "Keine Datei erhalten." }, { status: 400 });
  }

  // Vor dem Lesen, damit eine 300-MB-Datei nicht erst im Speicher landet.
  if (datei.size > GRENZE_BYTES) {
    return NextResponse.json(
      {
        fehler:
          `Die Datei ist ${(datei.size / 1024 / 1024).toFixed(1)} MB groß. ` +
          `Mehr als ${GRENZE_BYTES / 1024 / 1024} MB werden nicht angenommen.`,
      },
      { status: 413 },
    );
  }

  // Passt sie noch ins Paket? Geprüft wird gegen das, was schon hängt --
  // und auf der kodierten Größe. Die Prüfung hier ist die freundliche:
  // Sie sagt es beim Hochladen. Dieselbe Prüfung steht noch einmal in
  // sendeEntwurf() und ist dort die verbindliche.
  const bisher = await anhaengeZu(id);
  const paket = pruefePaket([
    ...bisher.map((b) => Number(b.groesse_bytes)),
    datei.size,
  ]);
  if (!paket.ok) {
    return NextResponse.json({ fehler: paket.fehler }, { status: 413 });
  }

  const inhalt = new Uint8Array(await datei.arrayBuffer());
  const geprueft = pruefeDatei(inhalt, datei.name ?? "");
  if (!geprueft.ok) {
    return NextResponse.json({ fehler: geprueft.fehler }, { status: 415 });
  }

  const name = sichererDateiname(datei.name ?? "anhang");
  const neu = await speichereAnhang({
    nachrichtId: id,
    dateiname: name,
    inhalt,
    mime: geprueft.mime,
    endung: endungFuerAblage(erkenneTyp(inhalt), name),
    richtung: "ausgehend",
  });

  // null heißt: lag schon dran (gleicher Inhalt). Kein Fehler -- der
  // gewünschte Zustand ist erreicht. Ein doppelter Klick soll keine
  // rote Meldung erzeugen.
  return NextResponse.json({
    ok: true,
    id: neu?.id ?? null,
    doppelt: neu === null,
    dateiname: name,
    mime: geprueft.mime,
    endungPasstNicht: geprueft.endungPasstNicht,
    paket_kodiert: paket.kodiert + (neu === null ? 0 : mimeGroesse(inhalt.length)),
  });
}

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const sitzung = await angemeldeteSitzung();
  if (!sitzung) {
    return NextResponse.json({ fehler: "nicht angemeldet" }, { status: 401 });
  }
  if (!UUID.test(id)) {
    return NextResponse.json({ fehler: "keine Kennung" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, anhaenge: await anhaengeZu(id) });
}
