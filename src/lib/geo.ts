// Geometria em metros numa projeção local (equiretangular centrada em Florianópolis).
// Erro desprezível na escala da ilha (< 0,5% em 30 km).

export type LonLat = [number, number];
type XY = [number, number];

const LAT0 = -27.6;
const KX = 111_320 * Math.cos((LAT0 * Math.PI) / 180);
const KY = 110_540;

export const toXY = ([lon, lat]: LonLat): XY => [lon * KX, lat * KY];
export const dist = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const distLL = (a: LonLat, b: LonLat) => dist(toXY(a), toXY(b));

export function comprimento(pts: LonLat[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += distLL(pts[i - 1], pts[i]);
  return s;
}

/**
 * Passagens da linha perto do ponto p (≤ raio): distância ao longo da linha até a projeção de p
 * e distância lateral. Trechos vizinhos da mesma passagem (< 80 m ao longo) viram uma só.
 */
export function passagens(p: LonLat, linha: LonLat[], raio: number): { aoLongo: number; lateral: number }[] {
  const P = toXY(p);
  const hits: { aoLongo: number; lateral: number }[] = [];
  let acumulado = 0;
  for (let i = 0; i < linha.length - 1; i++) {
    const a = toXY(linha[i]), b = toXY(linha[i + 1]);
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L2 = dx * dx + dy * dy;
    const L = Math.sqrt(L2);
    if (L2 > 0) {
      const t = Math.max(0, Math.min(1, ((P[0] - a[0]) * dx + (P[1] - a[1]) * dy) / L2));
      const lateral = dist(P, [a[0] + t * dx, a[1] + t * dy]);
      if (lateral <= raio) hits.push({ aoLongo: acumulado + t * L, lateral });
    }
    acumulado += L;
  }
  hits.sort((x, y) => x.aoLongo - y.aoLongo);
  const out: typeof hits = [];
  for (const h of hits) {
    const ult = out[out.length - 1];
    if (ult && h.aoLongo - ult.aoLongo < 80) {
      if (h.lateral < ult.lateral) out[out.length - 1] = h;
    } else out.push(h);
  }
  return out;
}

/** Douglas-Peucker em metros (mantém o desenho, corta o tamanho do payload). */
export function simplificar(pts: LonLat[], tolM = 5): LonLat[] {
  if (pts.length < 3) return pts;
  const xy = pts.map(toXY);
  const manter = new Uint8Array(pts.length);
  manter[0] = manter[pts.length - 1] = 1;
  const pilha: [number, number][] = [[0, pts.length - 1]];
  while (pilha.length) {
    const [i0, i1] = pilha.pop()!;
    const [ax, ay] = xy[i0], [bx, by] = xy[i1];
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
    let maior = -1, idx = -1;
    for (let i = i0 + 1; i < i1; i++) {
      // trajeto circular: início = fim, então mede até o ponto em vez de até a reta
      const d = L < 1e-6 ? Math.hypot(xy[i][0] - ax, xy[i][1] - ay) : Math.abs(dy * xy[i][0] - dx * xy[i][1] + bx * ay - by * ax) / L;
      if (d > maior) { maior = d; idx = i; }
    }
    if (maior > tolM) {
      manter[idx] = 1;
      pilha.push([i0, idx], [idx, i1]);
    }
  }
  return pts.filter((_, i) => manter[i]).map(([lon, lat]) => [+lon.toFixed(6), +lat.toFixed(6)] as LonLat);
}
