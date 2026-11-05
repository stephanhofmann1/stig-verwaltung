import { NextResponse } from "next/server";
import { angemeldeteSitzung } from "@/lib/anmeldung";
import { tx } from "@/lib/db";
import {
  ladeWeisungen,
  pruefeWeisung,
  WEISUNG_MAX_LAENGE,
  type Weisung,
} from "@/lib/weisungen";

export const dynamic = "force-dynamic";

/**
 * Die Dauerweisungen an den Entwurfsagenten.
 *
 * Gebaut nach dem Muster von api/vorgang/[id]/route.ts, und aus
 * demselben Grund wie dort noch etwas strenger:
 *
 *   - Kein mitMandant(). Der Mandant kommt allein aus dem
 *     Sitzungscookie, wie ihn lib/db.ts liest. Die Policy aus db/031
 *     erledigt den Rest: Eine Weisung eines anderen Mandanten liefert
 *     null Zeilen, und das Ändern einer fremden trifft nichts.
 *   - Der Aufgabenschlüssel öffnet diesen Pfad nicht. Die Ausnahme in
 *     proxy.ts gilt nur für `^/api/vorgang/[^/]+/entwurf$`. Der Agent
 *     soll Weisungen befolgen, nicht schreiben.
 *   - Schreiben darf nur die Rolle "verwalter". Eine Weisung prägt jeden
 *     künftigen Entwurf — das ist mehr Wirkung als das Ändern einer
 *     einzelnen Mail, nicht weniger.
 *
 * Warum das hier besonders zählt: Der Text einer Weisung wandert in
 * einen Prompt. Eine über die Mandantengrenze gelesene oder geschriebene
 * Weisung verändert die Geschäftskorrespondenz eines fremden
 * Unternehmens, und beim Empfänger kommt das als Absicht des Absenders
 * an. Siehe Kopf von lib/weisungen.ts und db/031.
 */

type Sitzung = NonNullable<Awaited<ReturnType<typeof angemeldeteSitzung>>>;
type Zugang =
  | { fehler: NextResponse; sitzung?: undefined }
  | { fehler?: undefined; sitzung: Sitzung };

async function verwalter(): Promise<Zugang> {
  const sitzung = await angemeldeteSitzung();
  if (!sitzung) {
    return {
      fehler: NextResponse.json(
        { fehler: "nicht angemeldet" },
        { status: 401 },
      ),
    };
  }
  if (sitzung.rolle !== "verwalter") {
    return {
      fehler: NextResponse.json(
        {
          fehler:
            "Dieser Zugang darf die Weisungen lesen, aber nicht ändern. " +
            "Eine Weisung prägt jeden künftigen Entwurf.",
        },
        { status: 403 },
      ),
    };
  }
  return { sitzung };
}

/** Alle Weisungen, auch die abgeschalteten. */
export async function GET() {
  const sitzung = await angemeldeteSitzung();
  if (!sitzung) {
    return NextResponse.json({ fehler: "nicht angemeldet" }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, weisungen: await ladeWeisungen() });
  } catch (e) {
    console.error("[weisungen-get]", e);
    return NextResponse.json({ fehler: (e as Error).message }, { status: 500 });
  }
}

/** Neue Weisung anlegen. */
export async function POST(req: Request) {
  const w = await verwalter();
  if (w.fehler) return w.fehler;

  const koerper = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!koerper || typeof koerper !== "object") {
    return NextResponse.json({ fehler: "Kein lesbarer Körper." }, { status: 400 });
  }

  const p = pruefeWeisung(koerper);
  if (!p.ok) return NextResponse.json({ fehler: p.fehler }, { status: 400 });

  try {
    const zeile = await tx(async (c) => {
      const r = await c.query<Weisung>(
        `INSERT INTO weisung (ebene, kategorie, kontakt_id, weisungstext, rang)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT ON CONSTRAINT weisung_eindeutig DO NOTHING
         RETURNING id, ebene, kategorie, kontakt_id, weisungstext, aktiv, rang`,
        [p.ebene, p.kategorie, p.kontaktId, p.weisungstext, p.rang],
      );
      return r.rows[0] ?? null;
    });

    if (!zeile) {
      // Die Bedingung aus db/031 führt mandant_id als erste Spalte --
      // "schon vorhanden" heisst hier also wirklich "bei DIESEM
      // Mandanten schon vorhanden" und verrät nichts über andere.
      return NextResponse.json(
        {
          fehler:
            "Diese Weisung steht auf dieser Ebene wortgleich schon da. " +
            "Zwei gleichlautende würden beide in jeden Prompt wandern.",
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true, weisung: zeile });
  } catch (e) {
    console.error("[weisungen-post]", e);
    return NextResponse.json({ fehler: (e as Error).message }, { status: 500 });
  }
}

/** Text ändern, abschalten, wieder einschalten, Rang setzen. */
export async function PATCH(req: Request) {
  const w = await verwalter();
  if (w.fehler) return w.fehler;

  const koerper = (await req.json().catch(() => null)) as {
    id?: unknown;
    weisungstext?: unknown;
    aktiv?: unknown;
    rang?: unknown;
  } | null;

  if (!koerper || typeof koerper.id !== "string") {
    return NextResponse.json(
      { fehler: "Es fehlt die Kennung der Weisung." },
      { status: 400 },
    );
  }
  if (!/^[0-9a-f-]{36}$/i.test(koerper.id)) {
    return NextResponse.json({ fehler: "Unplausible Kennung." }, { status: 400 });
  }

  const felder: string[] = [];
  const werte: unknown[] = [koerper.id];

  if (koerper.weisungstext !== undefined) {
    const text =
      typeof koerper.weisungstext === "string" ? koerper.weisungstext.trim() : "";
    if (text.length < 3) {
      return NextResponse.json(
        { fehler: "Die Weisung braucht einen Text von mindestens drei Zeichen." },
        { status: 400 },
      );
    }
    if (text.length > WEISUNG_MAX_LAENGE) {
      return NextResponse.json(
        {
          fehler:
            `Länger als ${WEISUNG_MAX_LAENGE} Zeichen verdrängt die Weisung ` +
            "den Mailverlauf im Prompt.",
        },
        { status: 400 },
      );
    }
    werte.push(text);
    felder.push(`weisungstext = $${werte.length}`);
  }
  if (typeof koerper.aktiv === "boolean") {
    werte.push(koerper.aktiv);
    felder.push(`aktiv = $${werte.length}`);
  }
  if (typeof koerper.rang === "number" && Number.isFinite(koerper.rang)) {
    werte.push(Math.trunc(koerper.rang));
    felder.push(`rang = $${werte.length}`);
  }

  if (felder.length === 0) {
    return NextResponse.json({ fehler: "Nichts zu ändern." }, { status: 400 });
  }
  felder.push("geaendert_am = now()");

  try {
    const zeile = await tx(async (c) => {
      const r = await c.query<Weisung>(
        `UPDATE weisung SET ${felder.join(", ")}
          WHERE id = $1
        RETURNING id, ebene, kategorie, kontakt_id, weisungstext, aktiv, rang`,
        werte,
      );
      return r.rows[0] ?? null;
    });
    if (!zeile) {
      // 404 und nicht 403: Die Existenz einer fremden Weisung ist selbst
      // schon eine Auskunft. Dieselbe Begründung wie in
      // api/vorgang/[id]/route.ts.
      return NextResponse.json(
        { fehler: "Weisung nicht gefunden." },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, weisung: zeile });
  } catch (e) {
    console.error("[weisungen-patch]", e);
    return NextResponse.json({ fehler: (e as Error).message }, { status: 500 });
  }
}

/**
 * Endgültig entfernen.
 *
 * Der normale Weg ist Abschalten (PATCH aktiv=false): Eine Weisung hat
 * Entwürfe geprägt, die versendet wurden, und wer später fragt, warum
 * eine Mail so klang, soll sie noch finden. Löschen ist für den Tippfehler
 * von vor zwei Minuten.
 *
 * Die Momentaufnahme in entwurf_fassung.weisungen bleibt davon unberührt
 * — sie ist bewusst kopiert und nicht verwiesen (db/031).
 */
export async function DELETE(req: Request) {
  const w = await verwalter();
  if (w.fehler) return w.fehler;

  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ fehler: "Unplausible Kennung." }, { status: 400 });
  }

  try {
    const weg = await tx(async (c) => {
      const r = await c.query(`DELETE FROM weisung WHERE id = $1 RETURNING id`, [
        id,
      ]);
      return r.rows.length > 0;
    });
    if (!weg) {
      return NextResponse.json(
        { fehler: "Weisung nicht gefunden." },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[weisungen-delete]", e);
    return NextResponse.json({ fehler: (e as Error).message }, { status: 500 });
  }
}
