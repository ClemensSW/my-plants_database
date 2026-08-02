# EIVE 1.0 — ökologische Zeigerwerte für Europa

## Herkunft
Dengler, J., Jansen, F., … & Gillet, F. (2023): *Ecological Indicator Values for Europe (EIVE) 1.0.*
Vegetation Classification and Survey 4: 7–29. DOI Paper `10.3897/VCS.98324`.
Daten: Zenodo Record `7534792`, DOI `10.5281/zenodo.7534792`.

## Lizenz
**CC BY 4.0** — kommerzielle Nutzung erlaubt, Bedingung ist Namensnennung inkl. Hinweis auf
Änderungen. Wir gruppieren die Werte in Stufen; das ist eine Änderung der Darstellung.
Attribution in der App: `myplants-app/src/screens/terms/DataSourcesScreen.tsx`.

## Beschaffung
```
curl -L -o EIVE_Paper_1.0_SM_08.xlsx \
  https://zenodo.org/api/records/7534792/files/EIVE_Paper_1.0_SM_08.xlsx/content
md5 EIVE_Paper_1.0_SM_08.xlsx   # 0f0ce19cd2a781eeed027d8b0acadbcb
```
Blatt `mainTable`, 14.835 Datenzeilen. Spalten heißen **`EIVEres-<X>`**, `EIVEres-<X>.nw3`,
`EIVEres-<X>.n` — nicht `EIVE-<X>`, wie der Fließtext des Papers nahelegt.

## Was hier liegt
- `../eive-slim.json` — 10.693 Arten, keyed nach normalisiertem Binomen, `{p, w, n}` je Faktor
- `../manifest.json` — Version, DOI, Prüfsummen, Kontrollzahlen
- `ANALYSE.md` — **die Analyse**: Struktur, semantische Prüfung, Abdeckung, Machbarkeit
- `mockup-standort-quiz.html` — das abgenommene Design (im Browser öffnen)
- `EIVE_Paper_1.0_SM_08.xlsx`, `EIVE_Paper_1.0_SM_03.xlsx` — Rohdaten

SM_02 (16 MB) ist bewusst **nicht** abgelegt.

## Letzte Aktualisierung
2026-08-02
