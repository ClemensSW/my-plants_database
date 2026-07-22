#!/usr/bin/env python3
"""AuGaLa Pflanzenliste: augala-appall.json  ->  AuGaLa-Pflanzenliste.pdf

Direkter Weg von den Rohdaten zum fertigen PDF. Keine CSV noetig.

    python3 augala-pdf.py

Voraussetzung:  brew install weasyprint
Rohdaten holen: siehe AUGALA-EXPORT.md (Console-Snippet, liest die IndexedDB
                des Browsers aus -- kein einziger Server-Request)

--------------------------------------------------------------------------
Layout-Entscheidungen (und warum)

  Kategorie in den LEBENDEN KOLUMNENTITEL, nicht in den Footer: beim Blaettern
  springt das Auge nach oben. Der Footer traegt die Seitenzahl.

  string(kat, first-except) -- leer auf der Seite, wo die Kategorie-Ueberschrift
  selbst steht (sonst stuende der Name doppelt), gefuellt auf allen Folgeseiten.
  Buchkonvention.

  Hierarchie ueber Schriftschnitt und Groesse, NICHT ueber Farbe: das Dokument
  wird mit hoher Wahrscheinlichkeit s/w kopiert. Gruen ist nur Zugabe.

  Botanische Nomenklatur: Gattung/Art kursiv, Sorten in 'Hochkommata' aufrecht,
  ebenso subsp./var./x. Verbindliche Konvention -- ein Ausbilder sieht sofort,
  ob sie eingehalten ist.

  Icons bewusst grob: bei 21-30px wird jedes Detail zu Matsch.

  KEIN Flexbox im Kategoriekopf: WeasyPrints Flex-Unterstuetzung ist
  unvollstaendig (verschachtelte Container ignorieren flex:1). Inline-Icon +
  float sind hier robust.
"""
import html
import json
import re
import shutil
import subprocess
import sys
import tempfile
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "augala-appall.json"
PDF = ROOT / "AuGaLa-Pflanzenliste.pdf"

# Reihenfolge wie im Original-Sortiment (nicht alphabetisch, nicht nach Menge).
# Kategorien ohne AuGaLa-Pflanzen fallen automatisch raus.
ORDER = ["Laubgehölze", "Nadelgehölze", "Obstgehölze", "Küchen- und Gewürzkräuter",
         "Pflanzen für die Innenraum-Begrünung", "Stauden",
         "Zwiebel- und knollenbildende Pflanzen", "Ziergräser", "Farne",
         "Sumpf- und Wasserpflanzen", "Beet- und Balkonpflanzen, Wechselflor",
         "Unkräuter, Wildkräuter", "Heimische, besonders geschützte Pflanzen"]

# Strichzeichnungen, 24x24, monochrom -- drucken sauber, funktionieren in s/w.
ICONS = {
 "Laubgehölze":  # Blatt: Koerper + Mittelrippe + Stiel + zwei Seitenadern
   '<path d="M12 2.5c5.2 4.8 5.2 11.5 0 16.5-5.2-5-5.2-11.7 0-16.5z"/>'
   '<path d="M12 21.5V6"/><path d="M12 12 8.3 9"/><path d="M12 12l3.7-3"/>',
 "Nadelgehölze":  # zwei gestapelte Kronen + Stamm
   '<path d="M12 2.5 6.5 11h11z"/><path d="M12 8.5 4.5 19h15z"/><path d="M12 19v3"/>',
 "Obstgehölze":  # Apfel: zwei Lappen mit Delle oben, dazu Stiel + Blatt
   '<path d="M12 9c-1.3-1.4-3.6-1.7-5.2 0-2.1 2.1-1.7 6.8.6 9.9 1.2 1.7 2.7 2.6 4.6 2.6'
   's3.4-.9 4.6-2.6c2.3-3.1 2.7-7.8.6-9.9-1.6-1.7-3.9-1.4-5.2 0z"/>'
   '<path d="M12 9V5"/><path d="M12.4 6.2c1.4-2.4 4.4-2 4.4-2s-.2 3-3 3"/>',
 "Küchen- und Gewürzkräuter":  # zwei Blaetter am Stiel
   '<path d="M12 21.5V9"/><path d="M12 13C7 13 5 9 5 4c5 0 7 4 7 9z"/>'
   '<path d="M12 15c5 0 7-4 7-9-5 0-7 4-7 9z"/>',
 "Pflanzen für die Innenraum-Begrünung":  # Topf + zwei Blaetter
   '<path d="M7 13.5h10l-1.2 8H8.2z"/><path d="M12 13.5V7"/>'
   '<path d="M12 10C8.5 10 7 7.5 7 4c3.5 0 5 2.5 5 6z"/>'
   '<path d="M12 10c3.5 0 5-2.5 5-6-3.5 0-5 2.5-5 6z"/>',
 "Stauden":  # Bluete: Blaetter ueberlappen die Mitte, sonst wird's ein Punktekreuz
   '<circle cx="12" cy="8.6" r="2"/><circle cx="12" cy="4" r="2.9"/>'
   '<circle cx="16.6" cy="8.6" r="2.9"/><circle cx="12" cy="13.2" r="2.9"/>'
   '<circle cx="7.4" cy="8.6" r="2.9"/><path d="M12 16v5.5"/>',
 "Zwiebel- und knollenbildende Pflanzen":  # Traenenform + Trieb + Wurzeln
   '<path d="M12 7.5c-3.6 3.2-5.2 5.8-5.2 8.3 0 2.9 2.3 4.7 5.2 4.7s5.2-1.8 5.2-4.7'
   'c0-2.5-1.6-5.1-5.2-8.3z"/>'
   '<path d="M12 7.5V3.5"/><path d="M12 5.2c-1.9-1.2-1.6-3.5-1.6-3.5s2.4.7 2.7 2.6"/>'
   '<path d="M9.6 20.2 8.2 22.2"/><path d="M12 20.5v1.8"/><path d="M14.4 20.2l1.4 2"/>',
 "Ziergräser":  # Faecher aus fuenf Halmen -- drei waren zu spaerlich fuer "Gras"
   '<path d="M12 21.5c0-5.5-2.6-10-6.8-12.8"/><path d="M12 21.5c0-6.8-1.1-12-2.7-15"/>'
   '<path d="M12 21.5c0-7 .2-12.2.6-15.8"/><path d="M12 21.5c0-6.8 1.1-12 2.7-15"/>'
   '<path d="M12 21.5c0-5.5 2.6-10 6.8-12.8"/>',
 "Farne":  # Wedel: Mittelrippe + Fiedern
   '<path d="M12 21.5V3.5"/><path d="M12 7.5 7.5 4"/><path d="M12 7.5 16.5 4"/>'
   '<path d="M12 12.5 7 9"/><path d="M12 12.5 17 9"/>'
   '<path d="M12 17.5 8 14.5"/><path d="M12 17.5 16 14.5"/>',
 "Sumpf- und Wasserpflanzen":  # Rohrkolben ueber Wellen
   '<path d="M2.5 17.5c2-1.6 4-1.6 6 0s4 1.6 6 0 4-1.6 6 0"/>'
   '<path d="M2.5 21.5c2-1.6 4-1.6 6 0s4 1.6 6 0 4-1.6 6 0"/>'
   '<path d="M9 14.5V7"/><rect x="7.6" y="2.5" width="2.8" height="5" rx="1.4"/>'
   '<path d="M15 14.5V9"/>',
 "Beet- und Balkonpflanzen, Wechselflor":  # Kasten + zwei Blueten
   '<path d="M4.5 13h15l-1.6 8.5H6.1z"/><path d="M9 13v-2.5"/><path d="M15 13v-2.5"/>'
   '<circle cx="9" cy="7.5" r="2.6"/><circle cx="15" cy="7.5" r="2.6"/>',
 "Unkräuter, Wildkräuter":  # Pusteblume: Speichen + Stiel
   '<path d="M12 8.5V2.5"/><path d="M12 8.5 7.8 4.3"/><path d="M12 8.5 16.2 4.3"/>'
   '<path d="M12 8.5H6"/><path d="M12 8.5h6"/><path d="M12 8.5 8.5 11"/>'
   '<path d="M12 8.5 15.5 11"/><path d="M12 8.5v13"/>',
 "Heimische, besonders geschützte Pflanzen":  # Schild + Blatt
   '<path d="M12 2 4 5.4V12c0 5.2 3.5 8.8 8 10.2 4.5-1.4 8-5 8-10.2V5.4z"/>'
   '<path d="M12 17c-2.8-2.6-2.8-6.4 0-9 2.8 2.6 2.8 6.4 0 9z"/>',
}

RANK = re.compile(r'\b(subsp\.|var\.|f\.|ssp\.|syn\.|×|x)\b')


def fmt_bot(s):
    """Gattung/Art kursiv; Sorten in 'Hochkommata', Klammerzusaetze und
    Rangkuerzel (subsp., var., x) aufrecht -- botanische Konvention."""
    out = []
    for part in re.split(r"('[^']*'|\([^)]*\))", s):
        if not part:
            continue
        if part[0] in "'(":
            out.append(f'<span class="rom">{html.escape(part)}</span>')
        else:
            for tok in RANK.split(part):
                if not tok:
                    continue
                cls = "rom" if RANK.fullmatch(tok.strip()) else "ital"
                out.append(f'<span class="{cls}">{html.escape(tok)}</span>')
    return "".join(out)


def sortkey(s):
    """DIN 5007-1: ä=a, ö=o, ü=u, ß=ss. Botanische Namen sind Latein, ABER
    Sortennamen tragen Umlaute (z.B. Aster ... 'Andenken an Alma Pötschke').
    Ohne das sortiert 'ö' hinter 'z'."""
    s = s.lower()
    for a, b in (("ä", "a"), ("ö", "o"), ("ü", "u"), ("ß", "ss")):
        s = s.replace(a, b)
    return s


def icon(kat):
    return ('<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'
            f'{ICONS[kat]}</svg>')


# ------------------------------------------------------------------- Daten
def lade():
    if not SRC.exists():
        sys.exit(f"{SRC.name} fehlt. Rohdaten ziehen: siehe AUGALA-EXPORT.md")
    d = json.loads(SRC.read_text(encoding="utf-8"))

    sortimente = {s["id"]: s["name"] for s in d["sortimente"]}
    # Das Flag augalaliste, KEIN Namensraten. Der Store "listen" ist trotz
    # seines Namens NICHT die AuGaLa-Liste, sondern die Code-Tabelle.
    al = [p for p in d["pflanzen"] if p.get("augalaliste")]

    rows = [{"bot": p["nameLatein"].strip(),
             "de": (p.get("nameDeutsch") or "").strip(),
             "kat": sortimente.get(p["sortimentId"], "")} for p in al]

    # Exakte Dubletten INNERHALB einer Kategorie zusammenfassen.
    # AuGaLa fuehrt "Malus domestica 'Sorte'" als zwei getrennte Datensaetze
    # (id 192812/192813) mit identischem bot. UND dt. Namen. Gedruckt stuende
    # die Zeile sonst zweimal untereinander und saehe wie ein Setzfehler aus.
    # NICHT betroffen: die 11 Pflanzen, die bewusst in ZWEI Kategorien stehen
    # (z.B. Taxus baccata = Nadelgehoelz + heimisch-geschuetzt) -- anderer
    # Schluessel, bleiben erhalten.
    gesehen, entdoppelt = set(), []
    for r in rows:
        k = (r["bot"], r["de"], r["kat"])
        if k not in gesehen:
            gesehen.add(k)
            entdoppelt.append(r)
    if len(entdoppelt) != len(rows):
        print(f"  Dubletten zusammengefasst: {len(rows)} -> {len(entdoppelt)}")
    return entdoppelt


CSS = """
@page {
  size: A4; margin: 19mm 15mm 15mm 15mm;
  @top-left  { content: string(kat, first-except); font: 600 8pt Helvetica;
               color: #2D5A3D; letter-spacing:.4pt; text-transform:uppercase;
               vertical-align:bottom; padding-bottom:2.5mm; }
  @top-right { content: "AuGaLa Pflanzenliste"; font: 400 8pt Helvetica;
               color:#9A9A9A; vertical-align:bottom; padding-bottom:2.5mm; }
  @bottom-right { content: "Seite " counter(page) " von " counter(pages);
                  font: 400 7.5pt Helvetica; color:#9A9A9A; vertical-align:top;
                  padding-top:3mm; }
}
@page :first { @top-left{content:none} @top-right{content:none}
               @bottom-right{content:none} }

* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:Helvetica, Arial, sans-serif; color:#1A1A1A; hyphens:none; }
.ital { font-style:italic; }
.rom  { font-style:normal; }

/* ---------------------------------------------------------- Titelseite */
.titel { height:263mm; position:relative; }
.titel-kopf { border-bottom:2.5pt solid #2D5A3D; padding-bottom:8mm; }
.titel h1 { font-size:40pt; font-weight:700; letter-spacing:-1pt; line-height:1.02; }
.uebersicht { margin-top:13mm; }
/* Spaltenkoepfe statt Punktfuehrung: "161  2" nebeneinander waere mehrdeutig. */
.ueber-kopf { display:flex; align-items:baseline; gap:5mm; padding-bottom:2.5mm;
              border-bottom:.8pt solid #C9C9C9; }
.ueber-kopf h2 { font-size:8.5pt; font-weight:600; color:#2D5A3D;
                 letter-spacing:.6pt; text-transform:uppercase; flex:1; }
.ueber-kopf .lbl { font-size:7.5pt; color:#A8A8A8; text-align:right;
                   letter-spacing:.3pt; }
.spalte-ct { width:22mm; flex:none; }
.spalte-pg { width:13mm; flex:none; }

/* target-counter() holt die Seitenzahl aus dem tatsaechlichen Umbruch --
   kein Nachpflegen bei Datenaenderungen. Nebeneffekt: klickbar. */
.zeile { display:flex; align-items:center; gap:5mm; padding:4.4mm 0;
         border-bottom:.4pt solid #E8E8E8; color:inherit; text-decoration:none; }
.zeile .ic { width:21px; height:21px; color:#2D5A3D; flex:none; }
.zeile .nm { font-size:11pt; flex:1; }
.zeile .ct { font-size:10pt; color:#8A8A8A; font-variant-numeric:tabular-nums;
             text-align:right; }
.zeile::after { content: target-counter(attr(href), page);
                font-size:11.5pt; font-weight:700; color:#1A1A1A;
                font-variant-numeric:tabular-nums; text-align:right;
                width:13mm; flex:none; }
.fuss { position:absolute; bottom:0; left:0; right:0;
        border-top:.5pt solid #E0E0E0; padding-top:4mm;
        font-size:7.5pt; color:#A8A8A8; line-height:1.5; }

/* ------------------------------------------------------- Kategorieseiten */
.kat { break-before:page; }
.kat-kopf { border-bottom:1.6pt solid #2D5A3D; padding-bottom:3.5mm;
            margin-bottom:5mm; overflow:hidden; }
.kat-kopf .anz { float:right; font-size:9pt; color:#8A8A8A; margin-top:3mm;
                 font-variant-numeric:tabular-nums; white-space:nowrap; }
.kat-kopf .ic { width:30px; height:30px; color:#2D5A3D;
                vertical-align:-9px; margin-right:3mm; }
/* string-set NUR auf dem h2 -- sonst stuende die Stueckzahl im Kolumnentitel.
   display:inline haelt Icon und Titel in EINER Zeile. */
.kat-kopf h2 { string-set: kat content(text); display:inline; font-size:16pt;
               font-weight:700; letter-spacing:-.2pt; }

/* balance, NICHT auto: mit auto laeuft die linke Spalte voll und die rechte
   bleibt bei kurzen Kategorien komplett leer. */
.liste { column-count:2; column-gap:8mm; column-fill:balance; }
.pfl { break-inside:avoid; padding:1.7mm 0; border-bottom:.4pt solid #EDEDED; }
.pfl .bot { font-size:9.2pt; font-weight:600; line-height:1.3; }
.pfl .de  { font-size:8.4pt; color:#666; line-height:1.32; margin-top:.5mm; }
"""


def baue_html(rows):
    kats = {}
    for r in rows:
        kats.setdefault(r["kat"], []).append(r)
    unbekannt = set(kats) - set(ORDER)
    if unbekannt:
        sys.exit(f"Unbekannte Kategorie(n): {unbekannt}\nORDER im Skript ergaenzen.")
    order = [k for k in ORDER if k in kats]

    p = [f"<style>{CSS}</style>", '<section class="titel">',
         '<div class="titel-kopf"><h1>AuGaLa<br>Pflanzenliste</h1></div>',
         '<div class="uebersicht"><div class="ueber-kopf"><h2>Übersicht</h2>',
         '<span class="lbl spalte-ct">Pflanzen</span>',
         '<span class="lbl spalte-pg">Seite</span></div>']
    for i, k in enumerate(order):
        p.append(f'<a class="zeile" href="#k{i}">{icon(k)}'
                 f'<span class="nm">{html.escape(k)}</span>'
                 f'<span class="ct spalte-ct">{len(kats[k])}</span></a>')
    p.append(f'</div><div class="fuss">{len(rows)} Pflanzen in {len(order)} '
             'Kategorien · botanische Namen kursiv, Sortennamen aufrecht in '
             'Hochkommata.</div></section>')

    for i, k in enumerate(order):
        # .anz zuerst -- ein float muss VOR dem umflossenen Inhalt stehen.
        p.append(f'<section class="kat" id="k{i}"><div class="kat-kopf">'
                 f'<span class="anz">{len(kats[k])} Pflanzen</span>'
                 f'{icon(k)}<h2>{html.escape(k)}</h2></div><div class="liste">')
        for r in sorted(kats[k], key=lambda x: sortkey(x["bot"])):
            p.append(f'<div class="pfl"><div class="bot">{fmt_bot(r["bot"])}</div>'
                     f'<div class="de">{html.escape(r["de"])}</div></div>')
        p.append("</div></section>")

    return "<!doctype html><meta charset='utf-8'>" + "".join(p), kats, order


def main():
    if not shutil.which("weasyprint"):
        sys.exit("weasyprint fehlt.  ->  brew install weasyprint")

    print(f"Lese {SRC.name} …")
    rows = lade()

    ohne = [r["bot"] for r in rows if not r["de"]]
    if ohne:
        print(f"  WARNUNG: {len(ohne)} ohne deutschen Namen: {ohne[:5]}")

    doc, kats, order = baue_html(rows)

    # Temp-HTML: das Zwischenprodukt gehoert nicht in den Projektordner.
    with tempfile.NamedTemporaryFile("w", suffix=".html", encoding="utf-8",
                                     delete=False) as fh:
        fh.write(doc)
        tmp = fh.name
    try:
        subprocess.run(["weasyprint", tmp, str(PDF)], check=True,
                       stderr=subprocess.DEVNULL)
    finally:
        Path(tmp).unlink(missing_ok=True)

    print(f"\n{PDF.name}  ({PDF.stat().st_size/1024:.0f} KB)")
    print(f"  {len(rows)} Pflanzen · {len(order)} Kategorien")
    for k in order:
        print(f"    {k:42} {len(kats[k]):>3}")


if __name__ == "__main__":
    main()
