// Envio para o app: POST {CONVEX_SITE_URL}/ingest/bus-lines com Bearer INGEST_API_KEY
// (mesmo esquema de /ingest/menu e /ingest/academic-calendar em nossa-ufsc/convex/http.ts).

import { distLL, type LonLat } from './geo';
import type { DadosOnibus } from './types';

/** Raio em volta do campus que interessa ao mapa do app. */
const RAIO_APP_M = 2_500;

/**
 * Versão enxuta para o app: o desenho de cada trajeto fica só entre o primeiro e o último ponto a
 * menos de RAIO_APP_M do centro dos pontos do campus (o resto da cidade não aparece no mapa).
 * O snapshot em data/linhas.json continua completo.
 */
export function paraApp(dados: DadosOnibus): DadosOnibus {
  const n = dados.pontos.length || 1;
  const centro: LonLat = [
    dados.pontos.reduce((s, p) => s + p.lon, 0) / n,
    dados.pontos.reduce((s, p) => s + p.lat, 0) / n,
  ];
  return {
    ...dados,
    linhas: dados.linhas.map((l) => ({
      ...l,
      trajetos: l.trajetos.map((t) => {
        const perto = t.coordenadas.map((c) => distLL(c, centro) <= RAIO_APP_M);
        const i0 = perto.indexOf(true);
        const i1 = perto.lastIndexOf(true);
        return { ...t, coordenadas: i0 < 0 ? [] : t.coordenadas.slice(Math.max(0, i0 - 1), i1 + 2) };
      }),
    })),
  };
}

export async function enviarParaConvex(dados: DadosOnibus): Promise<'enviado' | 'sem-config'> {
  const base = process.env.CONVEX_SITE_URL?.replace(/\/$/, '');
  const chave = process.env.INGEST_API_KEY;
  if (!base || !chave) return 'sem-config';

  const res = await fetch(`${base}/ingest/bus-lines`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${chave}` },
    body: JSON.stringify(paraApp(dados)),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Convex /ingest/bus-lines -> HTTP ${res.status}: ${await res.text()}`);
  return 'enviado';
}
