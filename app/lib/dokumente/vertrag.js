// Erzeugt den Mietvertrag über ein möbliertes WG-Zimmer aus einem Mietverhältnis.
//
// Layout und Wortlaut entsprechen der bisherigen Vorlage (zuletzt der Vertrag vom 27.08.2026).
// Befristete Verträge bekommen in § 2 den Text für den vorübergehenden Gebrauch nach § 549 BGB.
//
// Für einen neuen Vertrag ist hier nichts zu ändern – alles kommt aus dem Mietverhältnis.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const W = 595.28, H = 841.89;   // A4
const L = 56, R = 56;           // Seitenränder
const BREITE = W - L - R;

const SCHWARZ = rgb(0, 0, 0);
const GRAU    = rgb(0.45, 0.45, 0.45);
const GRAU2   = rgb(0.35, 0.35, 0.35);

// ===== HIER PFLEGEN: Angaben des Vermieters =====
export const VERMIETER = {
  firma: 'STIG Immobilien eGbR',
  vertreter: 'Stephan Hofmann',
  strasse: 'Am Henninger Turm 10',
  ort: '60599 Frankfurt am Main',
  telefon: '+49 151 50722648',
  email: 'STIGIMMO@gmx.de',
  bank: 'Sparkasse Wetzlar, 35576 Wetzlar',
  iban: 'DE63 5155 0035 0002 1436 67',
  bic: 'HELADEF1WET',
  unterschriftsort: 'Frankfurt am Main',
  schluesselersatz: '50,00 EUR'
};

const MONATE = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];

function tag(iso){ const d = new Date(iso + 'T12:00:00'); return isNaN(d) ? null : d; }
function de(d){
  if (!d) return '';
  return String(d.getDate()).padStart(2,'0') + '.' + String(d.getMonth()+1).padStart(2,'0') + '.' + d.getFullYear();
}
function eur(v){
  if (v === null || v === undefined || v === '') return '';
  // /g ist nötig: Ohne das Flag setzt replace nur den ERSTEN Tausenderpunkt.
  // Aus 1234567,50 wurde "1.234567,50 EUR". Bei Mieten und Kautionen fällt
  // das nie auf, weil die unter einer Million liegen -- aber eine Zahl ohne
  // die zweite Gruppierung ist auch dort falsch, wo sie selten vorkommt,
  // und diese Funktion wird für jeden Betrag im Vertrag benutzt.
  return Number(v).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' EUR';
}
function monateDazu(d, n){ const x = new Date(d); x.setMonth(x.getMonth() + n); return x; }
function tagDavor(d){ const x = new Date(d); x.setDate(x.getDate() - 1); return x; }
function monatsersterDavor(d, n){ const x = new Date(d.getFullYear(), d.getMonth(), 1); x.setMonth(x.getMonth() - n); return tagDavor(x); }

// StandardFonts können nur WinAnsi – alles andere vorsorglich ersetzen
function sicher(t){
  return String(t == null ? '' : t)
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/–/g, '-').replace(/…/g, '...')
    .replace(/[^\x00-\xFF€„“—·§]/g, '?');
}

export async function mietvertrag(mv){
  const pdf  = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const p  = mv.person  || {};
  const e  = mv.einheit || {};
  const v  = mv.vertrag || {};
  const mi = mv.miete   || {};
  const ka = mv.kaution || {};

  const beginn = tag(v.beginn);
  const vdatum = tag(v.datum) || new Date();
  const ende   = v.ende ? tag(v.ende) : null;
  if (!beginn) throw new Error('Ohne Mietbeginn kann kein Vertrag erzeugt werden.');

  const verzicht  = Number(v.kuendigungsverzichtMonate || 0);
  const verzEnde  = verzicht > 0 ? tagDavor(monateDazu(beginn, verzicht)) : null;
  const zugangBis = verzEnde ? monatsersterDavor(verzEnde, 2) : null;
  const zahlungBis = tagDavor(beginn);

  const zimmer = e.zimmer || '';
  const fuss = sicher((zimmer ? 'Zimmer ' + zimmer + ' · ' : '') + (p.vollerName || ''));

  let seite, y, seitenNr = 0;
  const seiten = [];

  function neueSeite(){
    seite = pdf.addPage([W, H]); seiten.push(seite); seitenNr++;
    const t = sicher(VERMIETER.firma);
    seite.drawText(t, { x: W - R - bold.widthOfTextAtSize(t, 8), y: H - 56, size: 8, font: bold, color: GRAU2 });
    y = H - 76;
  }
  function text(s, x, yy, size, f, farbe){
    seite.drawText(sicher(s), { x, y: yy, size, font: f || font, color: farbe || SCHWARZ });
  }
  function rechts(s, yy, size, f, farbe){
    const t = sicher(s); const ff = f || font;
    seite.drawText(t, { x: W - R - ff.widthOfTextAtSize(t, size), y: yy, size, font: ff, color: farbe || SCHWARZ });
  }
  function umbrich(s, f, size, breite){
    const worte = sicher(s).split(' '); const zeilen = []; let z = '';
    for (const w of worte){
      const probe = (z + ' ' + w).trim();
      if (f.widthOfTextAtSize(probe, size) <= breite) z = probe;
      else { if (z) zeilen.push(z); z = w; }
    }
    if (z) zeilen.push(z);
    return zeilen;
  }
  function absatz(s, { size = 8.6, f = font, lead = 10.6, breite = BREITE, x = L } = {}){
    for (const z of umbrich(s, f, size, breite)){ text(z, x, y, size, f); y -= lead; }
  }
  function para(titel, inhalt){
    text(titel, L, y, 9, bold); y -= 10.5;
    absatz(inhalt); y -= 4;
  }
  function fusszeile(nr, gesamt){
    text(fuss, L, 92, 7, font, GRAU);
    const s = 'Seite ' + nr + ' von ' + gesamt;
    seite.drawText(s, { x: W - R - font.widthOfTextAtSize(s, 7), y: 92, size: 7, font, color: GRAU });
    seite.drawLine({ start: { x: L, y: 84 }, end: { x: W - R, y: 84 }, thickness: 0.5, color: rgb(0.8,0.8,0.8) });
    const spalten = [
      [L,     [VERMIETER.firma.toUpperCase(), VERMIETER.strasse, VERMIETER.ort]],
      [L+150, ['STEPHAN HOFMANN', 'IGOR JOVANIC']],
      [L+265, [VERMIETER.telefon.replace(/\s/g,''), VERMIETER.email.toUpperCase()]],
      [L+370, ['AMTSGERICHT FRANKFURT AM MAIN']]
    ];
    for (const [x, zeilen] of spalten){
      let yy = 72;
      for (const z of zeilen){ seite.drawText(sicher(z), { x, y: yy, size: 6.6, font: bold, color: GRAU2 }); yy -= 8; }
    }
  }

  // ---------- Seite 1: der Vertrag ----------
  neueSeite();
  text(p.vollerName || '', L, y, 9.4); y -= 11.5;
  text(p.anschriftVorher || '', L, y, 8.6);
  rechts(de(vdatum), y, 8.6); y -= 18;
  text('Mobil: ' + (p.mobil || '–') + ' · E-Mail: ' + (mv.email || ''), L, y, 8.6); y -= 24;

  const titel = 'Mietvertrag über ein möbliertes WG-Zimmer (ab ' + de(beginn) + ', '
    + (ende ? 'befristet bis ' + de(ende) + ')' : 'unbefristet)');
  text(titel, L, y, 11.5, bold); y -= 14;

  absatz('Zwischen dem Vermieter „' + VERMIETER.firma + '“ (Anschrift in der Fußzeile), vertreten durch '
    + VERMIETER.vertreter + ' (alleinvertretungsberechtigt), und dem Mieter „' + (p.vollerName || '') + '“'
    + (p.geburtsdatum ? ', geboren am ' + de(tag(p.geburtsdatum)) + (p.geburtsort ? ' in ' + p.geburtsort : '') : ''));
  y -= 4;

  para('§1 Mietgegenstand & Übergabe',
    'Vermietet wird Zimmer Nummer ' + zimmer + ' in der Wohngemeinschaft im Hause Westanlage 9, 35390 Gießen. '
    + 'Das Zimmer ist möbliert mit Bett, Matratze, Schreibtisch, Stuhl und Kleiderschrank. Die Mitbenutzung der '
    + 'Gemeinschaftsräume (Bad, WC, Küche, Flur) ist eingeschlossen. Die Übergabe erfolgt in bewohnbarem '
    + 'Zustand am ' + de(beginn) + ' oder nach Absprache früher; der Zustand wird in einem von beiden Seiten '
    + 'unterzeichneten Übergabeprotokoll festgehalten.');

  para('§2 Mietdauer & Kündigung', ende
    ? 'Das Mietverhältnis beginnt am ' + de(beginn) + ' und endet am ' + de(ende) + ', ohne dass es einer '
      + 'Kündigung bedarf. Es handelt sich um ein Mietverhältnis zum vorübergehenden Gebrauch '
      + '(§ 549 Abs. 2 Nr. 1 BGB); eine stillschweigende Verlängerung nach § 545 BGB ist ausgeschlossen. '
      + 'Das Recht zur außerordentlichen Kündigung aus wichtigem Grund (§§ 543, 569 BGB) bleibt unberührt.'
    : 'Das Mietverhältnis beginnt am ' + de(beginn) + ' und läuft auf unbestimmte Zeit.'
      + (verzicht > 0
        ? ' Beide Seiten verzichten für die ersten ' + verzicht + ' Monate wechselseitig auf die ordentliche '
          + 'Kündigung: Eine ordentliche Kündigung kann frühestens zum ' + de(verzEnde) + ' wirken, die '
          + 'Kündigung muss dem Vertragspartner also bis zum ' + de(zugangBis) + ' zugehen. Danach gilt die '
          + 'gesetzliche Kündigungsfrist von drei Monaten zum Monatsende; das Mietverhältnis läuft dann '
          + 'einfach weiter, eine Verlängerung muss nicht vereinbart werden.'
        : ' Es gilt die gesetzliche Kündigungsfrist von drei Monaten zum Monatsende.')
      + ' Das Recht zur außerordentlichen Kündigung aus wichtigem Grund (§§ 543, 569 BGB) bleibt '
      + 'unberührt. Kündigungen bedürfen der Schriftform und sind eigenhändig zu unterzeichnen.');

  para('§3 Miete & Nebenkosten',
    'Die Gesamtmiete beträgt ' + eur(mi.gesamt) + ' monatlich. Damit sind Heizung, Wasser, Strom, Internet und '
    + 'die Reinigung der Gemeinschaftsflächen abgegolten; eine jährliche Betriebskostenabrechnung findet nicht '
    + 'statt. Aufschlüsselung im Sinne des § 556g BGB: Nettokaltmiete ' + eur(mi.kalt)
    + ' zuzüglich Betriebskostenpauschale ' + eur(mi.nebenkosten)
    + (mi.moeblierung ? ' zuzüglich Möblierungszuschlag ' + eur(mi.moeblierung) : '')
    + '. Die Miete ist bis zum dritten Werktag des jeweiligen Monats im Voraus fällig.');

  const raten = Number(ka.raten || 1);
  para('§4 Kaution',
    'Die Kaution beträgt ' + eur(ka.betrag) + '.'
    + (raten > 1
       ? ' Nach § 551 Abs. 2 BGB kann sie in drei gleichen Monatsraten gezahlt werden; die erste Rate ist vor der '
         + 'Übergabe fällig.'
       : ' Sie ist vor der Übergabe in einer Summe fällig.')
    + ' Der Vermieter legt die Kaution getrennt von seinem Vermögen an, die Zinsen stehen dem Mieter zu '
    + '(§ 551 Abs. 3 BGB). Die Rückzahlung erfolgt nach Ende des Mietverhältnisses und Rückgabe des '
    + 'Zimmers, soweit keine Schäden oder Rückstände bestehen.');

  absatz('Zahlung: Die erste Monatsmiete für ' + MONATE[beginn.getMonth()] + ' ' + beginn.getFullYear()
    + ' (' + eur(mi.gesamt) + ') sowie ' + (raten > 1 ? 'mindestens die erste Kautionsrate' : 'die Kaution')
    + ' sollen bis zum ' + de(zahlungBis) + ' eingegangen sein:');
  for (const z of [
    'Kontoinhaber: ' + VERMIETER.firma + ' · Bank: ' + VERMIETER.bank,
    'IBAN: ' + VERMIETER.iban + ' · BIC: ' + VERMIETER.bic,
    'Verwendungszweck: Zimmer ' + zimmer + ' Westanlage 9 – ' + (p.vollerName || '') + ' – Kaution und erste Miete'
  ]){ text(z, L + 14, y, 8.6); y -= 10.5; }
  y -= 3;
  absatz('Die Übergabe des Zimmers erfolgt, sobald die erste Monatsmiete und '
    + (raten > 1 ? 'die erste Kautionsrate' : 'die Kaution') + ' eingegangen sind.');
  y -= 5;

  para('§5 Pflichten des Mieters',
    'Der Mieter behandelt das Zimmer und die Gemeinschaftsräume pfleglich, lüftet und heizt ordnungsgemäß, '
    + 'um Schimmelbildung zu vermeiden, und zeigt Schäden unverzüglich an. Die Hausordnung ist einzuhalten.');
  para('§6 Schlüssel & Verlust',
    'Der Mieter erhält einen Zimmerschlüssel sowie digitalen Zugang zur Haustür über das SmartLock-System. '
    + 'Bei Verlust trägt der Mieter die Kosten der Ersatzbeschaffung, derzeit ' + VERMIETER.schluesselersatz
    + ' je Schlüssel, sofern nicht ein geringerer Aufwand nachgewiesen wird.');
  para('§7 Untervermietung, Haustiere, Besuch',
    'Eine Untervermietung oder Gebrauchsüberlassung an Dritte bedarf der vorherigen schriftlichen Zustimmung des '
    + 'Vermieters; der Anspruch des Mieters auf Erlaubnis nach § 553 BGB bleibt unberührt. Haustiere nur nach '
    + 'vorheriger Absprache. In den Gemeinschaftsräumen und im Treppenhaus wird nicht geraucht. Besuch ist '
    + 'willkommen; für Gäste, die länger als sechs zusammenhängende Wochen bleiben, ist die vorherige '
    + 'Zustimmung des Vermieters erforderlich.');
  para('§8 Schlussbestimmungen',
    'Es gilt deutsches Recht. Sollten einzelne Bestimmungen unwirksam sein, bleibt der Vertrag im Übrigen wirksam. '
    + 'Änderungen und Ergänzungen bedürfen der Textform. Eine Widerrufsbelehrung ist als Anlage 1 beigefügt.');

  // Unterschriftsblock braucht rund 60 Punkt – sonst eigene Seite
  if (y < 158){ fusszeile(seitenNr, 0); neueSeite(); }
  absatz('Zur Annahme dieses Mietvertrages bitte diese Seite unterschreiben und zurücksenden.');
  y -= 4;
  text(VERMIETER.unterschriftsort + ', ' + de(vdatum), L, y, 8.6); y -= 26;
  text('X', L + 300, y + 4, 10);
  seite.drawLine({ start: { x: L, y }, end: { x: L + 200, y }, thickness: 0.6, color: SCHWARZ });
  seite.drawLine({ start: { x: L + 300, y }, end: { x: W - R, y }, thickness: 0.6, color: SCHWARZ });
  y -= 10;
  text(VERMIETER.vertreter + ' (Vermieter)', L, y, 7.6);
  text((p.vollerName || '') + ' (Mieter)', L + 300, y, 7.6); y -= 9;
  text('Bitte hier unterschreiben', L + 300, y, 7.6, font, GRAU);
  const letzteVertragsseite = seitenNr;
  fusszeile(seitenNr, 0);

  // ---------- Letzte Seite: Widerrufsbelehrung ----------
  neueSeite();
  text('Anlage 1 — Widerrufsbelehrung', L, y, 11.5, bold); y -= 14;
  absatz('zum Mietvertrag über Zimmer ' + zimmer + ', Westanlage 9, 35390 Gießen, vom ' + de(vdatum));
  y -= 10;

  para('Widerrufsrecht',
    'Sie haben das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag zu widerrufen. Die '
    + 'Widerrufsfrist beträgt vierzehn Tage ab dem Tag des Vertragsabschlusses. Um Ihr Widerrufsrecht auszuüben, '
    + 'müssen Sie uns (' + VERMIETER.firma + ', ' + VERMIETER.strasse + ', ' + VERMIETER.ort + ', Telefon '
    + VERMIETER.telefon + ', E-Mail ' + VERMIETER.email + ') mittels einer eindeutigen Erklärung (z. B. ein mit '
    + 'der Post versandter Brief oder eine E-Mail) über Ihren Entschluss, diesen Vertrag zu widerrufen, informieren. '
    + 'Sie können dafür das beigefügte Muster-Widerrufsformular verwenden, das jedoch nicht vorgeschrieben '
    + 'ist. Zur Wahrung der Widerrufsfrist reicht es aus, dass Sie die Mitteilung über die Ausübung des '
    + 'Widerrufsrechts vor Ablauf der Widerrufsfrist absenden.');
  para('Folgen des Widerrufs',
    'Wenn Sie diesen Vertrag widerrufen, haben wir Ihnen alle Zahlungen, die wir von Ihnen erhalten haben, '
    + 'unverzüglich und spätestens binnen vierzehn Tagen ab dem Tag zurückzuzahlen, an dem die Mitteilung '
    + 'über Ihren Widerruf dieses Vertrags bei uns eingegangen ist. Für diese Rückzahlung verwenden wir '
    + 'dasselbe Zahlungsmittel, das Sie bei der ursprünglichen Transaktion eingesetzt haben, es sei denn, mit Ihnen '
    + 'wurde ausdrücklich etwas anderes vereinbart; in keinem Fall werden Ihnen wegen dieser Rückzahlung '
    + 'Entgelte berechnet. Haben Sie verlangt, dass die Leistungen während der Widerrufsfrist beginnen sollen, so '
    + 'haben Sie uns einen angemessenen Betrag zu zahlen, der dem Anteil der bis zu dem Zeitpunkt, zu dem Sie uns von '
    + 'der Ausübung des Widerrufsrechts unterrichten, bereits erbrachten Leistungen im Vergleich zum Gesamtumfang '
    + 'der im Vertrag vorgesehenen Leistungen entspricht.');
  para('Hinweis',
    'Diese Belehrung wird vorsorglich erteilt. Da Sie das Zimmer und die Wohnung vor Vertragsschluss besichtigt haben, '
    + 'dürfte ein gesetzliches Widerrufsrecht nach § 312 Abs. 4 Satz 2 BGB nicht bestehen. Unabhängig davon '
    + 'räumt Ihnen der Vermieter das vorstehende Widerrufsrecht vertraglich ein.');

  y -= 8;
  text('Muster-Widerrufsformular', L, y, 9, bold); y -= 12;
  absatz('An ' + VERMIETER.firma + ', ' + VERMIETER.strasse + ', ' + VERMIETER.ort + ', E-Mail: ' + VERMIETER.email);
  absatz('Hiermit widerrufe(n) ich/wir den von mir/uns abgeschlossenen Vertrag über die Anmietung des Zimmers Nr. '
    + zimmer + ', Westanlage 9, 35390 Gießen.');
  y -= 10;
  text('Vertrag geschlossen am: _______________________', L, y, 8.6);
  text('Name: ' + (p.vollerName || ''), L + 280, y, 8.6); y -= 16;
  text('Anschrift: __________________________________________________________________________', L, y, 8.6); y -= 16;
  text('Datum: _______________________', L, y, 8.6);
  text('Unterschrift: _______________________', L + 180, y, 8.6);
  fusszeile(seitenNr, 0);

  // Seitenzahlen nachtragen, jetzt wo die Gesamtzahl feststeht
  const gesamt = seitenNr;
  seiten.forEach((s, i) => {
    s.drawRectangle({ x: W - R - 70, y: 88, width: 70, height: 12, color: rgb(1,1,1) });
    const t = 'Seite ' + (i + 1) + ' von ' + gesamt;
    s.drawText(t, { x: W - R - font.widthOfTextAtSize(t, 7), y: 92, size: 7, font, color: GRAU });
  });

  return pdf.save();
}

export function vertragDateiname(mv){
  const p = mv.person || {}, e = mv.einheit || {};
  const slug = String(p.vollerName || 'Mieter').normalize('NFD').replace(/[̀-ͯ]/g,'')
    .replace(/ß/g,'ss').replace(/[^A-Za-z0-9]+/g,'_').replace(/^_|_$/g,'');
  return 'Mietvertrag_' + (e.zimmer ? 'Zimmer_' + e.zimmer + '_' : '') + slug + '.pdf';
}
