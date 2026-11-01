import { NextResponse } from "next/server";
import { anmelden, baueSitzung, COOKIE_NAME, COOKIE_MAXALTER } from "@/lib/anmeldung";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { benutzer?: string; passwort?: string }
    | null;

  if (!body?.benutzer || !body?.passwort) {
    return NextResponse.json(
      { fehler: "Benutzername und Passwort angeben" },
      { status: 400 },
    );
  }

  const sitzung = await anmelden(body.benutzer, body.passwort);
  if (!sitzung) {
    // Bewusst nicht verraten, welches der beiden falsch war.
    return NextResponse.json(
      { fehler: "Benutzername oder Passwort stimmt nicht" },
      { status: 401 },
    );
  }

  const antwort = NextResponse.json({ ok: true });
  antwort.cookies.set(COOKIE_NAME, baueSitzung(sitzung), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAXALTER,
  });
  return antwort;
}

/** Abmelden. */
export async function DELETE() {
  const antwort = NextResponse.json({ ok: true });
  antwort.cookies.set(COOKIE_NAME, "", { path: "/", maxAge: 0 });
  return antwort;
}
