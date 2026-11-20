# Harta Auto București–Ilfov

Aplicație pentru șoferi: pe o hartă OpenStreetMap apar service-urile, benzinăriile, vulcanizările, spălătoriile și magazinele de piese auto din București și Ilfov. Fiecare loc arată direct, fără să deschizi nimic, programul (și dacă e deschis acum), telefonul și serviciile, luate automat din OpenStreetMap, plus un buton de navigare. Șoferii pot completa serviciile care lipsesc și pot da note, iar locurile sau informațiile care lipsesc se adaugă în OpenStreetMap, dintr-un buton din aplicație.

Se instalează pe telefon ca o aplicație obișnuită (iPhone și Android), fără magazin de aplicații, și merge și fără internet pentru ce ai văzut deja.

## Ce face

- Harta OpenStreetMap, trasă cu degetul și mărită cu două degete. Locurile apropiate se strâng în grupuri cu număr.
- Locurile vin din OpenStreetMap: benzinării, service-uri, vulcanizări, spălătorii, magazine de piese. Se iau dintr-un fișier de pe site (`data/places.json`, refăcut în fiecare noapte), se păstrează în telefon și se reîmprospătează zilnic. Dacă fișierul lipsește sau e foarte vechi, aplicația întreabă direct serverele Overpass.
- Căutare după nume, adresă sau serviciu („ulei”, „motorină”, „geometrie”), filtre pe categorii și „Deschise acum” (ora României).
- Lista locurilor, cele mai apropiate primele (de tine, dacă dai acces la locație).
- Fișa fiecărui loc arată direct, pe prima vedere: programul pe zile („L–V 08:00–18:00 · S 09:00–14:00 · D închis”, cu ziua de azi îngroșată), telefoanele (se sună cu o atingere) și primele servicii, restul la „+N”. Ce lipsește din OpenStreetMap se spune clar („Lipsesc din OpenStreetMap: programul și telefonul”), cu legătură către editor. În detalii: programul pe zile, telefoane (Sună / Copiază), site, e-mail, Facebook, Instagram, descrierea locului, toate serviciile, navigare în Google Maps, Waze sau Apple Maps, legătură spre locul din OpenStreetMap.
- Datele luate din OpenStreetMap: `opening_hours`, telefon (`phone`, `contact:phone`, `mobile`, `contact:mobile`, `phone:mobile`), servicii din etichete (`service:vehicle:*`, `service=`, combustibili, plată cu cardul, Wi-Fi) și, separat, servicii **deduse** din nume și descriere (afișate cu linie întreruptă). Locurile fără aceste date rămân cu ce are OSM: se completează în OpenStreetMap și apar aici la următoarea actualizare de noapte.
- „Lipsește un loc?”: butonul de pe hartă (și cel de la sfârșitul listei, din „Niciun loc găsit” și din „Despre”) deschide editorul OpenStreetMap exact la locul din mijlocul hărții. Trebuie un cont OpenStreetMap, gratuit.
- Servicii completate de șofer și note de la 1 la 5, **păstrate deocamdată doar pe telefonul lui**.
- Temă întunecată automată, ecran lat (calculator, tabletă) cu panou lateral.
- Scurtături la lung-apăsarea iconiței pe Android: `?t=benz`, `?t=vulc`, `?t=service`, `?t=spal` (și `&open=1` pentru „deschise acum”).

## Cum o încerci pe calculator

Ai nevoie doar de un server local, pentru că harta OpenStreetMap nu se încarcă dacă deschizi `index.html` direct din folder.

```
python3 -m http.server 8080
```

Apoi deschide <http://localhost:8080>.

Fișierul `data/places.json` e deja în proiect. Ca să-l refaci acum din OpenStreetMap: `node tools/fetch-places.js` (Node 18 sau mai nou).

## Cum o pui pe internet (GitHub Pages)

1. Pune toate fișierele din acest folder într-un depozit GitHub (în rădăcină, nu într-un subfolder).
2. În depozit: **Settings → Pages → Build and deployment → Deploy from a branch**, alege `main` și `/ (root)`, apoi **Save**.
3. După un minut, adresa e `https://NUMELE-TAU.github.io/NUMELE-DEPOZITULUI/`. Deschide-o pe telefon.
4. Pe Android: meniul browserului → **Instalează aplicația**. Pe iPhone, în Safari: **Distribuie → Adaugă pe ecranul principal**.

Când schimbi fișiere, mărește `VERSION` din `sw.js` (de exemplu `v5`), ca telefoanele să ia varianta nouă.

### Locurile se refac singure în fiecare noapte

Acțiunea GitHub din `.github/workflows/actualizeaza-locuri.yml` rulează `tools/fetch-places.js`, care ia locurile din OpenStreetMap și le scrie în `data/places.json`. Dacă s-a schimbat ceva, le salvează în depozit, iar site-ul se publică din nou. O poți porni și de mână: fila **Actions → Actualizează locurile → Run workflow**.

De ce așa: serverele publice Overpass sunt deseori aglomerate (seara mai ales) și pot răspunde în zeci de secunde sau deloc. Cu fișierul de pe site, harta se umple imediat, iar Overpass rămâne doar ca rezervă.

## Cum e făcută

| Fișier | Rol |
| --- | --- |
| `index.html`, `styles.css` | Pagina și aspectul |
| `js/app.js` | Harta (plăci OpenStreetMap pe canvas, fără bibliotecă externă), pini și grupuri, gesturi, listă, fișe, evaluări |
| `js/osm.js` | Interogarea Overpass (mai multe servere, cererile pornesc eșalonat și câștigă primul răspuns bun) și transformarea etichetelor OSM în categorie, servicii (din etichete și deduse din text), telefon, e-mail, Facebook, Instagram, descriere, adresă |
| `data/places.json` | Locurile din OpenStreetMap, refăcute zilnic (vezi `data/README.md` pentru licență) |
| `tools/fetch-places.js`, `.github/workflows/` | Descărcarea de noapte a locurilor |
| `js/hours.js` | Citește `opening_hours` din OSM și spune dacă e deschis acum |
| `sw.js` | Lucrul fără internet: fișierele aplicației (cu fonturi și politica), plăcile văzute; la un 404 sau 5xx la deschidere arată pagina salvată, ca aplicația să nu pară defectă în Google Play |
| `manifest.webmanifest`, `icons/` | Instalarea pe telefon |
| `confidentialitate.html` | Politica de confidențialitate (română și engleză), legată din „Despre și date”; obligatorie la Google Play și App Store |
| `fonts/` | Fonturile aplicației (Barlow, woff2, latin și latin-ext pentru ă, ș, ț) și licența lor |
| `tests/` | Teste: `node tests/unit.js` (rapide) și `node tests/e2e.js` (în browser, cere pachetul `playwright`) |

Nu are pași de compilare și nu are dependențe. Scripturile sunt clasice, nu module.

## Reguli de folosire a datelor (important)

- **Harta și locurile sunt din OpenStreetMap**, licența ODbL. Atribuirea „© OpenStreetMap” apare pe hartă și în „Despre”. Nu o scoate.
- **Serverul de plăci `tile.openstreetmap.org`** e gratuit, dar pentru uz ușor: încercări și un număr mic de utilizatori. Dacă aplicația prinde, treci la un furnizor de plăci (MapTiler, Stadia Maps, Thunderforest, Jawg sau propriul server) schimbând adresa `TILE_URL` de la începutul lui `js/app.js` și respectând atribuirea cerută de furnizor. Vezi <https://operations.osmfoundation.org/policies/tiles/>.
- **Serverele Overpass** publice sunt tot pentru uz rezonabil. De aceea locurile se descarcă o dată pe noapte într-un fișier de pe site (`data/places.json`), iar aplicațiile îl citesc de acolo. Doar dacă fișierul lipsește sau are peste 7 zile, aplicația întreabă direct Overpass.
- **Fonturile** (Barlow și Barlow Semi Condensed, licență SIL Open Font License) sunt chiar în proiect, în `fonts/`, împreună cu licența (`fonts/OFL.txt`, trebuie păstrată). Aplicația nu cere nimic de la Google Fonts, deci nu are cereri în plus de declarat în politica de confidențialitate și merge la fel și fără net.

## Politica de confidențialitate

`confidentialitate.html` spune ce date folosește aplicația: ce rămâne în telefon, când se cere locația și ce servicii terțe contactează harta (OpenStreetMap, Overpass, GitHub Pages). Trebuie să rămână adevărată: dacă schimbi furnizorul de plăci, adaugi un server, un cookie, o statistică sau conturi, actualizeaz-o. `node tests/unit.js` pică dacă un server contactat de aplicație nu apare în politică sau dacă apar cookie-uri ori unelte de urmărire.

## Ce rămâne local deocamdată

Notele și serviciile completate de șoferi se salvează în telefonul fiecăruia (`localStorage`) și nu le vede nimeni altcineva. Pentru note comune, de la toți șoferii, e nevoie de un server cu baze de date și conturi (ca să nu poată vota oricine de mai multe ori). Asta e pasul următor firesc.

## Idei pentru mai departe

- Server și conturi pentru note și completări comune, cu moderare.
- Prețuri la combustibil pe fișa benzinăriei.
- Butonul „Înapoi” de pe Android care închide fișa.
- Alte orașe.
