import { NextResponse } from "next/server";
import { angemeldeteSitzung } from "@/lib/anmeldung";
import { baueSitzung, COOKIE_NAME, COOKIE_MAXALTER } from "@/lib/sitzung";
import { sitzungFuerMandant, zugaengeFuer } from "@/lib/zugang";

export const dynamic = "force-dynamic";

/**
 * Den Mandanten wechseln, ohne sich abzumelden.
 *
 * Der Wechsel stellt das Sitzungscookie neu aus. Das ist der einzige Weg:
 * Der Mandant der laufenden Transaktion kommt aus dem unterschriebenen
 * Cookie (lib/db.ts über mandantAusSitzung), nie aus einem Wert der
 * Anfrage. Ein Browser, der eine fremde Kennung schickt, bekommt kein
 * neues Cookie -- und damit auch keinen Zugriff.
 *
 * Geprüft wird in der Datenbank (zugaenge_fuer, db/035), und von dort
 * kommt auch die Rolle für den Zielmandanten. Dass die Rolle nicht aus
 * der Anfrage stammt, ist kein Detail: Sonst könnte sich jemand beim
 * Wechseln selbst zum Verwalter machen.
 *
 * Die Antwort unterscheidet nicht, warum ein Wechsel nicht geht. Ob der
 * Mandant nicht existiert, nicht freigegeben oder abgeschaltet ist --
 * immer 403 mit demselben Satz. Aus einer Unterscheidung liesse sich
 * ablesen, welche Mandanten es gibt.
 */
export async function POST(anfrage: Request) {
  const sitzung = await angemeldeteSitzung();
  if (!sitzung) {
    return NextResponse.json({ fehler: "nicht angemeldet" }, { status: 401 });
  }
  // Ein Mieterzugang hängt an einem Mietverhältnis. Er wechselt nirgendwohin.
  if (sitzung.rolle === "mieter") {
    return NextResponse.json({ fehler: "nicht berechtigt" }, { status: 403 });
  }

  let ziel = "";
  try {
    const body = await anfrage.json();
    if (body && typeof body === "object" && typeof body.mandant === "string") {
      ziel = body.mandant;
    }
  } catch {
    /* unten als fehlender Wert behandelt */
  }
  if (!ziel) {
    return NextResponse.json(
      { fehler: "Kein Zielmandant angegeben." },
      { status: 400 },
    );
  }

  // Schon da? Dann ist nichts zu tun -- und kein neues Cookie nötig.
  if (ziel === sitzung.mandant) {
    return NextResponse.json({ ok: true, unveraendert: true });
  }

  const neu = await sitzungFuerMandant(sitzung, ziel);
  if (!neu) {
    return NextResponse.json(
      { fehler: "Dieser Mandant steht dir nicht offen." },
      { status: 403 },
    );
  }

  const antwort = NextResponse.json({
    ok: true,
    mandant: neu.mandant,
    rolle: neu.rolle,
  });
  antwort.cookies.set(COOKIE_NAME, baueSitzung(neu), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAXALTER,
  });
  return antwort;
}

/** Welche Mandanten stehen offen? Für den Umschalter in der Kopfzeile. */
export async function GET() {
  const sitzung = await angemeldeteSitzung();
  if (!sitzung) {
    return NextResponse.json({ fehler: "nicht angemeldet" }, { status: 401 });
  }
  const offen = await zugaengeFuer(sitzung);
  return NextResponse.json({
    aktiv: sitzung.mandant,
    zugaenge: offen.map((z) => ({
      mandant: z.mandant,
      name: z.name,
      kuerzel: z.kuerzel,
      rolle: z.rolle,
      heimat: z.heimat,
    })),
  });
}
