// Envio para o app: POST {CONVEX_SITE_URL}/ingest/bus-lines com Bearer INGEST_API_KEY
// (mesmo esquema de /ingest/menu e /ingest/academic-calendar em nossa-ufsc/convex/http.ts).

import type { DadosOnibus } from './types';

export async function enviarParaConvex(dados: DadosOnibus): Promise<'enviado' | 'sem-config'> {
  const base = process.env.CONVEX_SITE_URL?.replace(/\/$/, '');
  const chave = process.env.INGEST_API_KEY;
  if (!base || !chave) return 'sem-config';

  const res = await fetch(`${base}/ingest/bus-lines`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${chave}` },
    body: JSON.stringify(dados),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Convex /ingest/bus-lines -> HTTP ${res.status}: ${await res.text()}`);
  return 'enviado';
}
