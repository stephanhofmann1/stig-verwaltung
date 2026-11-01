# STIG Verwaltung

Hausverwaltung für die Objekte der STIG Immobilien eGbR: Westanlage 9
(Gießen), Welserstraße 10 (Ludwigshafen), Augartenstraße 91 (Mannheim).

Next.js, Postgres mit Mandantentrennung über Row Level Security, Caddy als
Proxy — alles in Docker Compose auf einem eigenen Server.

## Was hier NICHT liegt

**Keine Mieterdaten und keine Geheimnisse.** Ausgeschlossen über
`.gitignore`, und das ist kein Versehen, das man „der Vollständigkeit
wegen" korrigiert:

| Datei | Warum draußen |
|---|---|
| `.env` | Datenbankpasswörter, Postfachzugänge, Sitzungsschlüssel |
| `import/altdaten.json` | 43 Mietverhältnisse mit Namen, Geburtsdaten, Geburtsorten, Voranschriften, Telefonnummern |
| `import/befund-*.md` | Befundberichte aus dem Datenimport, darin 17 Geburtsdaten und Bankangaben |
| `doku/kontoauszuege-befund.md` | Kontostruktur und Bankverbindungen |

Ein privates Repository ist nicht dasselbe wie keine Weitergabe: Die Daten
lägen bei einem Dritten, in jedem Klon und in einer Historie, aus der man
sie nicht mehr entfernt. `import/altdaten.vorlage.json` dokumentiert das
Format mit erfundenen Namen.

Code reist über dieses Repository, Daten als Paket.

## Einspielen

Push auf `main` → GitHub prüft (Typen, 265 Tests, Programmbau, alle
Migrationen gegen eine leere Datenbank) → und spielt nur bei Erfolg ein.
Ein kaputter Stand erreicht den Server nicht.

Nötiges Repository-Geheimnis: `SSH_PRIVATE_KEY` — der private Teil eines
Schlüsselpaars, dessen öffentlicher Teil in `~/.ssh/authorized_keys` des
Servers steht.

Der Fingerabdruck des Server-Schlüssels ist in
`.github/workflows/einspielen.yml` **festgeschrieben**. Wird der Server neu
aufgesetzt, muss er dort angepasst werden — sonst bricht das Einspielen ab,
und das ist die gewollte Richtung: Lieber ein fehlgeschlagener Lauf als
Zugangsdaten an jemanden, der sich dazwischensetzt.

## Von Hand, und zwar mit Absicht

Diese Dinge laufen nicht über die Automatik, weil Geheimnisse nicht durch
ein Repository und nicht durch einen Chat gehören:

* Werte in der `.env` auf dem Server (`LAGEBERICHT_AN`, Versandweg,
  `FINTS_SCHLUESSEL`, `FINTS_PRODUKT_ID`)
* Die Banking-PIN. Wird im Mieterverwaltungs-Bereich eingegeben,
  sofort verschlüsselt und nirgends protokolliert.
* Die Freigabe des Mahnwesens — eine Zeile in `mahnwesen_freigabe`.
  Keine Zeile heißt gesperrt, und ohne Freigabe erzeugt auch der
  nächtliche Lauf kein Schreiben.

## Eine ausgelieferte Migration wird nie bearbeitet

`db/*.sql` werden nur ergänzt, nie geändert. Der Runner merkt sich den
Dateinamen und würde eine geänderte Datei stillschweigend überspringen.

`db/nachbuchen.sh` holt die Buchführung nach, wenn das Schema älter ist als
die Tabelle `schema_migration`. Geprüft über `tests-nachbuchen.sh` gegen
eine echte Postgres-Instanz, in sechs Fällen.

## Was geprüft ist

`PRUEFLISTE.md`. Dort steht auch, was auf dem Server beim ersten Start
nachzusehen ist und welche Mutationstests belegen, dass die Schutzregeln
wirken — nicht nur vorhanden sind.
