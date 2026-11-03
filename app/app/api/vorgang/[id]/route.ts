import { NextResponse } from "next/server";
import { angemeldeteSitzung } from "@/lib/anmeldung";
import { tx } from "@/lib/db";
import { pruefeAenderung, type Ist, type Wunsch } from "@/lib/vorgangstatus";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Die eine schreibende Schnittstelle fuer den Vorgang selbst.
 *
 * Bis hierhin gab es keine. In app/api/ setzte nichts vorgang.status --
 * einziger Schreiber war der Agent ueber lib/versand.ts, der einen Vorgang
 * nach dem Versand auf "wartet" stellt. Die Uebersicht zaehlte "X offen",
 * und diese Zahl konnte der Verwalter nicht senken; die Liste wurde als
 * Arbeitsvorrat mit jedem Monat wertloser. Dasselbe bei einer falschen
 * Einordnung: Sie stand fest, bis jemand an die Datenbank ging.
 *
 * Abgrenzung zur Nachbarroute: /api/vorgang/[id]/entwurf ist die Tuer des
 * Agenten -- sie laesst sich mit dem Aufgabenschluessel oeffnen und holt
 * sich den Mandanten notfalls aus dem Vorgang. Diese Route hier ist
 * ausdruecklich NICHT so gebaut:
 *
 *   - Die Ausnahme in proxy.ts gilt nur fuer `^/api/vorgang/[^/]+/entwurf$`.
 *     Dieser Pfad passt nicht darauf, der Aufgabenschluessel oeffnet ihn
 *     also nicht. Wer hier schreibt, hat eine Sitzung.
 *   - Es gibt kein mitMandant(). Der Mandant kommt allein aus dem
 *     Sitzungscookie, wie ihn lib/db.ts liest, und die Abfrage unten
 *     filtert nur nach `id`. Den Rest macht die Policy aus db/010: Ein
 *     Vorgang eines anderen Mandanten liefert null Zeilen, und die Route
 *     antwortet 404 -- nicht 403, denn die Existenz einer fremden Akte
 *     ist selbst schon eine Auskunft.
 *   - Der Mandant wird nirgends aus dem Koerper gelesen. Es gaebe sonst
 *     einen Weg, ihn von aussen zu behaupten.
 *
 * Die Entscheidung, was erlaubt ist und was protokolliert wird, steht in
 * lib/vorgangstatus.ts und ist ohne Datenbank geprueft. Hier steht nur,
 * wer fragen darf und wie das Ergebnis in die Tabellen kommt.
 */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;

  // Muster wie app/api/mahnwesen/route.ts: Der Proxy haelt Mieter- und
  // Lesezugaenge schon ab. Die Pruefung steht hier trotzdem, weil eine
  // Route sich nicht darauf verlassen soll, wer vor ihr steht.
  const sitzung = await angemeldeteSitzung();
  if (!sitzung) {
    return NextResponse.json({ fehler: "nicht angemeldet" }, { status: 401 });
  }
  if (sitzung.rolle !== "verwalter") {
    return NextResponse.json(
      {
        fehler:
          "Dieser Zugang darf Vorgänge ansehen, aber nicht ändern. " +
          "Status, Kategorie und „heikel“ entscheidet die Verwaltung.",
      },
      { status: 403 },
    );
  }

  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json(
      { fehler: "Unplausible Vorgangskennung." },
      { status: 400 },
    );
  }

  const koerper = (await req.json().catch(() => null)) as Wunsch | null;
  if (!koerper || typeof koerper !== "object") {
    return NextResponse.json(
      { fehler: "Kein lesbarer Körper." },
      { status: 400 },
    );
  }

  try {
    const antwort = await tx(async (c) => {
      // FOR UPDATE: Zwei Browserfenster auf derselben Akte sind der
      // Normalfall, nicht die Ausnahme. Ohne Sperre lesen beide dasselbe
      // "heikel = true", beide schreiben false, und im Protokoll steht die
      // Aufhebung zweimal mit zwei Begruendungen -- oder, schlimmer, ein
      // Statuswechsel wird gegen einen Stand geprueft, den es nicht mehr
      // gibt.
      const r = await c.query<Ist>(
        `SELECT status, kategorie, heikel FROM vorgang
          WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (r.rows.length === 0) {
        return { status: 404, inhalt: { fehler: "Vorgang nicht gefunden." } };
      }

      const ist: Ist = {
        status: r.rows[0].status,
        kategorie: r.rows[0].kategorie,
        heikel: r.rows[0].heikel === true,
      };

      const p = pruefeAenderung(ist, koerper, sitzung.name);
      if (!p.ok) {
        return { status: p.code, inhalt: { fehler: p.fehler } };
      }

      await c.query(
        `UPDATE vorgang
            SET status = $2, kategorie = $3, heikel = $4, geaendert_am = now()
          WHERE id = $1`,
        [id, p.soll.status, p.soll.kategorie, p.soll.heikel],
      );

      // geaendert_am wird hier von Hand gesetzt. Der Trigger aus
      // db/001 (touch_vorgang) haengt an INSERT auf `nachricht` und
      // greift bei einer reinen Statusaenderung nicht -- die Uebersicht
      // sortiert aber nach geaendert_am, und ein gerade bearbeiteter
      // Vorgang, der unten bleibt, sieht wie ein verlorener Klick aus.

      for (const e of p.eintraege) {
        // nachricht_id bleibt leer: Diese Entscheidung haengt am Vorgang,
        // nicht an einer einzelnen Mail. mandant_id wird nicht gesetzt --
        // die Spalte hat DEFAULT aktueller_mandant() (db/010), und den
        // setzt lib/db.ts fuer die Dauer dieser Transaktion.
        await c.query(
          `INSERT INTO protokoll (vorgang_id, nachricht_id, ereignis, details)
           VALUES ($1, NULL, $2, $3::jsonb)`,
          [id, e.ereignis, JSON.stringify(e.details)],
        );
      }

      return {
        status: 200,
        inhalt: {
          ok: true,
          ...p.soll,
          protokolliert: p.eintraege.map((e) => e.ereignis),
        },
      };
    });

    return NextResponse.json(antwort.inhalt, { status: antwort.status });
  } catch (e) {
    console.error("[vorgang-patch]", e);
    return NextResponse.json({ fehler: (e as Error).message }, { status: 500 });
  }
}
