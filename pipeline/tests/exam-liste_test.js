'use strict';

/**
 * Prüft die Regeln, nach denen aus einem Prüfungsblatt eine Lernliste wird.
 *
 *     npm run test:pruefungsliste
 *
 * Jeder Fall hier stammt aus der echten AuGaLa-Liste. Der Bau ist am 28.08.2026 an genau diesen
 * Fällen gescheitert: `full.ndjson` hatte 293 Zeilen und **keine einzige Sorte**.
 *
 * Kein Netz, keine Daten.
 */

const {
  vergleichsname, istBinomen, istPlatzhalter, zeileZuEintraegen, ergaenzeElternarten, zeilenZuListe,
  verschmelzeAufloesungen, sortiere,
} = require('../lib/exam-liste');

let fehler = 0;
const pruefe = (bestanden, text) => {
  if (!bestanden) fehler++;
  console.log(`  ${bestanden ? '✓' : '🔴'} ${text}`);
};
const gleich = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('\n=== PRÜFUNGSLISTE ===');

// ── A: Vergleichsname ────────────────────────────────────────────────────────

console.log('\nA — der Vergleichsname trifft alle Schreibweisen derselben Pflanze');
for (const [ein, soll, warum] of [
  ["Ajuga reptans 'Atropurpurea'", 'ajuga reptans atropurpurea', 'gerades Hochkomma'],
  ['Ajuga reptans ’Atropurpurea’', 'ajuga reptans atropurpurea', 'typografisches (U+2019)'],
  ['Ajuga reptans ʽAtropurpurea’', 'ajuga reptans atropurpurea', 'Wikidatas U+02BD'],
  ["Helianthemum 'Lawrenson´s Pink'", 'helianthemum lawrenson s pink', 'Akut der CSV (U+00B4)'],
  ['Platanus × hispanica', 'platanus x hispanica', 'Hybridzeichen wird x'],
  ["Aster 'Kassel' (Dumosus-Gruppe)", 'aster kassel', 'geklammerter Zusatz faellt weg'],
  ["Aster 'Kassel'", 'aster kassel', '… und trifft damit dieselbe Pflanze'],
  ["Calluna vulgaris 'ArabellaⓈ'", 'calluna vulgaris arabella', 'Schutzzeichen faellt weg'],
  ["Ribes rubrum  'Sorte'", 'ribes rubrum sorte', 'doppelte Leerzeichen'],
]) pruefe(vergleichsname(ein) === soll, `${warum}: „${ein}" → „${vergleichsname(ein)}"`);

console.log('\nB — Binomen von Gattung unterscheiden');
for (const [ein, soll] of [
  ['Ajuga reptans', true], ['Achillea', false], ['Dahlia', false],
  ['Platanus × hispanica', true], ['x Cupressocyparis leylandii', true],
]) pruefe(istBinomen(ein) === soll, `„${ein}" ist ${soll ? 'zweiteilig' : 'eine Gattung'}`);

console.log('\nC — der Platzhalter wird als solcher erkannt');
pruefe(istPlatzhalter('Sorte'), '„Sorte" ist der Platzhalter');
pruefe(istPlatzhalter('sorte'), 'auch klein geschrieben');
pruefe(!istPlatzhalter('Atropurpurea'), '„Atropurpurea" ist eine echte Sorte');

// ── D: die drei Regeln ───────────────────────────────────────────────────────

console.log('\nD — Regel 1: eine Art bleibt eine Zeile');
{
  const e = zeileZuEintraegen({ botanisch: 'Acer campestre', deutsch: 'Feld-Ahorn', kategorie: 'Laubgehölze' });
  pruefe(e.length === 1, 'genau ein Eintrag');
  pruefe(e[0].rang === 'art' && e[0].germanName === 'Feld-Ahorn', 'Rang art, deutscher Name aus der CSV');
  pruefe(e[0].parentBotanicalName === null, 'keine Elternart');
}

console.log('\nE — Regel 2: eine Sorte bringt ihre Art mit');
{
  const e = zeilenZuListe([{ botanisch: "Ajuga reptans 'Atropurpurea'", deutsch: 'Rotblättriger Kriechender Günsel', kategorie: 'Stauden' }]);
  pruefe(e.length === 2, 'zwei Einträge — die Sorte und ihre Art');
  pruefe(e[0].rang === 'sorte' && e[0].parentBotanicalName === 'Ajuga reptans', 'die Sorte kennt ihre Art');
  pruefe(e[1].botanicalName === 'Ajuga reptans' && e[1].rang === 'art', 'die Art wird angelegt');
  pruefe(e[1].kategorie === 'Stauden', 'sie erbt die Kategorie der Sorte');
  pruefe(
    e[1].germanName === null,
    '🔴 die Art bekommt KEINEN deutschen Namen — „Rotblättriger …" gehört der Sorte, nicht der Art',
  );
}

console.log('\nE2 — dieselbe Regel gilt für eine Unterart');
{
  const e = zeilenZuListe([{ botanisch: 'Armeria maritima subsp. elongata', deutsch: 'Sand-Grasnelke', kategorie: 'Stauden' }]);
  pruefe(e.length === 2 && e[1].botanicalName === 'Armeria maritima', 'die Art kommt mit');
}

console.log('\nE3 — die Regel gilt für JEDE Liste, nicht nur für die AuGaLa-CSV');
{
  // Der Fall aus Kurs 01, gemeldet am 31.08.2026: die Kugelform ohne den Spitz-Ahorn.
  const e = ergaenzeElternarten([
    { botanicalName: "Acer platanoides 'Globosum'", germanName: 'Kugel-Ahorn', kategorie: 'Laubgehölze', rang: 'sorte', parentBotanicalName: null, zwischenpruefung: false },
  ]);
  pruefe(e.length === 2 && e[1].botanicalName === 'Acer platanoides', 'die Art wird ergänzt');
  pruefe(e[0].parentBotanicalName === 'Acer platanoides', '🔴 und die Sorte kennt sie jetzt — sonst reisst `sortiere` beide auseinander');
  pruefe(e[1].ergaenzt === true, 'sie ist als abgeleitet gekennzeichnet');
}

console.log('\nE4 — die Zwischenprüfungsmarke wird vererbt, aber nie überschrieben');
{
  const abgeleitet = ergaenzeElternarten([
    { botanicalName: "Prunus laurocerasus 'Otto Luyken'", germanName: 'Kirschlorbeer', kategorie: 'x', rang: 'sorte', parentBotanicalName: null, zwischenpruefung: true },
  ]);
  pruefe(abgeleitet[1].zwischenpruefung === true, 'die abgeleitete Art erbt das ZP der Sorte');

  const eigene = ergaenzeElternarten([
    { botanicalName: 'Prunus laurocerasus', germanName: 'Kirschlorbeer', kategorie: 'x', rang: 'art', parentBotanicalName: null, zwischenpruefung: false },
    { botanicalName: "Prunus laurocerasus 'Otto Luyken'", germanName: 'Otto Luyken', kategorie: 'x', rang: 'sorte', parentBotanicalName: null, zwischenpruefung: true },
  ]);
  pruefe(eigene.length === 2, 'eine vorhandene Art wird nicht doppelt angelegt');
  pruefe(eigene[0].zwischenpruefung === false, '🔴 eine Zeile der Vorlage wird NICHT umgeschrieben');
}

console.log('\nE5 — ein kaputter Name bringt nichts mit');
{
  // `Hedera hibernica'` steht so in der Baumschulliste — ein verirrtes Hochkomma.
  const e = ergaenzeElternarten([
    { botanicalName: "Hedera hibernica'", germanName: 'Irischer Efeu', kategorie: 'x', rang: 'sorte', parentBotanicalName: null, zwischenpruefung: false },
  ]);
  pruefe(e.length === 1, 'kein zweiter Eintrag — sonst stünde dieselbe Pflanze zweimal in der Liste');
}

console.log('\nF — Regel 2 endet bei der Gattung');
{
  const e = zeilenZuListe([{ botanisch: "Achillea 'Coronation Gold'", deutsch: 'Garten-Gold-Garbe', kategorie: 'Stauden' }]);
  pruefe(e.length === 1, 'nur die Sorte — die Gattung Achillea wird NICHT zum Eintrag');
  pruefe(e[0].rang === 'sorte', 'und sie bleibt eine Sorte');
  pruefe(e[0].parentBotanicalName === 'Achillea', '… kennt ihre Gattung aber, damit `sortiere` sie zusammenhält');
}

console.log('\nG — Regel 3: „Sorte" ist keine Sorte');
{
  const art = zeileZuEintraegen({ botanisch: "Prunus avium 'Sorte'", deutsch: 'Süßkirsche', kategorie: 'Obstgehölze' });
  pruefe(art.length === 1 && art[0].botanicalName === 'Prunus avium', 'faellt auf die Art zurück');
  pruefe(art[0].rang === 'art' && art[0].germanName === 'Süßkirsche', 'behält den deutschen Namen der CSV');

  const gattung = zeileZuEintraegen({ botanisch: "Dahlia 'Sorte'", deutsch: 'Dahlie', kategorie: 'Stauden' });
  pruefe(gattung.length === 1 && gattung[0].botanicalName === 'Dahlia', 'bei einer Gattung bleibt die Gattung');
  pruefe(gattung[0].rang === 'gattung', '… und wird als solche gekennzeichnet');
}

console.log('\nH — die Asymmetrie zwischen F und G ist gewollt');
pruefe(
  zeileZuEintraegen({ botanisch: "Dahlia 'Sorte'", deutsch: 'Dahlie' })[0].botanicalName === 'Dahlia' &&
    zeilenZuListe([{ botanisch: "Achillea 'Coronation Gold'", deutsch: 'x' }]).every(e => e.botanicalName !== 'Achillea'),
  'die Gattung entsteht aus dem Platzhalter, nie aus einer echten Sorte',
);

// ── I: Entdoppeln ────────────────────────────────────────────────────────────

console.log('\nI — Dubletten fallen zusammen, der deutsche Name überlebt');
{
  const liste = zeilenZuListe([
    { botanisch: 'Taxus baccata', deutsch: 'Eibe', kategorie: 'Nadelgehölze' },
    { botanisch: 'Taxus baccata', deutsch: 'Eibe', kategorie: 'Heimische, besonders geschützte Pflanzen' },
    { botanisch: "Ajuga reptans 'Atropurpurea'", deutsch: 'Rotblättriger Günsel', kategorie: 'Stauden' },
    { botanisch: 'Ajuga reptans', deutsch: 'Kriechender Günsel', kategorie: 'Stauden' },
  ]);
  pruefe(liste.length === 3, 'aus vier Zeilen werden drei Einträge');
  const ajuga = liste.find(e => e.botanicalName === 'Ajuga reptans');
  pruefe(
    ajuga.germanName === 'Kriechender Günsel',
    '🔴 die eigene CSV-Zeile gewinnt über die abgeleitete Elternart',
  );
}

console.log('\nJ — die Reihenfolge, wenn die Art ZUERST kommt');
{
  // Umgekehrte Eingabereihenfolge: erst die Art, dann die Sorte. Das Ergebnis muss dasselbe sein.
  const liste = zeilenZuListe([
    { botanisch: 'Ajuga reptans', deutsch: 'Kriechender Günsel', kategorie: 'Stauden' },
    { botanisch: "Ajuga reptans 'Atropurpurea'", deutsch: 'Rotblättriger Günsel', kategorie: 'Stauden' },
  ]);
  pruefe(liste.find(e => e.botanicalName === 'Ajuga reptans').germanName === 'Kriechender Günsel', 'Namen bleiben zugeordnet');
}

// ── K2: Zusammenlegen nach der Auflösung ────────────────────────────────────

console.log('\nK2 — zwei Prüfungszeilen, eine Pflanze');
{
  const aus = verschmelzeAufloesungen([
    { botanicalName: 'Crocus albiflorus', germanName: 'Frühlings-Krokus', rang: 'art', plantKey: 2747567, matchedVia: 'synonym' },
    { botanicalName: 'Crocus vernus', germanName: null, rang: 'art', plantKey: 2747567, matchedVia: 'canonical' },
    { botanicalName: 'Taxus baccata', germanName: 'Eibe', rang: 'art', plantKey: 5284517, matchedVia: 'canonical' },
  ]);
  pruefe(aus.length === 2, 'aus drei Einträgen werden zwei');
  const crocus = aus.find(e => e.plantKey === 2747567);
  pruefe(crocus.botanicalName === 'Crocus vernus', '🔴 der heute gültige Name überlebt, nicht der der Prüfungsliste');
  pruefe(gleich(crocus.alsoKnownAs, ['Crocus albiflorus']), '… und der Name des Prüfungsblatts bleibt auffindbar');
  pruefe(crocus.germanName === 'Frühlings-Krokus', 'der deutsche Name geht nicht verloren');
}

console.log('\nK3 — die Reihenfolge der Eingabe ändert nichts');
{
  const umgekehrt = verschmelzeAufloesungen([
    { botanicalName: 'Crocus vernus', germanName: null, rang: 'art', plantKey: 2747567, matchedVia: 'canonical' },
    { botanicalName: 'Crocus albiflorus', germanName: 'Frühlings-Krokus', rang: 'art', plantKey: 2747567, matchedVia: 'synonym' },
  ]);
  pruefe(umgekehrt.length === 1 && umgekehrt[0].botanicalName === 'Crocus vernus', 'derselbe Überlebende');
}

console.log('\nK4 — Gesperrte werden nicht über `null` zusammengelegt');
{
  const aus = verschmelzeAufloesungen([
    { botanicalName: "Aster 'Kassel'", rang: 'sorte', plantKey: null, matchedVia: null },
    { botanicalName: "Bergenia 'Silberlicht'", rang: 'sorte', plantKey: null, matchedVia: null },
  ]);
  pruefe(aus.length === 2, 'zwei gesperrte Einträge bleiben zwei');
}

// ── K: Sortierung ────────────────────────────────────────────────────────────

console.log('\nK — sortiert nach Bekanntheit, Sorten hinter ihrer Art');
{
  const sortiert = sortiere([
    { botanicalName: 'Ajuga reptans', rang: 'art', parentBotanicalName: null, imagesCount: 32717 },
    { botanicalName: "Ajuga reptans 'Atropurpurea'", rang: 'sorte', parentBotanicalName: 'Ajuga reptans', imagesCount: 0 },
    { botanicalName: 'Fagus sylvatica', rang: 'art', parentBotanicalName: null, imagesCount: 43095 },
    { botanicalName: "Fagus sylvatica 'Pendula'", rang: 'sorte', parentBotanicalName: 'Fagus sylvatica', imagesCount: 12 },
    { botanicalName: 'Peltaria alliacea', rang: 'art', parentBotanicalName: null, imagesCount: 2 },
  ]);
  const namen = sortiert.map(e => e.botanicalName);
  pruefe(
    gleich(namen, ['Fagus sylvatica', "Fagus sylvatica 'Pendula'", 'Ajuga reptans', "Ajuga reptans 'Atropurpurea'", 'Peltaria alliacea']),
    `Blöcke nach Bekanntheit, Sorte direkt hinter ihrer Art: ${namen.join(' · ')}`,
  );
  pruefe(gleich(sortiert.map(e => e.sortIndex), [0, 1, 2, 3, 4]), 'sortIndex laeuft luecklos von 0');
}

console.log('\nL — ein Block ohne Kopf erbt den Rang seiner Sorten');
{
  const sortiert = sortiere([
    { botanicalName: 'Peltaria alliacea', rang: 'art', parentBotanicalName: null, imagesCount: 2 },
    { botanicalName: "Achillea 'Coronation Gold'", rang: 'sorte', parentBotanicalName: 'Achillea', imagesCount: 500 },
  ]);
  pruefe(
    sortiert[0].botanicalName === "Achillea 'Coronation Gold'",
    'die kopflose Sorte steht vorn, weil der Block das Maximum seiner Mitglieder erbt',
  );
}

console.log('\nM — derselbe Lauf ergibt dieselbe Reihenfolge');
{
  const eingabe = [
    { botanicalName: 'B art', rang: 'art', parentBotanicalName: null, imagesCount: 0 },
    { botanicalName: 'A art', rang: 'art', parentBotanicalName: null, imagesCount: 0 },
    { botanicalName: 'C art', rang: 'art', parentBotanicalName: null, imagesCount: 0 },
  ];
  const a = sortiere(eingabe).map(e => e.botanicalName);
  const b = sortiere([...eingabe].reverse()).map(e => e.botanicalName);
  pruefe(gleich(a, b) && gleich(a, ['A art', 'B art', 'C art']), 'bei Gleichstand alphabetisch — unabhängig von der Eingabereihenfolge');
}

console.log(fehler === 0 ? '\n✅ alle Prüfungen bestanden\n' : `\n🔴 ${fehler} Prüfung(en) fehlgeschlagen\n`);
process.exit(fehler === 0 ? 0 : 1);
