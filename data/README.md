# Locurile din `places.json`

`places.json` conține service-uri, benzinării, vulcanizări, spălătorii și magazine de piese auto din București și Ilfov.

Datele vin din **OpenStreetMap**: © contribuitorii OpenStreetMap, licența **ODbL 1.0**
(<https://www.openstreetmap.org/copyright>, <https://opendatacommons.org/licenses/odbl/1-0/>).
Dacă folosești fișierul în altă parte, păstrează atribuirea și aceeași licență pentru datele din el.

Fișierul se reface în fiecare noapte cu `tools/fetch-places.js` (acțiunea „Actualizează locurile”) și nu se editează de mână:
ca un loc să se schimbe aici, se corectează în OpenStreetMap.

Câmpuri pentru fiecare loc: `id` (n/w/r + numărul din OSM), `t` (categoria), `n` (nume), `z` (zona), `a` (adresa), `lat`, `lon`,
`h` (programul, cum e în OSM), `tel` (perechi text afișat / număr internațional), `w` (site), `sv` (servicii scrise în etichetele OSM), `b` (marca).

Câmpuri care apar doar la locurile care le au: `d` (descrierea din OSM), `e` (e-mail), `fb` (pagina de Facebook), `ig` (pagina de Instagram) și `sd` (servicii **deduse** din nume și descriere, nu scrise în etichete; se arată altfel în aplicație). Codurile serviciilor (`sv`, `sd`) sunt cele din `SVC`, în `js/osm.js`.
