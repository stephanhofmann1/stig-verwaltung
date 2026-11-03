import { NextResponse } from "next/server";
import { angemeldeteSitzung } from "@/lib/anmeldung";
import { tx } from "@/lib/db";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Die wirtschaftlichen Stammdaten eines Objekts schreiben (db/030).
 *
 * Zehn Felder, die niemand ableiten kann: Kaufpreis, Kaufnebenkosten,
 * Kaufdatum, Verkehrswert, Bewirtschaftungsansatz, Instandhaltungsansatz,
 * Mietausfallwagnis und die drei Darlehenswerte. Alles Gerechnete steht in
 * lib/rendite.ts und wird nicht gespeichert -- eine gespeicherte Rendite
 * wäre ab dem nächsten Mietverhältnis falsch, ohne dass es jemand merkt.
 *
 * Gebaut wie app/api/vorgang/[id]/route.ts, und aus denselben Gründen:
 *
 *   - Nur PATCH. Objekte werden hier nicht angelegt und nicht gelöscht.
 *   - Es gibt kein mitMandant(). Der Mandant kommt allein aus dem
 *     Sitzungscookie, wie lib/db.ts ihn liest; die Abfrage filtert nur
 *     nach `id`. Den Rest macht die Policy aus db/010: Ein Objekt eines
 *     anderen Mandanten liefert null Zeilen, und die Route antwortet 404
 *     -- nicht 403, denn die Existenz eines fremden Hauses ist selbst
 *     schon eine Auskunft.
 *   - Der Mandant wird nirgends aus dem Körper gelesen. Es gäbe sonst
 *     einen Weg, ihn von aussen zu behaupten.
 *
 * Zur Semantik der Felder, und sie ist hier wichtiger als sonst:
 *
 *   nicht gesendet  bleibt unverändert (COALESCE)
 *   leerer String   löscht den Wert (NULL)
 *   0               ist ein Wert und heisst etwas -- bei den
 *                   Darlehensfeldern "schuldenfrei"
 *
 * Die Unterscheidung zwischen leer und 0 ist der Grund, weshalb die Route
 * Strings annimmt und nicht Zahlen. Mit Zahlen wäre `null` beides: "nicht
 * gesendet" und "löschen", und JSON kennt für ein geleertes Zahlenfeld
 * keine dritte Möglichkeit. lib/rendite.ts baut darauf auf: NULL heisst
 * "unbekannt" und ergibt eine Kennzahl ohne Zahl, 0 heisst "schuldenfrei"
 * und ergibt eine Kennzahl mit Zahl.
 */

/** Die zehn Felder aus db/030, mit ihrer Prüfung. */
const FELDER = {
  kaufpreis: { art: "zahl", min: 0, max: 99_999_999.99 },
  kaufnebenkosten: { art: "zahl", min: 0, max: 99_999_999.99 },
  kaufdatum: { art: "datum" },
  verkehrswert: { art: "zahl", min: 0, max: 99_999_999.99 },
  bewirtschaftung_jahr: { art: "zahl", min: 0, max: 99_999_999.99 },
  instandhaltung_je_qm: { art: "zahl", min: 0, max: 9_999.99 },
  mietausfallwagnis_satz: { art: "zahl", min: 0, max: 100 },
  darlehen_restschuld: { art: "zahl", min: 0, max: 99_999_999.99 },
  darlehen_zins_satz: { art: "zahl", min: 0, max: 99.999 },
  darlehen_rate_monat: { art: "zahl", min: 0, max: 99_999_999.99 },
} as const;

type Feld = keyof typeof FELDER;
const FELDNAMEN = Object.keys(FELDER) as Feld[];

/**
 * Macht aus einer Eingabe einen Wert, ein Löschen oder einen Fehler.
 *
 * Deutsches Dezimalkomma wird angenommen: Das Formular lässt "1.234,56"
 * eintippen, weil der Eigentümer Beträge so schreibt. Der Punkt als
 * Tausendertrennzeichen fällt weg, das Komma wird zum Punkt. Eine Eingabe
 * mit Punkt als Dezimaltrenner ("1234.56") bleibt ebenfalls lesbar -- aber
 * nur, wenn kein Komma dabei ist, sonst wäre "1.234" nicht entscheidbar.
 */
function pruefe(
  feld: Feld,
  roh: unknown,
): { ok: true; wert: string | null } | { ok: false; fehler: string } {
  if (typeof roh !== "string") {
    return { ok: false, fehler: `${feld}: nur Text wird angenommen.` };
  }
  const text = roh.trim();
  // Leer heisst löschen. Das ist der einzige Weg, einen gepflegten Wert
  // wieder loszuwerden, und er muss von "0" unterscheidbar bleiben.
  if (text === "") return { ok: true, wert: null };

  const regel = FELDER[feld];
  if (regel.art === "datum") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      return { ok: false, fehler: `${feld}: Datum als JJJJ-MM-TT erwartet.` };
    }
    // Date.parse nimmt auch den 32. eines Monats an und rechnet weiter.
    const d = new Date(`${text}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== text) {
      return { ok: false, fehler: `${feld}: „${text}“ ist kein Datum.` };
    }
    return { ok: true, wert: text };
  }

  const hatKomma = text.includes(",");
  const normiert = hatKomma ? text.replace(/\./g, "").replace(",", ".") : text;
  if (!/^-?\d+(\.\d+)?$/.test(normiert)) {
    return { ok: false, fehler: `${feld}: „${text}“ ist keine Zahl.` };
  }
  const n = Number(normiert);
  if (!Number.isFinite(n)) {
    return { ok: false, fehler: `${feld}: „${text}“ ist keine Zahl.` };
  }
  if (n < regel.min || n > regel.max) {
    // Die Grenzen sind die der Spalten aus db/030. Ohne Prüfung käme hier
    // ein Datenbankfehler mit SQL-Text zurück, und der sagt dem Eigentümer
    // nichts.
    return {
      ok: false,
      fehler:
        `${feld}: ${n} liegt ausserhalb des Zulässigen ` +
        `(${regel.min} bis ${regel.max}).`,
    };
  }
  return { ok: true, wert: normiert };
}

interface Zeile {
  kaufpreis: string | null;
  kaufnebenkosten: string | null;
  kaufdatum: string | null;
  verkehrswert: string | null;
  bewirtschaftung_jahr: string | null;
  instandhaltung_je_qm: string | null;
  mietausfallwagnis_satz: string | null;
  darlehen_restschuld: string | null;
  darlehen_zins_satz: string | null;
  darlehen_rate_monat: string | null;
}

const LESEN = `
    SELECT kaufpreis::text, kaufnebenkosten::text, kaufdatum::text,
           verkehrswert::text, bewirtschaftung_jahr::text,
           instandhaltung_je_qm::text, mietausfallwagnis_satz::text,
           darlehen_restschuld::text, darlehen_zins_satz::text,
           darlehen_rate_monat::text
      FROM objekt WHERE id = $1`;

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;

  // Muster wie app/api/vorgang/[id]/route.ts: Der Proxy hält Mieter- und
  // Lesezugänge schon ab. Die Prüfung steht hier trotzdem, weil eine Route
  // sich nicht darauf verlassen soll, wer vor ihr steht.
  const sitzung = await angemeldeteSitzung();
  if (!sitzung) {
    return NextResponse.json({ fehler: "nicht angemeldet" }, { status: 401 });
  }
  if (sitzung.rolle !== "verwalter") {
    return NextResponse.json(
      {
        fehler:
          "Dieser Zugang darf die Zahlen ansehen, aber nicht ändern. " +
          "Kaufpreis und Finanzierung pflegt die Verwaltung.",
      },
      { status: 403 },
    );
  }

  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json(
      { fehler: "Unplausible Objektkennung." },
      { status: 400 },
    );
  }

  const koerper = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!koerper || typeof koerper !== "object") {
    return NextResponse.json({ fehler: "Kein lesbarer Körper." }, { status: 400 });
  }

  const unbekannt = Object.keys(koerper).filter(
    (k) => !FELDNAMEN.includes(k as Feld),
  );
  if (unbekannt.length > 0) {
    // Lieber abweisen als stillschweigend übergehen: Ein Tippfehler im
    // Feldnamen sähe sonst wie ein erfolgreiches Speichern aus, und der
    // Wert wäre weg.
    return NextResponse.json(
      { fehler: `Unbekannte Felder: ${unbekannt.join(", ")}.` },
      { status: 400 },
    );
  }

  const werte = new Map<Feld, string | null>();
  for (const feld of FELDNAMEN) {
    if (!(feld in koerper)) continue;
    const p = pruefe(feld, koerper[feld]);
    if (!p.ok) return NextResponse.json({ fehler: p.fehler }, { status: 400 });
    werte.set(feld, p.wert);
  }

  if (werte.size === 0) {
    return NextResponse.json(
      { fehler: "Kein Feld zum Ändern dabei." },
      { status: 400 },
    );
  }

  try {
    const antwort = await tx(async (c) => {
      // FOR UPDATE wie in app/api/vorgang/[id]/route.ts: Zwei
      // Browserfenster auf derselben Objektseite sind der Normalfall. Ohne
      // Sperre lesen beide denselben Vorherwert, und im Protokoll steht
      // eine Änderung, die von einem Stand ausgeht, den es nicht mehr gibt.
      const vorher = await c.query<Zeile>(`${LESEN} FOR UPDATE`, [id]);
      if (vorher.rows.length === 0) {
        return { status: 404, inhalt: { fehler: "Objekt nicht gefunden." } };
      }

      // COALESCE-Semantik wie in app/api/stammdaten/route.ts, aber mit
      // einer Erweiterung: Dort lässt sich ein Wert nicht leeren, weil
      // "nicht gesendet" und "leeren" dasselbe $n sind. Hier werden nur
      // die gesendeten Felder in das SET aufgenommen; ein gesendetes
      // leeres Feld wird damit zu NULL, ein nicht gesendetes kommt im
      // Statement gar nicht vor.
      const felder = [...werte.keys()];
      const setzen = felder
        .map((f, i) => {
          const guss = FELDER[f].art === "datum" ? "date" : "numeric";
          return `${f} = $${i + 2}::${guss}`;
        })
        .join(", ");

      await c.query(
        `UPDATE objekt SET ${setzen} WHERE id = $1`,
        [id, ...felder.map((f) => werte.get(f) ?? null)],
      );

      const nachher = await c.query<Zeile>(LESEN, [id]);

      // Protokolleintrag mit vorher/nachher, nur über die geänderten
      // Felder. vorgang_id bleibt leer: Diese Änderung hängt am Objekt,
      // nicht an einer Akte (die Spalte ist in db/001 NULL-bar). mandant_id
      // wird nicht gesetzt -- die Spalte hat DEFAULT aktueller_mandant()
      // (db/010), und den setzt lib/db.ts für diese Transaktion.
      //
      // Protokolliert wird, weil ein Kaufpreis die Grundlage jeder Rendite
      // auf dieser Seite ist. Wer in einem Jahr fragt, warum die Rendite
      // von 5,5 % auf 3,2 % gefallen ist, soll hier lesen können, dass
      // nicht die Mieten gefallen, sondern die Nebenkosten nachgetragen
      // worden sind.
      const geaendert: Record<string, { vorher: string | null; nachher: string | null }> = {};
      for (const f of felder) {
        geaendert[f] = {
          vorher: vorher.rows[0][f],
          nachher: nachher.rows[0][f],
        };
      }

      await c.query(
        `INSERT INTO protokoll (vorgang_id, nachricht_id, ereignis, details)
         VALUES (NULL, NULL, $1, $2::jsonb)`,
        [
          "objekt_wirtschaft_geaendert",
          JSON.stringify({
            objekt_id: id,
            von: sitzung.name,
            felder: geaendert,
          }),
        ],
      );

      return {
        status: 200,
        inhalt: {
          ok: true,
          geaendert: felder,
          stand: nachher.rows[0],
        },
      };
    });

    return NextResponse.json(antwort.inhalt, { status: antwort.status });
  } catch (e) {
    console.error("[objekt-wirtschaft]", e);
    return NextResponse.json({ fehler: (e as Error).message }, { status: 500 });
  }
}
