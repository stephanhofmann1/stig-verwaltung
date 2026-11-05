"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Sammel-Einlieferung: ein Archiv mit vielen Belegen.
 *
 * Für den täglichen Beleg gibt es den Einzelupload mit Vorschau
 * (BelegUpload). Dieses Feld ist für den Altbestand -- 300 Rechnungen aus
 * einem Ordner auf der Platte, als tar.gz. Was dabei an die Stelle der
 * Vorschau tritt, steht in api/belege/einlieferung: zwei unabhängige
 * Auswertungen je Beleg, und wo sie sich über Betrag oder Datum nicht
 * einig sind, wird der Beleg angelegt und als abweichend markiert.
 *
 * Die Antwort wird vollständig gezeigt, auch die Ablehnungen. Eine
 * Einlieferung, die "290 von 297 übernommen" meldet und die sieben nicht
 * nennt, ist wertlos: Niemand sucht sie von Hand.
 */

interface Antwort {
  lieferung_id?: string;
  enthalten?: number;
  angelegt?: number;
  abgelehnt?: number;
  auffaellig?: number;
  mit_beifuegung?: number;
  abgleich?: { uebernommen: number; offen: number };
  bericht?: Array<{ datei: string; grund: string }>;
  fehler?: string;
}

export function Einlieferung() {
  const router = useRouter();
  const feld = useRef<HTMLInputElement>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [antwort, setAntwort] = useState<Antwort | null>(null);
  const [uebergang, start] = useTransition();

  async function senden() {
    const datei = feld.current?.files?.[0];
    if (!datei) return;
    setLaeuft(true);
    setAntwort(null);
    try {
      const daten = new FormData();
      daten.set("archiv", datei);
      const r = await fetch("/api/belege/einlieferung", {
        method: "POST",
        body: daten,
      });
      const d = (await r.json()) as Antwort;
      setAntwort(d);
      if (r.ok) {
        if (feld.current) feld.current.value = "";
        start(() => router.refresh());
      }
    } catch (e) {
      setAntwort({ fehler: `Übertragung abgebrochen: ${(e as Error).message}` });
    } finally {
      setLaeuft(false);
    }
  }

  const blockiert = laeuft || uebergang;

  return (
    <div className="einlieferung">
      <div className="knopfreihe">
        <input
          ref={feld}
          type="file"
          accept=".tgz,.tar,.gz,application/gzip,application/x-tar"
          disabled={blockiert}
          aria-label="Archiv mit Belegen"
        />
        <button onClick={senden} disabled={blockiert}>
          {laeuft ? "Liefert ein…" : "Einliefern"}
        </button>
        {laeuft && (
          <span className="rueckmeldung">
            Große Archive brauchen einen Moment — jede Datei wird gelesen.
          </span>
        )}
      </div>

      {antwort?.fehler && (
        <p className="rueckmeldung" data-art="fehler">
          {antwort.fehler}
        </p>
      )}

      {antwort && !antwort.fehler && (
        <>
          <div className="register">
            <div className="posten" data-still="ja">
              <span className="nummer ziffern">{antwort.angelegt ?? 0}</span>
              <span className="betreff">Belege angelegt</span>
              <span className="unterzeile">
                <span>von {antwort.enthalten ?? 0} Dateien im Archiv</span>
                {typeof antwort.mit_beifuegung === "number" && (
                  <span>{antwort.mit_beifuegung} Einträge in der Beifügung</span>
                )}
                {antwort.abgleich && (
                  <span>
                    {antwort.abgleich.uebernommen} Zuordnungen übernommen,{" "}
                    {antwort.abgleich.offen} offen
                  </span>
                )}
                {(antwort.auffaellig ?? 0) > 0 && (
                  <span className="marker" data-art="heikel">
                    {antwort.auffaellig} mit Abweichung
                  </span>
                )}
              </span>
            </div>
          </div>

          {(antwort.bericht?.length ?? 0) > 0 && (
            <>
              <p className="hinweis">
                Nicht übernommen ({antwort.bericht!.length}) — mit Grund, damit
                niemand sie suchen muss:
              </p>
              <div className="register">
                {antwort.bericht!.map((b, i) => (
                  <div className="posten" data-still="ja" key={`${b.datei}-${i}`}>
                    <span className="betreff">{b.datei}</span>
                    <span className="unterzeile">
                      <span>{b.grund}</span>
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
