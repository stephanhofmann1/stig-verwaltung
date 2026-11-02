# Prüfliste

Was ich hier prüfen konnte, ist abgehakt. Was nur auf dem Server geht, steht
weiter unten — dort läuft kein Docker-Dienst in der Arbeitsumgebung.

## Geprüft (Stand 01.11.2026, Migrationen bis 027)

- [x] Alle 20 Migrationen laufen auf einer **leeren** Datenbank durch, in der
      Reihenfolge, in der der Runner sie ausführt. Gegen eine echte
      Postgres-16-Instanz, nicht gelesen.
- [x] Danach stehen 2 Objekte und 40 Einheiten (inklusive des mit 017
      ergänzten Zimmers 10) — und **null** Kontakte, Mietverhältnisse und
      Vorgänge. Keine erfundenen Daten.
- [x] **Alle 23 Migrationen auf einer leeren Datenbank** durchgelaufen, und
      danach steht `zahlungsdaten_ab` bei der Welserstraße auf 2024-12-01 und
      bei der Westanlage auf 2025-06-13 — die Nachfüllung in 023 greift.
- [x] **Mahnwesen am echten Ludwigshafen-Fall gegen Postgres geprüft:** Eine
      Mieterin seit 2007 mit elf Sollstellungen aus 2024 (keine Kontodaten)
      und zwei echten offenen Monaten 2026 ergibt eine Mahnung über
      **1.260 EUR**, nicht über 8.190 EUR. Die 6.930 EUR aus 2024 stehen
      daneben als ungeklärt. Ohne die Trennung wären das dreizehn
      Monatsmieten und damit ein Kündigungsgrund gegen eine langjährige
      Mieterin, die nichts schuldet.
- [x] **Augartenstraße: `zahlungsdaten_ab` ist NULL, also wird dort nicht
      gemahnt.** Gegengeprobt mit vier offenen Monaten aus 2026 — Stufe
      bleibt „beobachten", der Betrag steht als ungeklärt.
- [x] **Mutationstest der Deckungsgrenze:** Hebt man die Trennung auf, fallen
      7 Tests; zählt man die ungedeckten Monate in den Rückstand, fallen 3.
- [x] **Mutationstest der Monatsmieten-Notbremse:** Entfernt man sie, fallen
      2 Tests. Ohne Notbremse wäre bei fehlender Monatsmiete die Schwelle 0,
      und jeder offene Cent würde zur Mahnung — ausgerechnet dort, wo die
      Miete nicht belegt ist.
- [x] **Mahnsperre gegen Postgres geprüft.** Ohne Zeile in
      `mahnwesen_freigabe` wirft `verlangeFreigabe()`; mit Zeile gibt sie
      den Freigebenden zurück. Fehlt die Tabelle ganz, gilt das als
      **nicht freigegeben** — ein Fehler beim Nachsehen darf nicht zu einer
      Mahnung führen.
- [x] **Mutationstest der Sperre:** Legt man eine Datei `lib/mahn*.ts` an,
      die etwas erzeugt oder versendet, ohne `verlangeFreigabe()` zu rufen,
      fällt der Test. Der Schutz wächst also mit, auch für Dateien, die es
      heute noch nicht gibt.
- [x] **Bereitschaftsliste gegen echte Daten:** Bei leerem Buchungsbestand
      meldet sie „keine Kontoumsätze", „Abgleich nicht aktuell" und nennt
      die Augartenstraße als Objekt ohne gepflegte Deckungsgrenze.
- [x] **Die vier echten Kontoformate gelesen** (Sparkasse-CSV, ING-CSV,
      Volksbank-CSV, Volksbank-PDF-Umsatzexport), geprüft an nachgebauten
      Dateien mit allen Eigenheiten der echten: cp1252, BOM, CRLF,
      zweistellige Jahre, 13 Kopfzeilen, doppelte Spalte `Währung`.
- [x] **Durchstich gegen Postgres:** Sparkassen-Auszug mit zwei Mieten
      eingelesen, der vorgemerkte Umsatz übersprungen, beide Zahlungen dem
      **richtigen** Monat zugeordnet (2026-09 und 2026-10, nicht dem
      ältesten offenen Monat Januar 2024) — die Mahnung über 1.260 EUR ist
      danach weg, die 6.930 EUR ohne Kontodaten bleiben sichtbar.
- [x] **Mutationstests aller sechs Schutzmechanismen im Leser:** vorgemerkte
      Umsätze mitimportieren, ING-Saldo statt Betrag nehmen, Saldokette
      nicht prüfen, 200er-Grenze ignorieren, Mehrfachzähler aus dem
      Fingerabdruck entfernen, UTF-8 nicht streng prüfen — jede Mutation
      lässt genau einen Test fallen.
- [x] **Lagebericht gegen Postgres gebaut.** Die beiden Vorwarnstufen
      einzeln gegengeprobt: eine Frist in 45 Tagen ohne Abhängigkeit ist
      nicht dringend, dieselbe Frist mit `haengt_an` ist es — und eine
      verstrichene wird als „VERSTRICHEN seit 12 Tagen" benannt.
- [x] **Alle 24 Migrationen auf einer leeren Datenbank** durchgelaufen.
- [x] **Mieterbereich: Mietanzeige richtiggestellt.** `mieter_uebersicht`
      liefert seit Migration 019 auch Gesamtmiete und Möblierungszuschlag,
      gelesen wurden sie nicht — die 22 von 37 Mietverhältnissen mit
      Inklusivmiete sahen „Kaltmiete —" und „Nebenkosten —" statt ihrer
      Miete.
- [x] **Zugriff auf die Unterlagen geprüft:** Das Mietverhältnis kommt
      ausschließlich aus der Sitzung. Ein Test liest die Signatur der Route
      und fällt, sobald dort ein zweiter Pfadparameter auftaucht — stünde
      die Kennung im Pfad, könnte jeder Mieter den Vertrag eines anderen
      herunterladen, mit Geburtsdatum, Geburtsort und Kaution darin.
- [x] **Zahlungsstand im Mieterbereich:** Ein Monat ohne Kontodaten heißt
      „noch nicht abgeglichen", nie „offen". Zwei Mutationstests belegen die
      Reihenfolge der Prüfungen (nach hinten verschoben: 2 Tests fallen;
      ganz entfernt: 4).
- [x] **FinTS-Anbindung gebaut und geprüft.** Sechs Mutationstests, jeder
      für einen Fehler, der Geld bewegt: Zeitraum auf ein Jahr (löst bei
      jedem Lauf eine TAN aus), Überlappung entfernt, Vorzeichen
      verschluckt (Abbuchung würde zum Mieteingang), `toISOString` statt
      lokalem Tag (Miete vom 1. landet im Vormonat), Mehrfachzähler aus dem
      Fingerabdruck, gekürzter Zeitraum nicht gemeldet. Jede Mutation
      lässt Tests fallen.
- [x] **Fingerabdruck stimmt mit dem Dateiimport überein.** Dieselbe
      Zahlung über FinTS und über die Sparkassen-CSV ergibt denselben
      Fingerabdruck — sonst stünde jede Zahlung zweimal in der Datenbank
      und jeder Mieter wäre scheinbar im Guthaben.
- [x] **Werte erreichen den Container.** `start.sh` und `migrieren.sh`
      leiten die Liste der Umgebungswerte jetzt aus der `compose.yaml` ab
      statt sie von Hand zu pflegen. Die Handliste war am 01.11.2026 vier
      Werte hinterher — `LAGEBERICHT_AN` kam leer im Container an, und der
      Bericht wurde gebaut, protokolliert und **nie verschickt**. Kein
      Absturz, nur Schweigen. Zwei Mutationstests: Handliste zurückbauen
      und `: > leer.env` entfernen lassen je einen Test fallen.
- [x] **Bankanbindung bedienbar gemacht.** Vorher war die FinTS-Maschine
      gebaut, aber es gab keine Oberfläche, um eine PIN zu hinterlegen, und
      keinen Weg, eine TAN einzugeben — der Abruf hätte spätestens nach 90
      Tagen stillgestanden, und der erste Abruf eines neuen Zugangs wäre
      gar nicht möglich gewesen.
- [x] **Mutationstests des TAN-Ablaufs:** Wird der Dialog erst nach dem
      Einlösen verworfen, fällt ein Test — ein zweiter Versuch auf
      demselben Dialog zählt bei der Bank als weiterer Fehlversuch, und
      drei sperren den Zugang. Ebenso fallen Tests, wenn der Abruf von Hand
      den letzten Abruf ignoriert oder die Bankinformationen nach der
      Erstanmeldung nicht sichert — beides führte dazu, dass bei JEDEM
      Abruf wieder eine TAN nötig wäre.
- [x] 273 automatische Tests (Monatszuordnung, anteilige Mieten, Gesamtmiete,
      Belegungsableitung, Thread-Header, CSV-Formate, Zugangsschutz,
      Schema-Abgleich, Vollständigkeitsprüfung der Dokumente).
- [x] Anwendung baut ohne Fehler, `tsc` fehlerfrei.
- [x] Zugangsschutz: ohne Anmeldung Umleitung, Schnittstellen mit 401,
      gefälschtes Cookie abgewiesen.
- [x] **Mandantentrennung als `stig_app`** — also mit der Rolle, die RLS
      ausdrücklich nicht umgehen kann: ohne gesetzten `app.mandant` liefert
      jede Tabelle 0 Zeilen; mit fremdem Mandanten sind eigene Daten da und
      fremde unsichtbar; Schreiben mit fremder `mandant_id` wird von der
      Policy abgewiesen.
- [x] Derselbe Handwerker, dasselbe „Girokonto", dieselbe Message-ID bei zwei
      Mandanten: geht. Dieselbe Message-ID zweimal im **eigenen** Mandanten:
      weiter abgelehnt.
- [x] Ratenbegrenzung Mieterzugang: der sechste Anmeldelink innerhalb einer
      Stunde wird abgelehnt, die fünf davor erteilt.
- [x] Ein Mietverhältnis mit `status='vertrag_versendet'` bekommt keinen
      Mieterzugang, auch wenn sein Beginndatum erreicht ist.
- [x] Laufprotokoll: Schreiben und Lesen als `stig_app`, Befundfilter trifft,
      `lauf_aufraeumen` hält die 7-Tage-Untergrenze ein, ohne gesetzten
      Mandanten unsichtbar.
- [x] Die vollständige Verfügbarkeitsabfrage: 35 Einheiten, Gruppierung
      korrekt, Etagen-Einheiten nicht doppelt gezählt, Gewerbefläche nicht
      enthalten.
- [x] **Mutationstest der Belegungsableitung:** Baut man den Septemberfehler
      wieder ein (Vorgabewert `frei` statt `belegt`), fallen 7 Tests. Der
      Schutz ist also wirksam und nicht nur vorhanden.
- [x] Echter ML-Hauselemente-Fall durchgespielt: Threads richtig
      zusammengeführt, Kategorien richtig, Entwürfe erzeugt.
- [x] **Mietvertrag und Wohnungsgeberbestätigung aus der Datenbank erzeugt**
      und der Vertrag gelesen, nicht nur gezählt: Möblierungszuschlag steht in
      § 3, Gesamtmiete 750,00 EUR = 600 + 90 + 60, Kaution mit Tausenderpunkt,
      Kündigungsverzicht über 12 Monate korrekt auf den 30.11.2027 gerechnet
      (Zugang der Kündigung bis 31.08.2027).
- [x] Gegenprobe mit unvollständigem Datensatz: Vertrag wird **nicht** erzeugt,
      stattdessen eine Liste der fehlenden Angaben. Die
      Wohnungsgeberbestätigung hat eine eigene, kürzere Pflichtliste — sonst
      bekäme kein übernommener Altmieter seine Meldebestätigung, und die hat
      eine Zweiwochenfrist.

## Beim ersten Start auf dem Server zu prüfen

- [ ] `docker compose build` läuft durch (hier nicht testbar).
- [ ] Caddy holt das TLS-Zertifikat — setzt voraus, dass die Domain bereits
      auf den Server zeigt. Vorher schlägt es fehl, das ist normal.
- [ ] **`AUFGABEN_SCHLUESSEL` steht in der `.env`.** Fehlt er, weisen die
      Aufgaben-Schnittstellen jetzt mit 503 ab, statt offen zu stehen — die
      nächtlichen Läufe finden dann aber auch nicht statt. Im Log sichtbar:
      `start.sh logs aufgaben`.
- [ ] **`EINGANG_SCHLUESSEL` steht in der `.env`.** Fehlt er, weist der
      Maileingang im Betrieb mit 503 ab. Mail geht dabei nicht verloren: Der
      Cloudflare-Worker leitet bei einem Fehler auf die Ausweichadresse.

## Am Tag nach dem Einspielen zu prüfen

- [ ] **`LAGEBERICHT_AN` in die `.env` eintragen.** Ohne Empfänger wird der
      Bericht nur protokolliert — er steht dann auf der Seite „Läufe", aber
      es kommt keine Mail. Der Lauf scheitert deswegen nicht; das ist
      Absicht, eine fehlende Adresse soll nicht den ganzen Lauf anhalten.
- [ ] **Kam der Lagebericht?** Er geht einmal täglich raus, im ersten Lauf
      des Tages. Kommt er nicht, steht der Zeitplaner — das ist die
      einzige Absicherung gegen einen Ausfall des Berichts selbst.
- [ ] **Seite „Läufe" aufrufen.** Dort müssen fünf Einträge von 7 Uhr stehen
      (mailabruf, agent, nachfassen, sollstellungen, lagebericht). Steht da nichts,
      erreicht der Zeitplaner die Anwendung nicht — dann
      `start.sh logs aufgaben`.
- [ ] Unter „Was jemand ansehen muss" nachsehen. Dort landen Mietabweichungen
      zwischen Vertrag und Einzelposten und gescheiterte Läufe.

## Vor der Bankanbindung zu prüfen

**Zuerst den Server härten.** Mit einer Banking-PIN auf der Maschine wird
aus „sollte man" ein „muss man zuerst":

- [ ] Root-Passwort in Hetzner zurücksetzen (es stand einmal im Chat).
- [ ] Passwort-Anmeldung per SSH abschalten, nur Schlüssel.
- [ ] Neustart für das Kernel-Update.

Dann:

- [ ] **Produktregistrierung bei fints.org** (derzeit kostenfrei, seit
      01.08.2019 Pflicht). Die Kennung einer fremden Programmbibliothek
      darf dafür nicht verwendet werden — sie ist nur zum Testen
      freigegeben.
- [ ] `FINTS_SCHLUESSEL` erzeugen: `openssl rand -hex 32`. Genau 64
      Hexzeichen; kürzere Werte werden abgelehnt statt aufgefüllt.
- [ ] `FINTS_PRODUKT_ID` in die `.env`.
- [ ] Zugang einrichten und **die PIN selbst eintippen**. Sie wird sofort
      verschlüsselt und nirgends protokolliert.
- [ ] Beim ersten Lauf wird die Bank eine TAN verlangen — das ist der
      Einrichtungsfall. Danach etwa alle 90 Tage.

Was die Verschlüsselung leistet: Sie schützt Datenbank-Abzüge und Backups.
Sie schützt **nicht** gegen jemanden mit Root auf dem Server — der liest die
Umgebungsvariable. Das folgt aus der Aufgabe: Ein Lauf, der sich nachts ohne
Menschen anmeldet, muss die PIN auf dieser Maschine wiederherstellen können.

## Vor dem ersten Mahnlauf zu prüfen

Das Mahnwesen ist **gesperrt**, bis Stephan es freigibt (entschieden am
01.11.2026). Freigabe je Mandant:

    INSERT INTO mahnwesen_freigabe (freigegeben_von, notiz)
    VALUES ('Stephan', 'Abgleich bis 10/2026 geprüft');

Zurücknehmen mit `DELETE FROM mahnwesen_freigabe;`. Keine Zeile heißt
gesperrt — das ist der Vorgabewert und gilt auch für einen neuen Mandanten
und für eine aus dem Backup wiederhergestellte Datenbank.

Die Seite „Rückstände" führt die Bereitschaftsliste. Jeder Punkt darauf ist
ein Weg, auf dem ein pünktlicher Zahler als Säumiger erscheint; vor dem Go
sollten alle erfüllt sein.

- [ ] **`objekt.zahlungsdaten_ab` je Objekt prüfen.** Die Spalte sagt, ab
      wann Kontoumsätze vollständig vorliegen. Steht sie zu früh, mahnt die
      Anwendung Monate, zu denen es keine Auszüge gibt.
- [ ] Für die **Augartenstraße 91** bleibt sie NULL, solange kein eigenes
      Konto existiert. Dort wird deshalb nicht gemahnt — das ist gewollt.
- [ ] **`konto.objekt_id` bei jedem Bankkonto setzen.** Fehlt es, vergleicht
      der Abgleich jede Zahlung mit den Sollstellungen aller Objekte; sie
      landet dann meist in der Prüfung statt in der Zuordnung. Die
      Bereitschaftsliste nennt die betroffenen Konten.
- [x] Die 200er-Grenze der Volksbank-CSV und die zweistelligen Jahre der
      Sparkasse sind im Leser behandelt: Bei 200 oder mehr Umsätzen warnt
      der Import vor der stillen Kürzung, vorgemerkte Umsätze werden nicht
      übernommen. Die Warnungen stehen in der Antwort des Imports.
- [ ] Die **ING-Umsatzanzeige des stillen Gesellschafters** darf nicht
      importiert werden. Sie liegt im Finanzierungsordner und gehört nicht
      Stephan.

## Beim ersten Mailabruf zu prüfen

- [ ] Der erste Lauf holt höchstens 50 Nachrichten. Wenn das Postfach voll
      ist, mehrfach laufen lassen, bis `geholt` auf 0 steht.
- [ ] Prüfen, ob Kategorien plausibel sind, und Absender in den Stammdaten die
      richtige Rolle geben — ein Kontakt mit Rolle „sonstige" wird allein über
      Stichwörter eingeordnet.

## Vor dem Bewerben freier Zimmer zu prüfen

Die öffentliche Verfügbarkeit meldet nach dem Einspielen **alles als belegt**.
Das ist der Zweck, nicht ein Fehler: `belegung_gepflegt` steht überall auf
`false`, und nur bei `true` darf aus „kein Mietverhältnis" überhaupt „frei"
werden. Der umgekehrte Vorgabewert hat im September 2026 vermietete Zimmer
öffentlich angeboten.

- [ ] Altmieter ohne E-Mail-Adresse erfassen (rund zwölf).
- [ ] Danach **je Einheit** freigeben, erst wenn für diese Einheit die
      Belegung nachweislich stimmt:
      `UPDATE einheit SET belegung_gepflegt = true WHERE schluessel = '…';`
- [ ] Gegenprobe über `/api/oeffentlich/verfuegbarkeit`: Keine Einheit darf
      `frei` melden, in der jemand wohnt.

## Bewusst gesetzte Grenzen

- Der Agent schreibt **nie** bei Mahnwesen und Behördenpost.
- Zu Preisen, Terminen und Verfügbarkeiten sagt er nichts zu.
- Versendet wird nichts ohne Freigabe.
- Ohne `RESEND_API_KEY` und ohne `SMTP_HOST` läuft alles im Trockenmodus:
  Freigeben geht, raus geht nichts. Gut für den ersten Tag.
- Preise nach außen kommen aus `einheit.angebot_*`, nie aus einem
  Mietverhältnis. Was ein belegtes Zimmer kostet, ist die Miete eines Mieters.
- Eine ausgelieferte Migration wird nie bearbeitet, sondern durch eine neue
  ersetzt. Der Runner merkt sich den Dateinamen und würde eine geänderte
  Datei stillschweigend überspringen.
