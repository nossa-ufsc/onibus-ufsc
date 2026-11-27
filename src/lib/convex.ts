// Envio para o app: POST {CONVEX_SITE_URL}/ingest/bus-lines com Bearer INGEST_API_KEY
// (mesmo esquema de /ingest/menu e /ingest/academic-calendar em nossa-ufsc/convex/http.ts).
// CONVEX_SITE_URL aceita vários deployments separados por vírgula (dev e prod).

import { distLL, type LonLat } from './geo';
import type { DadosOnibus } from './types';

/** Raio em volta do campus que interessa ao mapa do app. */
const RAIO_APP_M = 1_800;

/**
 * Versão enxuta para o app: o desenho de cada trajeto fica só nos trechos a menos de RAIO_APP_M do
 * centro dos pontos do campus (o resto da cidade não aparece no mapa). O snapshot em data/ continua
 * completo. Um documento do Convex tem limite de 1 MB.
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
        // só os trechos perto do campus; entre dois trechos fica UM ponto de fora (longe do mapa),
        // que o app usa para quebrar a linha (clipToHalf) — senão uma circular que sai e volta ao
        // terminal do campus viraria uma reta atravessando o mapa
        const out: [number, number][] = [];
        let fora = true;
        for (const c of t.coordenadas) {
          if (distLL(c, centro) <= RAIO_APP_M) {
            out.push(c);
            fora = false;
          } else if (!fora) {
            out.push(c);
            fora = true;
          }
        }
        if (fora && out.length) out.pop();
        return { ...t, coordenadas: out };
      }),
    })),
  };
}

export async function enviarParaConvex(dados: DadosOnibus): Promise<'enviado' | 'sem-config'> {
  const bases = convexSiteUrls();
  const chave = process.env.INGEST_API_KEY;
  if (!bases.length || !chave) return 'sem-config';
  const corpo = JSON.stringify(paraApp(dados));
  // documento do Convex: máx. 1 MB — falha aqui, com mensagem clara, em vez de no servidor
  if (corpo.length > 900_000) throw new Error(`payload de ${dados.campus} com ${Math.round(corpo.length / 1024)} KB (> 900 KB)`);

  const erros: string[] = [];
  for (const base of bases) {
    const res = await fetch(`${base}/ingest/bus-lines`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${chave}` },
      body: corpo,
      signal: AbortSignal.timeout(60_000),
    }).catch((err: unknown) => err as Error);
    if (res instanceof Error) erros.push(`${base}: ${res.message}`);
    else if (!res.ok) erros.push(`${base}: HTTP ${res.status}: ${await res.text()}`);
  }
  if (erros.length) throw new Error(`Convex /ingest/bus-lines -> ${erros.join(' | ')}`);
  return 'enviado';
}

function convexSiteUrls(): string[] {
  return (process.env.CONVEX_SITE_URL ?? '')
    .split(',')
    .map((url) => url.trim().replace(/\/$/, ''))
    .filter(Boolean);
}
