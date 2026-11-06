import { NextResponse } from "next/server";
import { angemeldeteSitzung } from "@/lib/anmeldung";
import { query, one } from "@/lib/db";
import { verschluessele, schluesselVorhanden } from "@/lib/fints/geheimnis";

export const dynamic = "force-dynamic";

/**
 * Einrichtung eines FinTS-Zugangs.
 *
 * Die PIN kommt aus einem Formularfeld, wird sofort verschlüsselt und
 * nirgends protokolliert -- nicht im Log, nicht in der Antwort, nicht in
 * einer Fehlermeldung. Deshalb steht in dieser Datei keine einzige
 * console-Ausgabe, die das Formular als Ganzes ausgibt.
 *
 * Nur für Verwalter. Ein Mieterzugang hat hier nichts zu suchen.
 */

export async function POST(req: Request) {
  const sitzung = await angemeldeteSitzung();
  if (!sitzung || sitzung.rolle === "mieter") {
    return NextResponse.json({ fehler: "nicht berechtigt" }, { status: 403 });
  }

  if (!schluesselVorhanden()) {
    return NextResponse.json(
      {
        fehler:
          "FINTS_SCHLUESSEL fehlt in der .env. Ohne ihn wird keine PIN " +
          "gespeichert. Erzeugen mit: openssl rand -hex 32",
      },
      { status: 503 },
    );
  }

  const form = await req.formData();
  const feld = (n: string) => String(form.get(n) ?? "").trim();

  const bezeichnung = feld("bezeichnung");
  const konto = feld("konto");
  const bankId = feld("bank_id");
  const url = feld("url");
  const benutzer = feld("benutzer");
  const pin = String(form.get("pin") ?? "");

  const fehlt = [
    !bezeichnung && "Bezeichnung",
    !konto && "Konto",
    !bankId && "Bankleitzahl",
    !url && "FinTS-Adresse der Bank",
    !benutzer && "Anmeldename",
    !pin && "PIN",
  ].filter(Boolean);
  if (fehlt.length > 0) {
    return NextResponse.json(
      { fehler: `Es fehlt: ${fehlt.join(", ")}` },
      { status: 400 },
    );
  }

  // Nur HTTPS. Ein FinTS-Endpunkt ohne TLS wäre eine PIN im Klartext über
  // das Netz -- das wird nicht entgegengenommen, auch nicht auf Wunsch.
  if (!/^https:\/\//i.test(url)) {
    return NextResponse.json(
      { fehler: "Die FinTS-Adresse muss mit https:// beginnen." },
      { status: 400 },
    );
  }

  const k = await one<{ id: string }>(
    `SELECT id FROM konto WHERE bezeichnung = $1`,
    [konto],
  );
  if (!k) {
    return NextResponse.json(
      { fehler: `Das Konto "${konto}" ist nicht angelegt.` },
      { status: 404 },
    );
  }

  const geheim = verschluessele(pin);

  await query(
    `INSERT INTO fints_zugang
       (konto_id, bezeichnung, bank_id, url, benutzer, kunden_id,
        konto_iban, pin_verschluesselt)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (mandant_id, bezeichnung) DO UPDATE
        SET bank_id = EXCLUDED.bank_id,
            url = EXCLUDED.url,
            benutzer = EXCLUDED.benutzer,
            kunden_id = EXCLUDED.kunden_id,
            konto_iban = EXCLUDED.konto_iban,
            pin_verschluesselt = EXCLUDED.pin_verschluesselt,
            -- Eine neue PIN heißt: von vorn. Die alten Bankinformationen
            -- gehören zu einer Anmeldung, die es so nicht mehr gibt.
            bank_information = NULL,
            tan_faellig = false,
            tan_hinweis = NULL,
            letzter_fehler = NULL,
            aktiv = true`,
    [k.id, bezeichnung, bankId, url, benutzer,
     feld("kunden_id") || null, feld("konto_iban") || null, geheim],
  );

  // Absichtlich ohne Echo der Eingaben: Die Antwort landet im Browser und
  // womöglich in einem Protokoll.
  return NextResponse.json({ ok: true, bezeichnung });
}

/**
 * Einen vorhandenen Zugang ändern.
 *
 * Warum eigens, obwohl POST bei gleicher Bezeichnung schon aktualisiert:
 * POST verlangt eine PIN. Wer nur den Anmeldenamen korrigieren will --
 * der häufigste Fall, weil Sparkassen die Legitimations-ID erwarten und
 * nicht den selbst gewählten Anmeldenamen --, müsste die PIN erneut
 * eintippen. Dabei vertippt man sich, und drei Fehlversuche sperren den
 * Zugang. Hier bleibt die gespeicherte PIN also liegen, solange keine
 * neue kommt.
 *
 * Jede Änderung an den Zugangsdaten setzt `bank_information` zurück: Die
 * gespeicherte Synchronisation gehört zu einer Anmeldung, die es so
 * nicht mehr gibt. Und sie weckt einen stillgelegten Zugang wieder --
 * stillgelegt wurde er wegen der Daten, die gerade korrigiert werden.
 */
export async function PATCH(req: Request) {
  const sitzung = await angemeldeteSitzung();
  if (!sitzung || sitzung.rolle === "mieter") {
    return NextResponse.json({ fehler: "nicht berechtigt" }, { status: 403 });
  }

  const form = await req.formData();
  const feld = (n: string) => String(form.get(n) ?? "").trim();

  const id = feld("id");
  if (!id) {
    return NextResponse.json({ fehler: "Zugang fehlt" }, { status: 400 });
  }

  const vorhanden = await one<{ id: string }>(
    `SELECT id FROM fints_zugang WHERE id = $1`,
    [id],
  );
  if (!vorhanden) {
    return NextResponse.json({ fehler: "Zugang nicht gefunden" }, { status: 404 });
  }

  const benutzer = feld("benutzer");
  const url = feld("url");
  const pin = String(form.get("pin") ?? "");

  if (!benutzer) {
    return NextResponse.json({ fehler: "Der Anmeldename fehlt." }, { status: 400 });
  }
  if (url && !/^https:\/\//i.test(url)) {
    return NextResponse.json(
      { fehler: "Die FinTS-Adresse muss mit https:// beginnen." },
      { status: 400 },
    );
  }

  // Leere PIN heißt "unverändert", nicht "löschen". Wer die PIN entfernen
  // will, löscht den Zugang.
  const geheim = pin ? verschluessele(pin) : null;

  await query(
    `UPDATE fints_zugang
        SET benutzer = $2,
            url = COALESCE(NULLIF($3, ''), url),
            kunden_id = NULLIF($4, ''),
            konto_iban = NULLIF($5, ''),
            pin_verschluesselt = COALESCE($6, pin_verschluesselt),
            bank_information = NULL,
            tan_faellig = false,
            tan_hinweis = NULL,
            letzter_fehler = NULL,
            aktiv = true
      WHERE id = $1`,
    [id, benutzer, url, feld("kunden_id"), feld("konto_iban"), geheim],
  );

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const sitzung = await angemeldeteSitzung();
  if (!sitzung || sitzung.rolle === "mieter") {
    return NextResponse.json({ fehler: "nicht berechtigt" }, { status: 403 });
  }
  const { searchParams } = new URL(req.url);
  const bezeichnung = searchParams.get("bezeichnung") ?? "";
  if (!bezeichnung) {
    return NextResponse.json({ fehler: "Bezeichnung fehlt" }, { status: 400 });
  }
  await query(`DELETE FROM fints_zugang WHERE bezeichnung = $1`, [bezeichnung]);
  return NextResponse.json({ ok: true });
}
