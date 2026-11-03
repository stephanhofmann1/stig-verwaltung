"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Eine Zeile je Rückstand -- mit der Entscheidung darin.
 *
 * Drei Wege, und jeder hinterlässt eine Spur:
 *
 *   entwerfen     legt einen Entwurf an, der in der Freigabe landet. Es
 *                 wird nichts versendet; auch von hier aus geht keine Mail.
 *   verschieben   Datum und Grund sind Pflicht. Bis zu diesem Tag wird der
 *                 Fall nicht mehr vorgeschlagen.
 *   nicht mahnen  Grund ist Pflicht. Der Fall bleibt sichtbar, aber ohne
 *                 Vorschlag, bis jemand ihn wieder vorlegt.
 *
 * Die Begründung der Stufe steht im Wortlaut aus lib/mahnstufen.ts in der
 * Zeile. Sie ist die Entscheidungsgrundlage und wird deshalb nicht gekürzt
 * und nicht umformuliert.
 */

export interface ZeileDaten {
  mietverhaeltnis_id: string;
  kontakt_name: string;
  einheit: string;
  offen: number;
  monat: string;
  tage_ueberfaellig: number;
  stufe: string;
  stufe_text: string;
  begruendung: string;
  offen_ohne_daten: number;
  monate_ohne_daten: number;
}

export interface ZurueckDaten {
  art: "verschoben" | "ausgesetzt" | "entworfen" | "wieder_vorgelegt";
  bis: string | null;
  grund: string;
  wer: string;
  zeitpunkt: string;
  vorgang_id: string | null;
  vorgang_nummer: number | null;
}

interface Props {
  zeile: ZeileDaten;
  /** Die letzte Entscheidung zu diesem Fall, falls es eine gibt. */
  entscheidung: ZurueckDaten | null;
  /** Darf hier entworfen werden? Sonst steht der Grund darunter. */
  entwerfenErlaubt: boolean;
  entwerfenGrund: string;
  /** Darf dieser Zugang überhaupt entscheiden? */
  darfEntscheiden: boolean;
  /** Vorschlag der Oberfläche für den Tag der Wiedervorlage. */
  vorschlagBis: string;
  /** Zurückgestellt: dann steht statt der Wahl die Wiedervorlage. */
  zurueckgestellt: boolean;
}

const euro = (w: number) =>
  new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(w);

const monatDe = (iso: string) =>
  new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(
    new Date(iso + "T12:00:00Z"),
  );

const tagDe = (iso: string) =>
  new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(iso.slice(0, 10) + "T12:00:00Z"));

const SCHILD: Record<string, "fehl" | "warn" | "still"> = {
  mahnung: "fehl",
  erinnerung: "warn",
  faellig: "still",
  ok: "still",
};

type Formular = null | "verschieben" | "nicht_mahnen" | "wieder_vorlegen";

export function MahnZeile(p: Props) {
  const router = useRouter();
  const z = p.zeile;
  const [formular, setFormular] = useState<Formular>(null);
  const [bis, setBis] = useState(p.vorschlagBis);
  const [grund, setGrund] = useState("");
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState<
    { art: "gut" | "fehler"; text: string } | null
  >(null);

  async function schicke(koerper: Record<string, string>, gut: string) {
    setLaeuft(true);
    setMeldung(null);
    try {
      const r = await fetch("/api/mahnwesen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...koerper,
          mietverhaeltnis_id: z.mietverhaeltnis_id,
        }),
      });
      const d = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        fehler?: string;
        hinweis?: string;
      };
      if (!r.ok || !d.ok) {
        setMeldung({ art: "fehler", text: d.fehler ?? "Das hat nicht geklappt." });
        return;
      }
      setMeldung({ art: "gut", text: d.hinweis ?? gut });
      setFormular(null);
      setGrund("");
      router.refresh();
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <section className="karte">
      {/* .entwurf-kopf ist genau diese Zeile: Flex, Umbruch, gleiche
          Grundlinie, graue Nebenangaben -- und strong darin bleibt
          vollfarbig. Vorher stand das vierfach inline. */}
      <div className="entwurf-kopf">
        <strong>{z.kontakt_name}</strong>
        <span className="hinweis">{z.einheit}</span>
        <span className="betrag">{z.offen > 0 ? euro(z.offen) : "—"}</span>
        <span className="hinweis">
          {z.offen > 0
            ? `offen seit ${monatDe(z.monat)} (${z.tage_ueberfaellig} Tage)`
            : "kein gedeckter Rückstand"}
        </span>
        <span className="schild" data-art={SCHILD[z.stufe] ?? "still"}>
          {z.stufe_text}
        </span>
      </div>

      {/* Wörtlich aus lib/mahnstufen.ts -- das ist die Begründung, auf die
          sich die Entscheidung stützt. */}
      <p className="hinweis">{z.begruendung}</p>

      {z.offen_ohne_daten >= 1 && (
        <p className="hinweis">
          Daneben {euro(z.offen_ohne_daten)} aus {z.monate_ohne_daten} Monaten
          ohne Kontodaten. Nicht Teil der Forderung und kein Mahngrund: Diese
          Monate sind nicht unbezahlt, sondern unbekannt.
        </p>
      )}

      {p.entscheidung && (
        <p className="hinweis">
          Zuletzt:{" "}
          <strong>
            {p.entscheidung.art === "verschoben"
              ? `verschoben${p.entscheidung.bis ? " bis " + tagDe(p.entscheidung.bis) : ""}`
              : p.entscheidung.art === "ausgesetzt"
                ? "nicht mahnen"
                : p.entscheidung.art === "entworfen"
                  ? "Entwurf angelegt"
                  : "wieder vorgelegt"}
          </strong>{" "}
          — {p.entscheidung.grund} ({p.entscheidung.wer},{" "}
          {tagDe(p.entscheidung.zeitpunkt)})
          {p.entscheidung.vorgang_id && (
            <>
              {" · "}
              <a href={`/vorgang/${p.entscheidung.vorgang_id}`}>
                Vorgang{" "}
                <span className="ziffern">
                  {String(p.entscheidung.vorgang_nummer ?? "").padStart(4, "0")}
                </span>
              </a>
            </>
          )}
        </p>
      )}

      {!p.darfEntscheiden ? null : p.zurueckgestellt ? (
        <div className="knopfreihe">
          {formular !== "wieder_vorlegen" ? (
            <button
              data-art="still"
              onClick={() => setFormular("wieder_vorlegen")}
            >
              Wieder vorlegen
            </button>
          ) : (
            <>
              <input
                type="text"
                value={grund}
                onChange={(e) => setGrund(e.target.value)}
                placeholder="Warum wieder vorlegen? (Pflicht)"
                disabled={laeuft}
              />
              <button
                onClick={() =>
                  schicke(
                    { aktion: "wieder_vorlegen", grund },
                    "Wieder vorgelegt — der Fall erscheint ab jetzt wieder als Vorschlag.",
                  )
                }
                disabled={grund.trim().length < 5 || laeuft}
              >
                Wieder vorlegen
              </button>
              <button
                data-art="still"
                onClick={() => setFormular(null)}
                disabled={laeuft}
              >
                Abbrechen
              </button>
            </>
          )}
        </div>
      ) : (
        <>
          {formular === null && (
            <div className="knopfreihe">
              <button
                onClick={() =>
                  schicke(
                    { aktion: "entwerfen" },
                    "Entwurf liegt in der Freigabe. Versendet wird er erst dort.",
                  )
                }
                disabled={!p.entwerfenErlaubt || laeuft}
                title={p.entwerfenErlaubt ? undefined : p.entwerfenGrund}
              >
                {laeuft ? "legt an …" : "Mahnung entwerfen"}
              </button>
              <button data-art="still" onClick={() => setFormular("verschieben")}>
                Verschieben
              </button>
              <button
                data-art="still"
                onClick={() => setFormular("nicht_mahnen")}
              >
                Nicht mahnen
              </button>
              {!p.entwerfenErlaubt && (
                <span className="rueckmeldung">{p.entwerfenGrund}</span>
              )}
            </div>
          )}

          {formular === "verschieben" && (
            <>
              <div className="feldreihe">
                <label className="feld">
                  Wieder vorlegen am
                  <input
                    type="date"
                    value={bis}
                    onChange={(e) => setBis(e.target.value)}
                    disabled={laeuft}
                  />
                </label>
                <label className="feld">
                  Grund (Pflicht)
                  <input
                    type="text"
                    value={grund}
                    onChange={(e) => setGrund(e.target.value)}
                    placeholder="z. B. Ratenzahlung zugesagt, Eingang abwarten"
                    disabled={laeuft}
                  />
                </label>
              </div>
              <div className="knopfreihe">
                <button
                  onClick={() =>
                    schicke(
                      { aktion: "verschieben", bis, grund },
                      "Verschoben — bis dahin wird der Fall nicht mehr vorgeschlagen.",
                    )
                  }
                  disabled={grund.trim().length < 5 || !bis || laeuft}
                >
                  {laeuft ? "verschiebt …" : "Verschieben"}
                </button>
                <button
                  data-art="still"
                  onClick={() => setFormular(null)}
                  disabled={laeuft}
                >
                  Abbrechen
                </button>
              </div>
            </>
          )}

          {formular === "nicht_mahnen" && (
            <>
              <label className="feld">
                Grund (Pflicht)
                <input
                  type="text"
                  value={grund}
                  onChange={(e) => setGrund(e.target.value)}
                  placeholder="z. B. Rückstand liegt vor Eigentumsübergang"
                  disabled={laeuft}
                />
              </label>
              <div className="knopfreihe">
                <button
                  onClick={() =>
                    schicke(
                      { aktion: "nicht_mahnen", grund },
                      "Vermerkt — hier wird nicht gemahnt, bis jemand den Fall wieder vorlegt.",
                    )
                  }
                  disabled={grund.trim().length < 5 || laeuft}
                >
                  {laeuft ? "vermerkt …" : "Nicht mahnen"}
                </button>
                <button
                  data-art="still"
                  onClick={() => setFormular(null)}
                  disabled={laeuft}
                >
                  Abbrechen
                </button>
              </div>
            </>
          )}
        </>
      )}

      {meldung && (
        <div
          className="meldung"
          data-art={meldung.art === "fehler" ? "fehler" : "gut"}
        >
          {meldung.text}
        </div>
      )}
    </section>
  );
}
