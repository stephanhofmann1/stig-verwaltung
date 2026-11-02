import { NextResponse } from "next/server";
import { angemeldeteSitzung } from "@/lib/anmeldung";
import { mahnbereitschaft, NichtFreigegeben, freigabe } from "@/lib/mahnfreigabe";
import { mahnstand } from "@/lib/rueckstaende";
import {
  darfEntscheiden,
  darfEntwerfen,
  entscheidungen,
  entwerfeMahnung,
  erteileFreigabe,
  freigabeKnopf,
  istZurueckgestellt,
  legeWiederVor,
  letzteEntscheidungen,
  nimmFreigabeZurueck,
  pruefeGrund,
  pruefeVerschiebung,
  setzeAus,
  verschiebe,
} from "@/lib/mahnablauf";

export const dynamic = "force-dynamic";

/**
 * Die eine schreibende Schnittstelle des Mahnwesens.
 *
 * Sie kann genau fünf Dinge: das Mahnwesen freigeben, die Freigabe
 * zurücknehmen, einen Entwurf anlegen, einen Fall verschieben und einen
 * Fall aussetzen (plus das Zurücknehmen der beiden Letzteren). Was sie
 * nicht kann, ist der Punkt: Es gibt hier keinen Weg, eine Mail zu
 * verschicken. Der Versand liegt allein in der Freigabe-Warteschlange,
 * und auch dort drückt ein Mensch.
 *
 * Nichts aus dem Browser wird geglaubt. Die Stufe und der offene Betrag
 * werden hier neu aus lib/rueckstaende.ts geholt, die Bereitschaftsliste
 * neu erhoben. Der Browser schickt nur, welcher Fall gemeint ist und was
 * entschieden wurde.
 */

type Aktion =
  | "freigeben"
  | "sperren"
  | "entwerfen"
  | "verschieben"
  | "nicht_mahnen"
  | "wieder_vorlegen";

interface Koerper {
  aktion?: string;
  mietverhaeltnis_id?: string;
  notiz?: string;
  grund?: string;
  bis?: string;
}

const AKTIONEN: Aktion[] = [
  "freigeben",
  "sperren",
  "entwerfen",
  "verschieben",
  "nicht_mahnen",
  "wieder_vorlegen",
];

const fehler = (text: string, status = 400) =>
  NextResponse.json({ fehler: text }, { status });

export async function POST(req: Request) {
  const sitzung = await angemeldeteSitzung();

  // Muster wie app/api/bank/route.ts: Mieterzugänge werden abgewiesen, und
  // ein Zugang mit der Rolle "lesen" darf nichts schreiben. Der Proxy hält
  // beides schon ab; die Prüfung steht hier trotzdem, weil eine Route sich
  // nicht darauf verlassen soll, wer vor ihr steht.
  const erlaubnis = darfEntscheiden(sitzung?.rolle ?? null);
  if (!erlaubnis.erlaubt) {
    return NextResponse.json(
      { fehler: erlaubnis.grund },
      { status: sitzung ? 403 : 401 },
    );
  }
  const wer = sitzung!.name;

  const body = (await req.json().catch(() => ({}))) as Koerper;
  const aktion = String(body.aktion ?? "") as Aktion;
  if (!AKTIONEN.includes(aktion)) {
    return fehler(`Unbekannte Aktion "${body.aktion ?? ""}".`);
  }

  // --- Die Freigabe des Mahnwesens als Ganzes ------------------------------

  if (aktion === "freigeben") {
    const bereitschaft = await mahnbereitschaft();
    const knopf = freigabeKnopf({
      befunde: bereitschaft.befunde,
      schonFreigegeben: bereitschaft.freigabe !== null,
      rolle: sitzung!.rolle,
      notiz: body.notiz ?? "",
    });
    if (!knopf.erlaubt) {
      return NextResponse.json(
        { fehler: knopf.grund, fehlt: knopf.fehlt },
        { status: 409 },
      );
    }
    try {
      const f = await erteileFreigabe({
        wer,
        notiz: body.notiz ?? "",
        bereit: bereitschaft.bereit,
        fehlt: knopf.fehlt,
      });
      return NextResponse.json({ ok: true, freigabe: f });
    } catch (e) {
      return fehler((e as Error).message, 409);
    }
  }

  if (aktion === "sperren") {
    if ((await freigabe()) === null) {
      return fehler("Das Mahnwesen ist schon gesperrt.", 409);
    }
    const g = pruefeGrund(body.grund ?? "");
    if (!g.ok) return fehler(g.fehler!);
    await nimmFreigabeZurueck({ wer, grund: g.grund });
    return NextResponse.json({ ok: true, gesperrt: true });
  }

  // --- Entscheidungen zu einem einzelnen Rückstand -------------------------

  const mvId = String(body.mietverhaeltnis_id ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(mvId)) {
    return fehler("mietverhaeltnis_id fehlt.");
  }

  const heute = new Date();
  const stand = await mahnstand(heute);
  const r = stand.find((z) => z.mietverhaeltnis_id === mvId);
  if (!r) {
    return fehler(
      "Zu diesem Mietverhältnis steht derzeit nichts offen. Vermutlich ist " +
        "zwischenzeitlich eine Zahlung zugeordnet worden — dann hat sich die " +
        "Sache erledigt.",
      409,
    );
  }

  const letzte = letzteEntscheidungen(await entscheidungen());
  const zurueck = istZurueckgestellt(letzte.get(mvId), heute);

  if (aktion === "entwerfen") {
    const darf = darfEntwerfen({
      freigegeben: (await freigabe()) !== null,
      rolle: sitzung!.rolle,
      stufe: r.stufe,
      zurueckgestellt: zurueck,
    });
    if (!darf.erlaubt) {
      return NextResponse.json({ fehler: darf.grund }, { status: 409 });
    }
    try {
      const e = await entwerfeMahnung({ rueckstand: r, wer, heute });
      return NextResponse.json({
        ok: true,
        entwurf: e,
        hinweis:
          e.empfaenger.length === 0
            ? "Entwurf liegt in der Freigabe. Für diesen Kontakt ist keine " +
              "E-Mail-Adresse hinterlegt — der Text ist zum Übernehmen in " +
              "ein Schreiben auf Papier."
            : "Entwurf liegt in der Freigabe. Versendet wird er erst dort.",
      });
    } catch (e) {
      // Die Sperre wirft absichtlich eine Ausnahme statt false
      // zurückzugeben (lib/mahnfreigabe.ts). Hier wird daraus die Meldung,
      // die der Verwalter zu lesen bekommt.
      const status = e instanceof NichtFreigegeben ? 409 : 500;
      return fehler((e as Error).message, status);
    }
  }

  if (aktion === "verschieben") {
    const p = pruefeVerschiebung({
      bis: body.bis ?? "",
      grund: body.grund ?? "",
      heute,
    });
    if (!p.ok) return fehler(p.fehler!);
    const v = await verschiebe({
      rueckstand: r,
      bis: p.bis!,
      grund: p.grund!,
      wer,
    });
    return NextResponse.json({ ok: true, verschoben: v });
  }

  if (aktion === "nicht_mahnen") {
    const g = pruefeGrund(body.grund ?? "");
    if (!g.ok) return fehler(g.fehler!);
    const v = await setzeAus({ rueckstand: r, grund: g.grund, wer });
    return NextResponse.json({ ok: true, ausgesetzt: v });
  }

  // wieder_vorlegen
  if (!zurueck) {
    return fehler("Dieser Fall ist nicht zurückgestellt.", 409);
  }
  const g = pruefeGrund(body.grund ?? "Wiedervorlage von Hand");
  const v = await legeWiederVor({ rueckstand: r, grund: g.grund, wer });
  return NextResponse.json({ ok: true, wieder_vorgelegt: v });
}
