import type { Metadata, Viewport } from "next";
// Die Schrift kommt über @import am Anfang von globals.css --
// @fontsource-variable/archivo, eine Variable Font mit Gewichtsachse
// 100--900. Verwendet wird sie über die Marke --schrift.
import "./globals.css";
import { Navi } from "@/components/Navi";
import { NaviBoden } from "@/components/NaviBoden";
import { angemeldeteSitzung } from "@/lib/anmeldung";
import { zugaengeFuer } from "@/lib/zugang";
import { MandantWahl } from "@/components/MandantWahl";

/**
 * Titel und Beschreibung stehen im Browsertab, im Lesezeichen und in der
 * Vorschau eines geteilten Links. Sie nennen deshalb kein Objekt: Sobald
 * ein zweiter Vermieter die Anwendung benutzt, stünden dort die Immobilien
 * eines Fremden. Welche Objekte verwaltet werden, steht auf den Seiten --
 * dort kommt es aus den Daten.
 *
 * icons verweist auf app/icon.svg. Next trägt das Zeichen über die
 * Dateikonvention ohnehin ein; der ausdrückliche Eintrag hält den Verweis
 * auch dort, wo die Metadaten von Hand gelesen werden.
 *
 * Titel und Beschreibung stehen wortgleich noch einmal in app/manifest.ts
 * (dort als NAME und BESCHREIBUNG) -- siehe die Begründung dort, warum
 * nicht importiert wird. tests/webapp.test.ts hält beide gleich.
 */
export const metadata: Metadata = {
  title: "Hausverwaltung",
  description: "Mieten, Zahlungen, Vorgänge und Freigaben an einer Stelle",

  /*
    Zwei Zeichen für zwei Zwecke.

    icon  -- app/icon.svg, der Browsertab. SVG, weil es in jeder Größe
             scharf bleibt.
    apple -- Safari liest für den Startbildschirm ausschließlich
             <link rel="apple-touch-icon"> und nimmt dafür kein SVG und
             nichts aus dem Manifest. Ohne diesen Eintrag legt iOS einen
             verkleinerten Bildschirmabzug der Seite auf den
             Startbildschirm. 180×180 ist die Größe, die Safari für die
             heutigen Geräte verlangt; die Datei liegt in public/ und
             wird von app/manifest.ts mitgeführt.
  */
  icons: {
    icon: "/icon.svg",
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },

  /*
    Was Safari am Manifest vorbei liest.

    appleWebApp.capable setzt in dieser Next-Fassung (16.4.3, geprüft in
    node_modules/next/dist/lib/metadata/metadata-elements.js) allein
    <meta name="mobile-web-app-capable">. Das ist die heutige
    Schreibweise; Safari vor iOS 15.4 kennt nur die alte
    apple-mobile-web-app-capable und startet ohne sie mit Adressleiste.
    Next hat dafür kein Feld, darum steht sie unten unter `other`. Beide
    sagen dasselbe, beide schaden nicht.

    title ist der Name unter dem Zeichen auf dem iOS-Startbildschirm --
    iOS nimmt dafür diesen Wert und nicht short_name aus dem Manifest.

    statusBarStyle "default": Die Systemleiste bekommt ihre Farbe aus
    themeColor unten und bleibt damit im hellen wie im dunklen Modus die
    Seitenfläche. "black-translucent" wäre das Gegenteil -- es schiebt
    den Seiteninhalt unter die Uhr.
  */
  appleWebApp: {
    capable: true,
    title: "Hausverwaltung",
    statusBarStyle: "default",
  },
  other: { "apple-mobile-web-app-capable": "yes" },
};

/**
 * Gestaltung, nicht Inhalt.
 *
 * width=device-width ist die Voraussetzung dafür, dass die Seiten auf dem
 * Telefon in Gerätebreite rechnen statt in 980 px -- ohne das greift keine
 * der schmalen Regeln aus globals.css.
 *
 * themeColor färbt die Browserleiste auf dem Telefon in den
 * Seitenhintergrund (--grund), getrennt für hell und dunkel. Die Werte
 * stehen hier als Hex, weil die Metadaten keine CSS-Marken auflösen --
 * sie müssen zu --grund bzw. --dk-grund in globals.css passen.
 *
 * Genau das war hier am 03.11.2026 nicht mehr der Fall: Es standen
 * #F6F7F9 und #0E1116, während globals.css längst #EEF1F5 und #0F1318
 * führte. Zwei Werte, die keiner Regel unterliegen, laufen auseinander,
 * und zwar unsichtbar -- am Schreibtisch sieht man die Systemleiste des
 * Telefons nicht. Seither hält tests/webapp.test.ts beide Stellen
 * (hier und app/manifest.ts) gegen globals.css.
 *
 * viewportFit "cover" ist die Voraussetzung dafür, dass
 * env(safe-area-inset-*) auf dem iPhone überhaupt einen Wert hat: ohne
 * cover liefert es durchgehend 0, und die Fußnavigation läge über dem
 * Streifen, in dem die Geste zum Schließen wohnt. Es hat eine Kehrseite:
 * Der Seiteninhalt reicht damit auch seitlich bis an den Rand, quer
 * gehalten also unter die Kamera-Aussparung. Hochkant -- also so, wie
 * diese Anwendung auf dem Telefon benutzt wird -- ist der seitliche
 * Einzug 0, quer nicht. OFFEN: globals.css setzt heute nur
 * env(safe-area-inset-bottom) (für die Fußleiste). Wer die Anwendung
 * quer benutzt, braucht zusätzlich env(safe-area-inset-left/right) am
 * .rahmen; das gehört in globals.css und nicht hierher.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F4F2EE" },
    { media: "(prefers-color-scheme: dark)", color: "#0C0D0E" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const sitzung = await angemeldeteSitzung();
  const benutzer = sitzung?.name ?? null;

  /*
    Welche Mandanten stehen offen? Eine Abfrage je Seitenaufbau, über
    einen Primärschlüssel und einen Index -- und sie beantwortet die
    Frage, die in der Kopfzeile steht ("wo bin ich?"). Den Namen des
    aktiven Mandanten ins Sitzungscookie zu legen wäre billiger, zeigte
    aber nach einer Umbenennung bis zur nächsten Anmeldung den alten.
    Für einen Mieterzugang kommt eine leere Liste zurück, und dann
    bleibt die Kopfzeile, was sie war.
  */
  const zugaenge = sitzung ? await zugaengeFuer(sitzung) : [];
  const aktiv = zugaenge.find((z) => z.mandant === sitzung?.mandant) ?? null;

  /*
    Das Schaufenster unter /willkommen trägt dasselbe Gerüst, aber ein
    anderes Maß: keine Navigationsschiene an der Seite, keine
    Spaltenbreite, volle Seite.

    Hier steht dafür nichts mehr. Bis zum 08.11.2026 setzte diese Datei
    ein data-seite="schaufenster" an den <body>, aus einem Anfragekopf
    von proxy.ts. Das war falsch am Ort: Ein Wurzel-Layout rendert genau
    einmal, beim Laden der Seite. Wer vom Schaufenster in die Verwaltung
    klickte, nahm das Merkmal mit -- die Navigationsschiene blieb aus,
    bis man neu lud. app/schaufenster.css fragt jetzt selbst, ob die
    Schaufensterseite im Baum steht (body:has(.schaufenster)); das gilt
    nach jedem Wechsel, nicht nur nach dem ersten.
  */

  return (
    <html lang="de">
      <body>
        {/*
          Die Kopfzeile ist eine Reihe aus vier Dingen, nicht aus zwei.

          <Navi> liefert bewusst ein Fragment: Menueknopf, <nav> und
          Abmelden werden damit zu unmittelbaren Kindern von .kopf-innen
          und stehen in derselben Reihe wie die Wortmarke. Das ist keine
          Formsache -- genau daran lag der Fehler vorher. Abmelden sass
          mit marginLeft:auto *innerhalb* der Navigation, und die lief auf
          dem Telefon waagerecht ueber: Der Knopf, der die Sitzung
          beendet, lag hinter dem rechten Rand.

          Daraus folgt die Reihenfolge: Marke | Menueknopf | Navigation |
          Abmelden. Was einklappt oder weicht, ist allein die
          Navigation. Marke und Abmelden stehen auf jeder Breite.
        */}
        <header className="kopf">
          <div className="kopf-innen">
            <MandantWahl
              aktiv={aktiv}
              zugaenge={zugaenge.map((z) => ({
                mandant: z.mandant,
                name: z.name,
                kuerzel: z.kuerzel,
              }))}
            />
            <Navi benutzer={benutzer} />
          </div>
        </header>
        <main className="rahmen">{children}</main>
        {/*
          Die Fußnavigation steht nach <main> und nicht darin: Sie gehört
          zu keiner Seite, sondern zur Anwendung -- wie die Kopfzeile, nur
          am anderen Ende. Als letztes Element des Körpers ist sie auch
          für die Vorlesesoftware dort, wo sie sichtbar ist.

          Auf breiten Geräten blendet globals.css sie aus; dort steht die
          Kopfnavigation offen. Was die Leiste enthält und warum, steht in
          NaviBoden.tsx.
        */}
        <NaviBoden benutzer={benutzer} />
      </body>
    </html>
  );
}
