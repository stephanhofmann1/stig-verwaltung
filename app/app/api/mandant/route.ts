import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { angemeldeteSitzung } from "@/lib/anmeldung";
import { baueSitzung, COOKIE_NAME, COOKIE_MAXALTER } from "@/lib/sitzung";
import { zugaengeFuer } from "@/lib/zugang";

export const dynamic = "force-dynamic";

/**
 * Einen weiteren Mandanten anlegen.
 *
 * Wofür: Eine private Ablage soll nicht im Mandanten der eGbR liegen, in
 * den ein Mitgesellschafter sieht. Ein eigener Mandant trennt sie --
 * dieselbe Trennung, die zwischen zwei Kunden der Plattform liegt.
 *
 * Die Rechteprüfung steht in der Datenbank (mandant_anlegen, db/035) und
 * nicht hier. Der Grund: Die Funktion verteilt Zugriff und läuft unter
 * dem Eigentümer. Stünde die Prüfung nur in dieser Route, wäre sie für
 * jeden offen, der die Funktion aufrufen kann. Name und Heimatmandant
 * kommen aus dem unterschriebenen Sitzungscookie, nie aus der Anfrage --
 * sonst könnte jemand einen fremden Benutzer freigeben.
 *
 * Nach dem Anlegen wird gleich umgeschaltet. Wer einen Mandanten
 * anlegt, will hinein; ein zweiter Klick wäre nur eine Hürde.
 */
const KUERZEL = /^[a-z0-9][a-z0-9-]{1,23}$/;

export async function POST(anfrage: Request) {
  const sitzung = await angemeldeteSitzung();
  if (!sitzung) {
    return NextResponse.json({ fehler: "nicht angemeldet" }, { status: 401 });
  }
  if (sitzung.rolle !== "verwalter") {
    return NextResponse.json({ fehler: "nicht berechtigt" }, { status: 403 });
  }

  let name = "";
  let kuerzel = "";
  try {
    const b = await anfrage.json();
    if (b && typeof b === "object") {
      if (typeof b.name === "string") name = b.name.trim();
      if (typeof b.kuerzel === "string") kuerzel = b.kuerzel.trim().toLowerCase();
    }
  } catch {
    /* unten als fehlender Wert behandelt */
  }

  if (name.length < 2 || name.length > 80) {
    return NextResponse.json(
      { fehler: "Der Name muss zwischen 2 und 80 Zeichen haben." },
      { status: 400 },
    );
  }
  if (!KUERZEL.test(kuerzel)) {
    return NextResponse.json(
      {
        fehler:
          "Das Kürzel darf nur Kleinbuchstaben, Ziffern und Bindestriche " +
          "enthalten, 2 bis 24 Zeichen. Es steht später in Adressen.",
      },
      { status: 400 },
    );
  }

  const heimat = sitzung.heimat ?? sitzung.mandant;
  let neu: string;
  try {
    // Am Pool und nicht über query(): Die Funktion legt einen Mandanten
    // an, der noch keinen Kontext hat -- und benutzer_zugang ist für die
    // Anwendungsrolle ganz zu (db/035).
    const r = await pool.query<{ mandant_anlegen: string }>(
      `SELECT mandant_anlegen($1, $2, $3, $4) AS mandant_anlegen`,
      [name, kuerzel, sitzung.name, heimat],
    );
    neu = r.rows[0].mandant_anlegen;
  } catch (e) {
    const text = (e as Error).message;
    if (/nicht berechtigt/.test(text)) {
      return NextResponse.json({ fehler: "nicht berechtigt" }, { status: 403 });
    }
    if (/kuerzel/i.test(text) || /unique/i.test(text)) {
      return NextResponse.json(
        { fehler: "Dieses Kürzel ist schon vergeben." },
        { status: 409 },
      );
    }
    console.error("[mandant-anlegen]", text);
    return NextResponse.json(
      { fehler: "Der Mandant konnte nicht angelegt werden." },
      { status: 500 },
    );
  }

  const antwort = NextResponse.json({ ok: true, mandant: neu });
  antwort.cookies.set(
    COOKIE_NAME,
    baueSitzung({
      name: sitzung.name,
      mandant: neu,
      rolle: "verwalter",
      heimat,
    }),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: COOKIE_MAXALTER,
    },
  );
  return antwort;
}

/** Die offenen Mandanten -- dasselbe wie /api/mandant/wechseln (GET). */
export async function GET() {
  const sitzung = await angemeldeteSitzung();
  if (!sitzung) {
    return NextResponse.json({ fehler: "nicht angemeldet" }, { status: 401 });
  }
  return NextResponse.json({
    aktiv: sitzung.mandant,
    zugaenge: await zugaengeFuer(sitzung),
  });
}
