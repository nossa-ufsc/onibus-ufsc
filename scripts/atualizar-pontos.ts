// Regera src/data/pontos-campus.json a partir do OpenStreetMap (Overpass).
// Rodar à mão quando pontos forem criados/removidos no entorno do campus:
//   bun scripts/atualizar-pontos.ts
// Os ids ("osm-<nó>") ficam estáveis enquanto o nó do OSM existir; o app referencia esses ids.

const BBOX = '-27.6075,-48.5280,-27.5945,-48.5120'; // sul, oeste, norte, leste (campus Trindade)
const SERVIDORES = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const query = `[out:json][timeout:60];node["highway"="bus_stop"](${BBOX});out;`;

type No = { id: number; lat: number; lon: number; tags?: Record<string, string> };
let nos: No[] | null = null;
for (const url of SERVIDORES) {
  try {
    const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(90_000) });
    if (res.ok) { nos = (await res.json()).elements; break; }
    console.error(`${url}: HTTP ${res.status}`);
  } catch (e) {
    console.error(`${url}: ${(e as Error).message}`);
  }
}
if (!nos?.length) throw new Error('Overpass não respondeu ou não achou pontos');

const KX = 111_320 * Math.cos((-27.6 * Math.PI) / 180), KY = 110_540;
const dist = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
  Math.hypot((a.lon - b.lon) * KX, (a.lat - b.lat) * KY);

// os dois lados da rua (mesmo nome, < 40 m) viram um ponto só
const pontos: { id: string; nome: string; lat: number; lon: number; osm: number[] }[] = [];
for (const n of nos.sort((a, b) => a.id - b.id)) {
  const nome = n.tags?.name ?? 'Ponto de ônibus';
  const par = pontos.find((p) => p.nome === nome && dist(p, n) < 40);
  if (par) {
    par.osm.push(n.id);
    par.lat = +((par.lat + n.lat) / 2).toFixed(7);
    par.lon = +((par.lon + n.lon) / 2).toFixed(7);
  } else pontos.push({ id: `osm-${n.id}`, nome, lat: +n.lat.toFixed(7), lon: +n.lon.toFixed(7), osm: [n.id] });
}

await Bun.write(
  `${import.meta.dir}/../src/data/pontos-campus.json`,
  JSON.stringify({
    _fonte: 'OpenStreetMap (highway=bus_stop no entorno do campus Trindade); lados da rua com mesmo nome a <40 m viram um ponto só. Regerar com scripts/atualizar-pontos.ts.',
    pontos,
  }, null, 1) + '\n',
);
console.log(`${pontos.length} pontos gravados`);
