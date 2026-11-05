import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Tests der Einspielkette.
 *
 * ANLASS, 05.11.2026
 *
 * Das Fernstueck wurde ueber `ssh host 'bash -s'` mit einem
 * Hier-Dokument in die Standardeingabe der fernen Shell geschrieben.
 * `bash -s` liest das Skript aus der Standardeingabe -- und
 * `docker compose exec -T` in migrieren.sh liest aus derselben Quelle.
 * Es hat den Rest des Skripts verschluckt.
 *
 * Die Folge war kein Fehler, sondern Schweigen: Die Migrationen liefen,
 * die Anwendung wurde nie neu gebaut, und der Gesundheitstest fragte die
 * alte Fassung und meldete Erfolg. DREI Einspielvorgaenge hintereinander
 * waren gruen und haben nichts ausgeliefert. Aufgefallen ist es nur,
 * weil eine neue Route im Betrieb 404 lieferte.
 *
 * Diese Tests halten die Reparatur fest. Sie pruefen Text in zwei
 * Dateien, was fuer Tests unueblich ist -- aber die Alternative waere,
 * dieselbe Falle in drei Monaten wieder aufzustellen, weil ein
 * Hier-Dokument im Skript so viel kuerzer aussieht.
 */

const WURZEL = join(import.meta.dirname, "..", "..");
const WORKFLOW = readFileSync(
  join(WURZEL, ".github", "workflows", "einspielen.yml"),
  "utf8",
);
const FERN = readFileSync(join(WURZEL, "einspielen-fern.sh"), "utf8");

/**
 * Nur die Befehlszeilen, ohne Kommentare.
 *
 * Die Kommentare erzaehlen von der Falle und nennen sie beim Namen --
 * eine Suche ueber die ganze Datei wuerde den Hinweis fuer die Falle
 * selbst halten.
 */
function ohneKommentare(text: string): string {
  return text
    .split("\n")
    .filter((z) => !/^\s*#/.test(z))
    .join("\n");
}

describe("Das Fernstueck geht als Datei, nicht durch die Standardeingabe", () => {
  test("der Ablauf kopiert einspielen-fern.sh auf den Server", () => {
    assert.match(WORKFLOW, /scp\s+[^\n]*einspielen-fern\.sh\s+root@/);
  });

  test("und ruft sie dort als Datei auf", () => {
    assert.match(WORKFLOW, /ssh\s+root@[^\n]*bash \/tmp\/einspielen-fern\.sh/);
  });

  test("nirgends wird ein Skript ueber bash -s eingespeist", () => {
    // Genau das war die Falle. Ein Hier-Dokument an bash -s sieht
    // kuerzer aus als eine Datei und verschwindet in der naechsten
    // Zeile, die stdin liest.
    assert.ok(
      !/bash\s+-s/.test(ohneKommentare(WORKFLOW)),
      "bash -s im Ablauf: das Skript landet wieder in der Standardeingabe",
    );
  });

  test("Aufrufe, die stdin lesen koennten, bekommen sie leer", () => {
    for (const ruf of ["./migrieren.sh", "./start.sh up -d --build", "./start.sh ps"]) {
      const zeile = FERN.split("\n").find((z) => z.trim().startsWith(ruf));
      assert.ok(zeile, `Aufruf fehlt: ${ruf}`);
      assert.match(
        zeile!,
        /< \/dev\/null/,
        `${ruf} ohne "< /dev/null" -- es kann die Standardeingabe leerlesen`,
      );
    }
  });
});

describe("Die Schlussmarke", () => {
  test("das Fernstueck endet mit ihr", () => {
    const letzte = FERN.trimEnd().split("\n").pop() ?? "";
    assert.match(letzte, /^echo "EINSPIELEN-VOLLSTAENDIG"$/);
  });

  test("der Ablauf prueft sie und bricht sonst ab", () => {
    assert.match(WORKFLOW, /grep -q '\^EINSPIELEN-VOLLSTAENDIG\$'/);
    const stelle = WORKFLOW.indexOf("EINSPIELEN-VOLLSTAENDIG");
    const danach = WORKFLOW.slice(stelle, stelle + 400);
    assert.match(danach, /exit 1/, "ohne Marke muss der Schritt durchfallen");
  });

  test("die Anwendung wird im Fernstueck wirklich neu gebaut", () => {
    // Der eigentliche Zweck des Einspielens. Ohne diese Zeile laeuft
    // auf dem Server weiter die alte Fassung -- und genau das ist
    // dreimal passiert.
    assert.match(FERN, /\.\/start\.sh up -d --build/);
  });

  test("und das Ergebnis wird angezeigt", () => {
    assert.match(FERN, /\.\/start\.sh ps/);
  });
});

describe("Die Abnahme nach dem Einspielen", () => {
  test("prueft den Inhalt der Seite, nicht nur den Statuscode", () => {
    // Eine Fehlerseite des Proxys kaeme auch mit 200.
    assert.match(WORKFLOW, /grep -q 'type="password"'/);
  });

  test("haengt nicht am Produktnamen", () => {
    const abnahme = WORKFLOW.slice(WORKFLOW.indexOf("Läuft es wirklich?"));
    assert.ok(
      !abnahme.includes('grep -q "STIG Verwaltung"'),
      "Der Name soll verschwinden duerfen, ohne die Abnahme rot zu faerben",
    );
  });
});
