import { NextResponse } from "next/server";
import { one, pool } from "@/lib/db";
import { erstelleEntwurf } from "@/lib/versand";
import { gesetzterMandant, mitMandant } from "@/lib/mandant";
import { mandantAusSitzung } from "@/lib/anmeldung";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Legt einen Antwortentwurf für einen Vorgang an.
 * Das ist die Schnittstelle, über die der Agent schreibt — er versendet nie
 * selbst, sondern legt hier ab. Der Entwurf erscheint dann in der Freigabe.
 *
 * Body: { koerper, antwort_auf?, betreff?, agent_notiz?, verfasst_von? }
 * Ohne antwort_auf wird auf die letzte eingegangene Nachricht geantwortet.
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;

  // Der Agent kommt mit dem Aufgabenschluessel statt mit einer Sitzung und
  // hat damit keinen Mandanten im Kontext. Den holen wir aus dem Vorgang
  // selbst (db/014) -- eine Abfrage waere ohne gesetzten Mandanten blind.
  const ausSitzung = gesetzterMandant() ?? (await mandantAusSitzung());
  let mandant = ausSitzung;
  if (!mandant) {
    const r = await pool.query<{ mandant_fuer_vorgang: string | null }>(
      `SELECT mandant_fuer_vorgang($1)`,
      [id],
    );
    mandant = r.rows[0]?.mandant_fuer_vorgang ?? null;
  }
  if (!mandant) {
    return NextResponse.json({ fehler: "Vorgang nicht gefunden" }, { status: 404 });
  }

  return mitMandant(mandant, () => entwurfAnlegen(req, id));
}

async function entwurfAnlegen(req: Request, id: string) {
  const body = (await req.json()) as {
    koerper?: string;
    antwort_auf?: string;
    betreff?: string;
    agent_notiz?: string;
    verfasst_von?: "agent" | "mensch";
  };

  if (!body.koerper?.trim()) {
    return NextResponse.json({ fehler: "koerper fehlt" }, { status: 400 });
  }

  const vorgang = await one<{ id: string; heikel: boolean }>(
    `SELECT id, heikel FROM vorgang WHERE id = $1`,
    [id],
  );
  if (!vorgang) {
    return NextResponse.json({ fehler: "Vorgang nicht gefunden" }, { status: 404 });
  }

  let bezugId = body.antwort_auf;
  if (!bezugId) {
    const letzte = await one<{ id: string }>(
      `SELECT id FROM nachricht
        WHERE vorgang_id = $1 AND richtung = 'ein'
        ORDER BY angelegt_am DESC LIMIT 1`,
      [id],
    );
    if (!letzte) {
      return NextResponse.json(
        { fehler: "Keine eingegangene Nachricht, auf die geantwortet werden könnte" },
        { status: 400 },
      );
    }
    bezugId = letzte.id;
  }

  const verfasstVon = body.verfasst_von ?? "agent";

  // Bei heiklen Vorgängen darf der Agent nichts vorschreiben — hier entstehen
  // rechtlich wirksame Erklärungen mit Fristen. Ein Mensch darf.
  if (vorgang.heikel && verfasstVon === "agent") {
    return NextResponse.json(
      {
        fehler:
          "Vorgang ist als heikel markiert. Hier schreibt der Agent keine Entwürfe vor.",
      },
      { status: 409 },
    );
  }

  const r = await erstelleEntwurf({
    vorgangId: id,
    antwortAufNachrichtId: bezugId,
    betreff: body.betreff,
    koerper: body.koerper,
    verfasstVon,
    agentNotiz: body.agent_notiz ?? null,
  });

  return NextResponse.json({ ok: true, ...r });
}
