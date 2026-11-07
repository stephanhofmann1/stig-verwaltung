import { NextResponse } from "next/server";
import { angemeldeteSitzung } from "@/lib/anmeldung";
import { one, query } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Einen Bankzugang von Hand stilllegen -- und wieder aufwecken.
 *
 * WARUM DAS FEHLTE
 *
 * lib/fints/abruf.ts legt einen Zugang selbst still, wenn die Bank einen
 * Fehler an den Zugangsdaten meldet, und begründet das so: „Lieber
 * einmal zu viel stilllegen: Das kostet einen Klick, das Gegenteil
 * kostet den Gang in die Filiale."
 *
 * Diesen Klick gab es nicht. Die Erkennung greift nur bei Meldungen, die
 * nach PIN, Legitimation oder Sperre klingen. Am 07.11.2026 stand an
 * beiden Zugängen etwas anderes: „Die Bank liefert kein Konto zu diesem
 * Zugang." Das ist kein Zugangsdatenfehler nach dieser Prüfung -- also
 * lief der Abruf zweimal täglich weiter, und niemand konnte ihn
 * anhalten, ohne den Zugang samt PIN zu löschen.
 *
 * Wer nicht weiß, woran ein Abruf scheitert, muss ihn anhalten dürfen,
 * bevor er es herausfindet. Drei Fehlversuche sind bei den meisten
 * Banken alles, was man hat.
 *
 * WARUM NICHT ÜBER PATCH
 *
 * PATCH ist das Bearbeiten der Zugangsdaten und weckt einen Zugang
 * absichtlich auf: Stillgelegt wurde er wegen der Daten, die dort gerade
 * korrigiert werden. Ein Ruhen-Schalter im selben Aufruf hieße, dass
 * jedes Speichern ihn wieder anstößt.
 *
 * WARUM DAS AUFWECKEN DIE BANKINFORMATIONEN VERWIRFT
 *
 * Weil sonst die Meldung bleibt, die zum Stilllegen geführt hat.
 * lib/fints/holen.ts prüft die Anmeldung nur, solange keine
 * Bankinformationen gespeichert sind. Beim Einrichten über TAN werden
 * sie gespeichert, BEVOR geprüft ist, ob die Bank überhaupt ein Konto
 * mitgeliefert hat. Danach überspringt jeder Abruf die Anmeldeprüfung,
 * liest die gespeicherte (leere) Kontenliste und fragt bis in alle
 * Ewigkeit „Stimmt der Anmeldename?" -- ohne die Bank noch einmal
 * danach zu fragen. Verwirft man sie, synchronisiert der nächste Abruf
 * neu und nennt die echte Meldung der Bank im Klartext.
 */
export async function POST(req: Request) {
  const sitzung = await angemeldeteSitzung();
  if (!sitzung || sitzung.rolle === "mieter" || sitzung.rolle === "lesen") {
    return NextResponse.json({ fehler: "nicht berechtigt" }, { status: 403 });
  }

  const form = await req.formData();
  const id = String(form.get("id") ?? "").trim();
  const ruhen = String(form.get("ruhen") ?? "") === "1";
  if (!id) {
    return NextResponse.json({ fehler: "Zugang fehlt" }, { status: 400 });
  }

  const vorhanden = await one<{ bezeichnung: string }>(
    `SELECT bezeichnung FROM fints_zugang WHERE id = $1`,
    [id],
  );
  if (!vorhanden) {
    return NextResponse.json(
      { fehler: "Zugang nicht gefunden" },
      { status: 404 },
    );
  }

  if (ruhen) {
    // Nur der Schalter. Die PIN, die Adresse, der Anmeldename und der
    // Abrufstand bleiben stehen -- ein stillgelegter Zugang soll sich
    // mit einem Klick wieder aufwecken lassen, nicht neu eingerichtet
    // werden müssen.
    await query(`UPDATE fints_zugang SET aktiv = false WHERE id = $1`, [id]);
  } else {
    await query(
      `UPDATE fints_zugang
          SET aktiv = true,
              bank_information = NULL,
              tan_faellig = false,
              tan_hinweis = NULL,
              letzter_fehler = NULL
        WHERE id = $1`,
      [id],
    );
  }

  return NextResponse.json({
    ok: true,
    zugang: vorhanden.bezeichnung,
    ruht: ruhen,
  });
}
