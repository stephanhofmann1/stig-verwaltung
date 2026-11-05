import { NextResponse } from "next/server";
import { angemeldeteSitzung } from "@/lib/anmeldung";
import { one, tx } from "@/lib/db";
import { HEIKLE_KATEGORIEN } from "@/lib/typen";
import { bearbeiteVorgang } from "@/lib/agent";
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
 *
 * ZWEI DINGE KOMMEN AM 03.11.2026 HINZU
 *
 *   1. `ohne_antwort`: Der Vorgang laesst sich mit Grund schliessen,
 *      ohne zu antworten (db/031). Die Pruefung steht wie alles andere
 *      in lib/vorgangstatus.ts. Hier wird zusaetzlich ein noch
 *      offener Entwurf verworfen -- sonst zaehlte ihn die Kennzahl
 *      "Entwuerfe" von lib/kennzahlen.ts weiter mit, obwohl auf diesen
 *      Vorgang bewusst nicht geantwortet wird.
 *
 *   2. `entwurf_nachziehen`: Berichtigt jemand die Kategorie aus einer
 *      heiklen heraus und hebt die Sperre auf, war bis hierhin Schluss
 *      -- der Agent laeuft nur ueber offene Faelle ohne Entwurf, und ein
 *      Vorgang, bei dem er schon einmal abgelehnt hat, bleibt ohne
 *      Entwurf liegen. Genau das fehlte am 03.11.2026. Der Entwurf wird
 *      deshalb auf Wunsch nachtraeglich erzeugt, und zwar NACH dem
 *      Festschreiben der Aenderung: bearbeiteVorgang() liest `heikel`
 *      erneut aus der Tabelle und wuerde innerhalb der Transaktion den
 *      alten Stand sehen.
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

  // --- Nur einen Entwurf nachziehen, ohne etwas zu aendern -----------
  //
  // Der haeufigste Ablauf nach einer Berichtigung ist: Kategorie
  // umbuchen (eine Aenderung), Sperre aufheben (eine zweite) -- und erst
  // dann faellt auf, dass noch kein Entwurf dasteht. Dieser dritte Klick
  // aendert am Vorgang nichts, und pruefeAenderung() wuerde ihn mit
  // "Nichts zu aendern" abweisen. Genau daran wuerde das Nachziehen
  // scheitern, und zwar in dem Moment, fuer den es gebaut ist.
  const nurNachziehen =
    (koerper as { entwurf_nachziehen?: unknown }).entwurf_nachziehen === true &&
    koerper.status === undefined &&
    koerper.kategorie === undefined &&
    koerper.heikel === undefined &&
    koerper.ohne_antwort === undefined;

  if (nurNachziehen) {
    try {
      const v = await one<{ heikel: boolean }>(
        `SELECT heikel FROM vorgang WHERE id = $1`,
        [id],
      );
      if (!v) {
        return NextResponse.json(
          { fehler: "Vorgang nicht gefunden." },
          { status: 404 },
        );
      }
      if (v.heikel === true) {
        // Dieselbe Sperre wie in api/vorgang/[id]/entwurf. Sie wird hier
        // nicht umgangen, nur weil der Weg ein anderer ist.
        return NextResponse.json(
          {
            fehler:
              "Vorgang ist als heikel markiert. Hier schreibt der Agent " +
              "keine Entwürfe vor — erst die Sperre mit Begründung aufheben.",
          },
          { status: 409 },
        );
      }
      const nachgezogen = (await bearbeiteVorgang(id)) ?? {
        fehler: "Vorgang hat keine eingegangene Nachricht als Bezug.",
      };
      return NextResponse.json({ ok: true, nachgezogen });
    } catch (e) {
      console.error("[vorgang-nachziehen]", e);
      return NextResponse.json(
        { fehler: (e as Error).message },
        { status: 500 },
      );
    }
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
        `SELECT status, kategorie, heikel, ohne_antwort_grund FROM vorgang
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
        ohne_antwort_grund: r.rows[0].ohne_antwort_grund ?? null,
      };

      const p = pruefeAenderung(ist, koerper, sitzung.name);
      if (!p.ok) {
        return { status: p.code, inhalt: { fehler: p.fehler } };
      }

      const ohneAntwort = p.soll.ohne_antwort_grund ?? null;
      await c.query(
        `UPDATE vorgang
            SET status = $2, kategorie = $3, heikel = $4,
                ohne_antwort_grund = $5,
                -- Den Zeitpunkt nur setzen, wenn ein Grund dasteht, und
                -- einen bestehenden nicht ueberschreiben: Wann der
                -- Vorgang ohne Antwort geschlossen wurde, ist eine Frage
                -- nach dem ersten Mal.
                ohne_antwort_am = CASE
                    WHEN $5::text IS NULL THEN NULL
                    ELSE COALESCE(ohne_antwort_am, now()) END,
                -- Die Kategorie zu berichtigen nimmt den Vermerk weg,
                -- dass kein Entwurf entstand: Der Grund von damals gilt
                -- fuer die alte Einordnung und wuerde sonst dauerhaft
                -- eine Begruendung behaupten, die nicht mehr stimmt.
                kein_entwurf_code = CASE
                    WHEN $3::text <> kategorie THEN NULL
                    ELSE kein_entwurf_code END,
                kein_entwurf_grund = CASE
                    WHEN $3::text <> kategorie THEN NULL
                    ELSE kein_entwurf_grund END,
                -- Von Hand berichtigt: Die Herkunft der Einordnung ist
                -- ab jetzt der Mensch und nicht mehr das Stichwort.
                einordnung_quelle = CASE
                    WHEN $3::text <> kategorie THEN 'mensch'
                    ELSE einordnung_quelle END,
                geaendert_am = now()
          WHERE id = $1`,
        [id, p.soll.status, p.soll.kategorie, p.soll.heikel, ohneAntwort],
      );

      // Wird ohne Antwort geschlossen, darf kein Entwurf offen bleiben.
      // ladeFreigabestand() in lib/kennzahlen.ts zaehlt Entwuerfe ueber
      // `nachricht.status = 'entwurf'` und sieht den Vorgangsstatus
      // nicht an -- ein liegengebliebener Entwurf stuende also weiter in
      // der Zahl "wartet auf Freigabe", bei einem Vorgang, auf den
      // bewusst nicht geantwortet wird.
      let verworfen = 0;
      if (ohneAntwort && !(ist.ohne_antwort_grund ?? null)) {
        const v = await c.query(
          `UPDATE nachricht SET status = 'verworfen'
            WHERE vorgang_id = $1 AND status = 'entwurf'
          RETURNING id`,
          [id],
        );
        verworfen = v.rows.length;
        for (const z of v.rows as Array<{ id: string }>) {
          await c.query(
            `INSERT INTO protokoll (vorgang_id, nachricht_id, ereignis, details)
             VALUES ($1,$2,'entwurf_verworfen',$3::jsonb)`,
            [
              id,
              z.id,
              JSON.stringify({
                grund: "Vorgang ohne Antwort geschlossen.",
                wer: sitzung.name,
              }),
            ],
          );
        }
      }

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
          entwuerfe_verworfen: verworfen,
          protokolliert: p.eintraege.map((e) => e.ereignis),
        },
      };
    });

    // --- Entwurf nachziehen ------------------------------------------
    //
    // Ausserhalb der Transaktion, siehe Kopf dieser Datei. Scheitert es,
    // bleibt die Berichtigung bestehen -- sie ist das Wichtigere, und ein
    // fehlender Entwurf laesst sich mit einem zweiten Klick holen.
    let nachgezogen: unknown = undefined;
    if (
      antwort.status === 200 &&
      (koerper as { entwurf_nachziehen?: unknown }).entwurf_nachziehen === true
    ) {
      try {
        nachgezogen = (await bearbeiteVorgang(id)) ?? {
          fehler: "Vorgang hat keine eingegangene Nachricht als Bezug.",
        };
      } catch (e) {
        console.error("[vorgang-patch-nachziehen]", e);
        nachgezogen = { fehler: (e as Error).message };
      }
    }

    return NextResponse.json(
      nachgezogen === undefined
        ? antwort.inhalt
        : { ...antwort.inhalt, nachgezogen },
      { status: antwort.status },
    );
  } catch (e) {
    console.error("[vorgang-patch]", e);
    return NextResponse.json({ fehler: (e as Error).message }, { status: 500 });
  }
}

/**
 * Der Steuerungsstand eines Vorgangs, fuer die Schalter in der Akte.
 *
 * Warum eine eigene Methode und kein Prop der Seite: Die Vorgangsakte
 * (app/vorgang/[id]/page.tsx) rendert den Schalter mit Status, Kategorie
 * und `heikel`. Die neuen Angaben -- woraus die Einordnung entstand, ob
 * ohne Antwort geschlossen wurde, ob ein Entwurf nachgezogen werden kann
 * -- holt der Schalter sich hier selbst. So bleibt die Seite unberuehrt
 * und zeigt trotzdem denselben Stand.
 */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json(
      { fehler: "Unplausible Vorgangskennung." },
      { status: 400 },
    );
  }
  const sitzung = await angemeldeteSitzung();
  if (!sitzung) {
    return NextResponse.json({ fehler: "nicht angemeldet" }, { status: 401 });
  }

  try {
    const v = await one<{
      status: string;
      kategorie: string;
      heikel: boolean;
      einordnung_quelle: string | null;
      einordnung_stichwort: string | null;
      einordnung_fundstelle: string | null;
      kein_entwurf_code: string | null;
      kein_entwurf_grund: string | null;
      ohne_antwort_grund: string | null;
      ohne_antwort_am: string | null;
      offene_entwuerfe: number;
      hat_eingang: boolean;
    }>(
      `SELECT v.status, v.kategorie, v.heikel,
              v.einordnung_quelle, v.einordnung_stichwort,
              v.einordnung_fundstelle,
              v.kein_entwurf_code, v.kein_entwurf_grund,
              v.ohne_antwort_grund, v.ohne_antwort_am::text,
              (SELECT count(*)::int FROM nachricht n
                WHERE n.vorgang_id = v.id AND n.status = 'entwurf')
                AS offene_entwuerfe,
              EXISTS (SELECT 1 FROM nachricht n
                       WHERE n.vorgang_id = v.id AND n.richtung = 'ein')
                AS hat_eingang
         FROM vorgang v
        WHERE v.id = $1`,
      [id],
    );
    if (!v) {
      return NextResponse.json(
        { fehler: "Vorgang nicht gefunden." },
        { status: 404 },
      );
    }

    return NextResponse.json({
      ok: true,
      ...v,
      // Die Frage, die der Schalter stellt: Darf hier jetzt ein Entwurf
      // nachgezogen werden? Sie wird hier beantwortet und nicht im
      // Browser nachgebaut.
      entwurf_nachziehbar:
        v.heikel !== true &&
        v.offene_entwuerfe === 0 &&
        v.hat_eingang === true &&
        v.kategorie !== "werbung" &&
        !(HEIKLE_KATEGORIEN as string[]).includes(v.kategorie) &&
        !(v.ohne_antwort_grund ?? "").trim(),
    });
  } catch (e) {
    console.error("[vorgang-get]", e);
    return NextResponse.json({ fehler: (e as Error).message }, { status: 500 });
  }
}
