# Ultra Pointer

Ręka na patyku, która na skrót wysuwa się z krawędzi ekranu najbliższej kursorowi i pokazuje go palcem.
Gdy kursor podejdzie wyraźnie bliżej innej krawędzi, ręka się chowa, a z nowej krawędzi wychodzi inna, losowa.

Działa na macOS i Windows (Electron): przezroczyste okno nad wszystkim, klikasz przez nie normalnie,
po jednym oknie na każdy monitor. Ikona w zasobniku / pasku menu.

## Uruchomienie

```bash
npm install
npm start
```

Skrót: **Alt+Shift+P** (na Macu ⌥⇧P). Inny skrót: `ULTRA_POINTER_SHORTCUT="CommandOrControl+Shift+H" npm start`.

Demo w przeglądarce bez Electrona: otwórz `demo/index.html` (klawisz H).

## Paczka instalacyjna

```bash
npm run dist   # .dmg na Macu, instalator .exe na Windows
```

## Pliki

- `main.js`: okna-nakładki, globalny skrót, tray, wysyłanie pozycji kursora (60 fps).
- `renderer/hand-engine.js`: cała logika ręki (wybór krawędzi, wysuwanie, celowanie, podmiana stylu). Parametry na górze pliku.
- `assets/sprites/`: 14 rąk wyciętych z `assets/hands-sheet.jpg`; `hands.json` ma pozycję końca patyka i czubka palca.
- `tools/cut_hands_ai.py`: wycina ręce z arkusza modelem AI do usuwania tła (BiRefNet przez rembg) i generuje `hands.json` oraz `renderer/sprites.js`. Instrukcja na górze pliku.

## Uwagi

- macOS: przy pierwszym uruchomieniu system może poprosić o zgodę; okno działa też nad aplikacjami pełnoekranowymi.
- Nowa ręka: dorzuć PNG z patykiem na dole i palcem do góry, albo podmień arkusz i puść `tools/cut_hands_ai.py`.
