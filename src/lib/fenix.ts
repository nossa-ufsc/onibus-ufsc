// Catálogo do Consórcio Fênix (consorciofenix.com.br/horarios): só para o link oficial de cada linha de
// Florianópolis — os horários vêm da API do Bus2 (src/lib/bus2.ts).


export const BASE = 'https://www.consorciofenix.com.br';

export interface ItemCatalogo {
  codigo: string;
  nome: string;
  url: string;
}

/** A página /horarios embute o catálogo inteiro num array JSON usado pela busca. */
export function parseCatalogo(html: string): ItemCatalogo[] {
  const m = html.match(/(\[\{"url":"\\\/horarios.*?\}\])/s);
  if (!m) throw new Error('Catálogo de linhas não encontrado em /horarios (layout mudou?)');
  const itens = JSON.parse(m[1]) as { url: string; name: string }[];
  return itens.map((x) => {
    const i = x.name.indexOf(' - ');
    if (i < 0) throw new Error(`Item de catálogo fora do padrão "CÓDIGO - Nome": ${x.name}`);
    return { codigo: x.name.slice(0, i).trim(), nome: x.name.slice(i + 3).trim(), url: BASE + x.url };
  });
}
