import { NextResponse } from "next/server";
import { angemeldeteSitzung } from "@/lib/anmeldung";
import { query } from "@/lib/db";
import { sollStilllegen } from "@/lib/fints/abruf";
import { starteAbruf } from "@/lib/fints/interaktiv";

export const dynamic = "force-dynamic";

/** Startet einen Abruf von Hand. Nur für Verwalter. */
export async function POST(req: Request) {
  const sitzung = await angemeldeteSitzung();
  if (!sitzung || sitzung.rolle === "mieter") {
    return NextResponse.json({ fehler: "nicht berechtigt" }, { status: 403 });
  }
  const form = await req.formData();
  const id = String(form.get("zugang") ?? "");
  if (!id) return NextResponse.json({ fehler: "Zugang fehlt" }, { status: 400 });

  const ergebnis = await starteAbruf(id);

  /*
    Den Fehler festhalten, nicht nur zurückgeben.

    Vorher ging die Meldung allein an den Browser. Sie stand einen
    Augenblick unter dem Knopf und war beim nächsten Laden der Seite
    verschwunden -- mitsamt dem Rückmeldecode der Bank, dem einzigen
    Hinweis, der beim Einrichten wirklich weiterhilft. Wer dann jemanden
    um Rat fragt, kann nur noch sagen "es ging nicht".

    Der nächtliche Lauf schreibt den Fehler längst mit (holen.ts). Dass
    ausgerechnet der Weg von Hand es nicht tat, fiel nicht auf, weil
    beide Wege dieselbe Seite füllen -- nur eben der eine nie.

    Dieselbe Stilllegung wie dort: Lehnt die Bank die Zugangsdaten ab,
    ruht der Zugang, damit der Lauf um 18:00 nicht den nächsten
    Fehlversuch verbraucht. Ein Netzfehler tut das nicht.
  */
  if (ergebnis.art === "fehler") {
    const stillegen = sollStilllegen(ergebnis);
    await query(
      `UPDATE fints_zugang
          SET letzter_fehler = $2,
              aktiv = CASE WHEN $3::boolean THEN false ELSE aktiv END
        WHERE id = $1`,
      [id, ergebnis.meldung.slice(0, 2000), stillegen],
    );
  } else {
    // Ein geglückter Abruf räumt den alten Fehler weg, sonst steht er
    // dort noch, wenn längst alles läuft.
    await query(
      `UPDATE fints_zugang SET letzter_fehler = NULL WHERE id = $1`,
      [id],
    );
  }

  return NextResponse.json(ergebnis);
}
