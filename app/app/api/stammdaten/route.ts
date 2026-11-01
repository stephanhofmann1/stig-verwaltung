import { NextResponse } from "next/server";
import { query, one, tx } from "@/lib/db";
import { erzeugeSollstellungen } from "@/lib/sollstellung";

export const dynamic = "force-dynamic";

/**
 * Stammdatenpflege: Mieter samt Mietverhaeltnis anlegen und aendern.
 * Nach jeder Aenderung werden die Sollstellungen nachgezogen, damit der
 * Kontoabgleich sofort etwas zum Pruefen hat.
 */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as {
    aktion?: string;
    kontakt_id?: string;
    mietverhaeltnis_id?: string;
    name?: string;
    email?: string;
    telefon?: string;
    einheit_id?: string;
    beginn?: string;
    ende?: string | null;
    kaltmiete?: number;
    nebenkosten?: number;
    kaution?: number;
    zahlt_im_voraus?: boolean;
    zahlungsnotiz?: string;
    muster?: string;
  } | null;

  if (!b?.aktion) {
    return NextResponse.json({ fehler: "aktion fehlt" }, { status: 400 });
  }

  try {
    switch (b.aktion) {
      case "mieter_anlegen": {
        if (!b.name?.trim() || !b.einheit_id || !b.beginn) {
          return NextResponse.json(
            { fehler: "Name, Einheit und Mietbeginn sind nötig" },
            { status: 400 },
          );
        }
        const ergebnis = await tx(async (c) => {
          const k = await c.query<{ id: string }>(
            `INSERT INTO kontakt (anzeigename, rolle, telefon)
             VALUES ($1,'mieter',$2) RETURNING id`,
            [b.name!.trim(), b.telefon?.trim() || null],
          );
          if (b.email?.trim()) {
            await c.query(
              `INSERT INTO kontakt_email (kontakt_id, email, ist_primaer)
               VALUES ($1,$2,true) ON CONFLICT (email) DO NOTHING`,
              [k.rows[0].id, b.email.trim().toLowerCase()],
            );
          }
          const mv = await c.query<{ id: string }>(
            `INSERT INTO mietverhaeltnis
               (einheit_id, kontakt_id, beginn, ende, kaltmiete, nebenkosten,
                kaution, zahlt_im_voraus, zahlungsnotiz)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
            [b.einheit_id, k.rows[0].id, b.beginn, b.ende || null,
             b.kaltmiete ?? null, b.nebenkosten ?? null, b.kaution ?? null,
             b.zahlt_im_voraus ?? false, b.zahlungsnotiz?.trim() || null],
          );
          return { kontakt_id: k.rows[0].id, mietverhaeltnis_id: mv.rows[0].id };
        });
        const soll = await erzeugeSollstellungen();
        return NextResponse.json({ ok: true, ...ergebnis, soll });
      }

      case "mietverhaeltnis_aendern": {
        if (!b.mietverhaeltnis_id) {
          return NextResponse.json({ fehler: "mietverhaeltnis_id fehlt" }, { status: 400 });
        }
        await query(
          `UPDATE mietverhaeltnis
              SET ende = COALESCE($2::date, ende),
                  kaltmiete = COALESCE($3::numeric, kaltmiete),
                  nebenkosten = COALESCE($4::numeric, nebenkosten),
                  zahlt_im_voraus = COALESCE($5::boolean, zahlt_im_voraus),
                  zahlungsnotiz = COALESCE($6, zahlungsnotiz)
            WHERE id = $1`,
          [b.mietverhaeltnis_id, b.ende ?? null, b.kaltmiete ?? null,
           b.nebenkosten ?? null, b.zahlt_im_voraus ?? null,
           b.zahlungsnotiz?.trim() || null],
        );
        const soll = await erzeugeSollstellungen();
        return NextResponse.json({ ok: true, soll });
      }

      case "zahlerkennung_anlegen": {
        if (!b.kontakt_id || !b.muster?.trim()) {
          return NextResponse.json(
            { fehler: "kontakt_id und muster sind nötig" },
            { status: 400 },
          );
        }
        const k = await one(`SELECT id FROM kontakt WHERE id = $1`, [b.kontakt_id]);
        if (!k) return NextResponse.json({ fehler: "Kontakt unbekannt" }, { status: 404 });
        await query(
          `INSERT INTO zahlerkennung (kontakt_id, muster, feld, notizen)
           VALUES ($1,$2,'beide',$3)
           ON CONFLICT (kontakt_id, muster) DO NOTHING`,
          [b.kontakt_id, b.muster.trim(), "Von Hand eingetragen."],
        );
        return NextResponse.json({ ok: true });
      }

      default:
        return NextResponse.json({ fehler: `Aktion "${b.aktion}" unbekannt` }, { status: 400 });
    }
  } catch (e) {
    console.error("[stammdaten]", e);
    return NextResponse.json({ fehler: (e as Error).message }, { status: 500 });
  }
}
