import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { angemeldeteSitzung } from "@/lib/anmeldung";
import { sendeEntwurf, verwirfEntwurf } from "@/lib/versand";
import {
  erzeugeNeuMitAnweisung,
  ladeHerkunft,
  stelleFassungWiederHer,
  vermerkeHandfassung,
} from "@/lib/agent";

/**
 * Ein Entwurf: ansehen, ändern, neu erzeugen lassen, freigeben, verwerfen.
 *
 * Die Methoden sind bewusst getrennt, und die Trennung ist die wichtigste
 * Eigenschaft dieser Datei:
 *
 *   GET    Herkunft, Fassungen, wirksame Weisungen. Liest nur.
 *   PATCH  Der Mensch schreibt den Text selbst um. Legt eine Fassung an.
 *   PUT    Neu erzeugen lassen — mit Anweisung oder zurück auf eine
 *          frühere Fassung. Erzeugt IMMER nur einen Entwurf.
 *   POST   Freigeben und senden. Die einzige Methode in dieser
 *          Anwendung, auf der ein Text das Haus verlässt.
 *   DELETE Verwerfen.
 *
 * PUT und POST sind deshalb zwei Methoden und nicht ein Aufruf mit einem
 * Schalter: Der Unterschied zwischen "neu formulieren" und "senden" darf
 * nicht an einem Wahrheitswert im Körper hängen. Ein falsch gesetztes
 * Feld, ein Tippfehler in einem Formular, eine Weisung, die das Modell
 * missversteht — nichts davon kann aus einer Nacherzeugung einen Versand
 * machen, weil PUT keinen Versandweg kennt.
 */

type Ctx = { params: Promise<{ id: string }> };

const KENNUNG = /^[0-9a-f-]{36}$/i;

/** Entwurfstext ändern, bevor er freigegeben wird. */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = (await req.json()) as { koerper?: string; betreff?: string };

  const felder: string[] = [];
  const werte: unknown[] = [id];
  if (typeof body.koerper === "string") {
    werte.push(body.koerper);
    felder.push(`koerper_text = $${werte.length}`);
  }
  if (typeof body.betreff === "string") {
    werte.push(body.betreff);
    felder.push(`betreff = $${werte.length}`);
  }
  if (felder.length === 0) {
    return NextResponse.json({ fehler: "nichts zu ändern" }, { status: 400 });
  }
  // Sobald ein Mensch den Text anfasst, gilt er als von ihm verfasst.
  felder.push(`verfasst_von = 'mensch'`);
  felder.push(`entwurf_quelle = 'mensch'`);

  // Die Handfassung kommt VOR dem UPDATE in die Historie: Sie braucht den
  // Text, der jetzt noch in der Nachricht steht, um zu erkennen, ob sich
  // überhaupt etwas geändert hat. Danach wäre der alte Text weg.
  if (typeof body.koerper === "string") {
    const sitzung = await angemeldeteSitzung();
    try {
      await vermerkeHandfassung({
        nachrichtId: id,
        koerper: body.koerper,
        wer: sitzung?.name ?? "mensch",
      });
    } catch (e) {
      // Eine fehlgeschlagene Historie darf das Speichern nicht
      // verhindern. Der Text des Menschen ist das Wichtigere; der Verlust
      // wäre spürbar, der fehlende Historieneintrag nur bedauerlich.
      console.error("[entwurf-patch-historie]", e);
    }
  }

  const rows = await query(
    `UPDATE nachricht SET ${felder.join(", ")}
      WHERE id = $1 AND status = 'entwurf'
      RETURNING id`,
    werte,
  );
  if (rows.length === 0) {
    return NextResponse.json(
      { fehler: "Entwurf nicht gefunden oder schon versendet" },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true });
}

/**
 * Herkunft und Fassungen eines Entwurfs.
 *
 * Eigene Methode statt eines Props vom Server, weil dieselbe
 * Entwurfskarte an zwei Stellen steht (Freigabeliste und Vorgangsakte)
 * und beide dieselbe Auskunft brauchen. Ein zweiter Weg hieße zwei
 * Darstellungen derselben Frage, und eine davon wäre irgendwann falsch.
 */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!KENNUNG.test(id)) {
    return NextResponse.json({ fehler: "Unplausible Kennung." }, { status: 400 });
  }
  const sitzung = await angemeldeteSitzung();
  if (!sitzung) {
    return NextResponse.json({ fehler: "nicht angemeldet" }, { status: 401 });
  }

  try {
    const d = await ladeHerkunft(id);
    if (!d) {
      return NextResponse.json(
        { fehler: "Entwurf nicht gefunden." },
        { status: 404 },
      );
    }
    return NextResponse.json({
      ok: true,
      herkunft: d.herkunft,
      fassungen: d.fassungen,
      weisungen: d.lage.wirksam,
      weisungen_uebergangen: d.lage.uebergangen,
    });
  } catch (e) {
    console.error("[entwurf-get]", e);
    return NextResponse.json({ fehler: (e as Error).message }, { status: 500 });
  }
}

/**
 * Neu erzeugen lassen — mit Anweisung, oder zurück auf eine Fassung.
 *
 * Diese Methode erzeugt IMMER nur einen Entwurf. Es gibt hier keinen
 * Aufruf von sendeEntwurf(), keinen Zugriff auf einen Versandweg und
 * keinen Schalter, der daraus einen machen könnte. Das ist die Grenze,
 * auf der die ganze Anwendung ruht: Nichts verlässt das Haus, ohne dass
 * ein Mensch in der Freigabe geklickt hat.
 *
 * Fällt das Modell aus, antwortet diese Route mit 200 und ok=false. Nicht
 * mit 500: Für den Browser ist das kein Serverfehler, sondern ein
 * Ergebnis, das er anzeigen soll — der alte Entwurf steht noch, und
 * genau das muss auf der Oberfläche stehen. Ein leeres Textfeld nach
 * einem Fehlschlag wäre der schlimmere Ausgang.
 */
export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!KENNUNG.test(id)) {
    return NextResponse.json({ fehler: "Unplausible Kennung." }, { status: 400 });
  }

  const sitzung = await angemeldeteSitzung();
  if (!sitzung) {
    return NextResponse.json({ fehler: "nicht angemeldet" }, { status: 401 });
  }
  if (sitzung.rolle !== "verwalter") {
    return NextResponse.json(
      {
        fehler:
          "Dieser Zugang darf Entwürfe ansehen, aber nicht neu erzeugen lassen.",
      },
      { status: 403 },
    );
  }

  const body = (await req.json().catch(() => null)) as {
    anweisung?: unknown;
    zurueck?: unknown;
  } | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ fehler: "Kein lesbarer Körper." }, { status: 400 });
  }

  try {
    // --- Zurück auf eine frühere Fassung ---------------------------
    if (body.zurueck !== undefined && body.zurueck !== null) {
      const ziel = Number(body.zurueck);
      if (!Number.isInteger(ziel) || ziel < 1) {
        return NextResponse.json(
          { fehler: "Die Zielfassung muss eine Nummer ab 1 sein." },
          { status: 400 },
        );
      }
      const r = await stelleFassungWiederHer({
        nachrichtId: id,
        ziel,
        wer: sitzung.name,
      });
      if (!r) {
        return NextResponse.json(
          { fehler: "Entwurf nicht gefunden." },
          { status: 404 },
        );
      }
      return NextResponse.json(r);
    }

    // --- Neu erzeugen mit Anweisung ---------------------------------
    const anweisung =
      typeof body.anweisung === "string" ? body.anweisung.trim() : "";
    if (anweisung.length < 3) {
      return NextResponse.json(
        {
          fehler:
            "Schreib in eigenen Worten, was anders werden soll — " +
            "„kürzer“, „frag nach dem Zählerstand“, „auf Englisch“. " +
            "Ohne Anweisung gibt es nichts neu zu erzeugen.",
        },
        { status: 400 },
      );
    }

    const r = await erzeugeNeuMitAnweisung({
      nachrichtId: id,
      anweisung,
      wer: sitzung.name,
    });
    if (!r) {
      return NextResponse.json(
        { fehler: "Entwurf nicht gefunden." },
        { status: 404 },
      );
    }
    // 200 auch bei ok=false -- siehe Kopf dieser Methode.
    return NextResponse.json(r);
  } catch (e) {
    console.error("[entwurf-put]", e);
    return NextResponse.json({ fehler: (e as Error).message }, { status: 500 });
  }
}

/** Freigeben und senden. */
export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const r = await sendeEntwurf(id);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}

/** Verwerfen. */
export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  await verwirfEntwurf(id);
  return NextResponse.json({ ok: true });
}
