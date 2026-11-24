// Invariantes checadas ANTES de gravar qualquer coisa. Se algo falhar, o job falha, o snapshot
// e o Convex ficam com o último dado bom, e o erro aparece no Actions (e no e-mail do GitHub).

import type { DadosOnibus, Linha } from './types';

const minutos = (h: string) => {
  const [hh, mm] = h.split(':').map(Number);
  return hh * 60 + mm;
};

export function validarLinha(l: Linha, centro?: [number, number]): string[] {
  const erros: string[] = [];
  if (!l.quadros.length) erros.push(`${l.codigo}: sem nenhum quadro de horários`);
  for (const q of l.quadros) {
    if (!q.saidas.length) erros.push(`${l.codigo} ${q.tipoDia}/${q.origem}: aba sem horários`);
    // em ordem, permitindo virar a meia-noite uma única vez (…23:15, 00:05 ou o Madrugadão 04:25 → 00:45)
    let viradas = 0;
    for (let i = 1; i < q.saidas.length; i++) {
      const a = minutos(q.saidas[i - 1].hora), b = minutos(q.saidas[i].hora);
      if (b < a) {
        if (++viradas === 1) continue;
        erros.push(`${l.codigo} ${q.tipoDia}/${q.origem}: horário fora de ordem (${q.saidas[i - 1].hora} → ${q.saidas[i].hora})`);
        break;
      }
    }
  }
  if (!l.trajetos.length) erros.push(`${l.codigo}: sem trajeto oficial`);
  // toda aba de saída precisa estar ligada a um trajeto, senão o app não sabe quando o ônibus passa
  const ligadas = new Set(l.trajetos.flatMap((t) => t.origens));
  for (const o of new Set(l.quadros.map((q) => q.origem))) {
    if (!ligadas.has(o)) erros.push(`${l.codigo}: saída "${o}" sem trajeto correspondente`);
  }
  for (const t of l.trajetos) {
    // sem desenho é aceito (o ônibus interno de Curitibanos não tem percurso publicado); desenho truncado não
    if (t.coordenadas.length > 0 && t.coordenadas.length < 10) erros.push(`${l.codigo} ${t.nome}: trajeto com só ${t.coordenadas.length} pontos`);
    // coordenada a mais de 80 km do campus = dado corrompido (ou lat/lon trocados)
    const fora = centro && t.coordenadas.some(([lon, lat]) => Math.hypot((lon - centro[0]) * 98_000, (lat - centro[1]) * 110_500) > 80_000);
    if (fora) erros.push(`${l.codigo} ${t.nome}: trajeto com coordenada a mais de 80 km do campus`);
  }
  return erros;
}

/** Compara com o snapshot anterior para pegar parse "silenciosamente" quebrado. */
export function validarContraAnterior(novo: DadosOnibus, anterior: DadosOnibus | null): string[] {
  const n = novo.pontos.length || 1;
  const centro: [number, number] = [novo.pontos.reduce((s, p) => s + p.lon, 0) / n, novo.pontos.reduce((s, p) => s + p.lat, 0) / n];
  const erros = novo.linhas.flatMap((l) => validarLinha(l, centro));
  // campus pequeno pode ter 1–2 linhas (Joinville, Curitibanos); queda brusca é pega pela comparação abaixo
  if (!novo.linhas.length) erros.push('nenhuma linha passando no campus');
  if (!novo.pontos.length) erros.push('nenhum ponto de ônibus no campus');
  if (!anterior) return erros;

  const antes = new Map(anterior.linhas.map((l) => [l.codigo, l]));
  const sumiram = anterior.linhas.filter((l) => !novo.linhas.some((n) => n.codigo === l.codigo));
  // uma linha extinta é normal; várias de uma vez costuma ser parser quebrado
  if (sumiram.length > 3) erros.push(`${sumiram.length} linhas sumiram de uma vez: ${sumiram.map((l) => l.codigo).join(', ')}`);

  for (const l of novo.linhas) {
    const a = antes.get(l.codigo);
    if (!a) continue;
    const total = (x: Linha) => x.quadros.reduce((s, q) => s + q.saidas.length, 0);
    if (total(l) < total(a) * 0.4) {
      erros.push(`${l.codigo}: horários caíram de ${total(a)} para ${total(l)} (queda > 60%)`);
    }
  }
  return erros;
}

export interface Mudancas {
  novas: string[];
  extintas: string[];
  alteradas: string[];
}

export function mudancas(novo: DadosOnibus, anterior: DadosOnibus | null): Mudancas {
  const antes = new Map((anterior?.linhas ?? []).map((l) => [l.codigo, l.hash]));
  return {
    novas: novo.linhas.filter((l) => !antes.has(l.codigo)).map((l) => l.codigo),
    extintas: [...antes.keys()].filter((c) => !novo.linhas.some((l) => l.codigo === c)),
    alteradas: novo.linhas.filter((l) => antes.has(l.codigo) && antes.get(l.codigo) !== l.hash).map((l) => l.codigo),
  };
}
