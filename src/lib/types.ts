// Contrato do snapshot (data/<campus>.json) e do payload enviado ao Convex (POST /ingest/bus-lines).
// Fonte: API aberta do Bus2/Mobilibus (src/lib/bus2.ts), mapeada para o formato v1 que o app já lê.
// Mudanças devem ser ADITIVAS: o app antigo continua lendo os campos que já existem.

/** Tipo de dia do quadro. Feriado opera como `domingo`. */
export type TipoDia = 'util' | 'sabado' | 'domingo';

export interface Saida {
  /** "HH:MM" como na tabela. Saídas da madrugada (ex.: 00:05) pertencem ao fim do dia de operação. */
  hora: string;
  /** Viagem com veículo acessível (elevador). */
  acessivel: boolean;
  /** Viagem extra/eventual (não faz parte da grade regular). */
  previsto: boolean;
}

export interface Quadro {
  tipoDia: TipoDia;
  /** Sentido/ponto de saída, ex.: "TICEN - Plataforma A - Box 14". Quando o sentido tem mais de
   *  uma variante de trajeto, vem com o destino: "Term. Garcia (… / Terminal Fonte)". */
  origem: string;
  /** Código curto do terminal quando reconhecido (TICEN, TITRI…), para casar com o trajeto. */
  terminal: string | null;
  saidas: Saida[];
}

export interface PontoNoTrajeto {
  /** id da parada na fonte (Bus2), o mesmo de `DadosOnibus.pontos[].id` */
  pontoId: string;
  /** Distância percorrida desde a saída (origem) até o ponto (m). */
  distanciaM: number;
  /** Tempo oficial desde a saída até o ponto (s), da programação da operadora. Quando existe, o app
   *  deve preferir isto à estimativa por distância. */
  segundos?: number;
}

export interface Trajeto {
  /** Destino/nome da variante, ex.: "UFSC". */
  nome: string;
  /** Abas de saída (`Quadro.origem`) cujos ônibus fazem este trajeto. É por aqui que o app
   *  liga um horário de saída às distâncias até os pontos. */
  origens: string[];
  /** Terminal em que o desenho começa (inferido pela geografia), quando reconhecido. */
  terminal: string | null;
  comprimentoM: number;
  /** [lon, lat], simplificado (~8 m). No envio ao app, só os trechos perto do campus. */
  coordenadas: [number, number][];
  /** Pontos do campus por onde este trajeto passa, em ordem. */
  pontos: PontoNoTrajeto[];
}

export interface Linha {
  codigo: string;               // "137"
  nome: string;                 // "Volta ao Morro Norte via H.U."
  url: string;                  // página oficial
  caracteristica: string | null;
  quadros: Quadro[];
  itinerario: string[];         // ruas, em ordem, como no site
  trajetos: Trajeto[];
  /** Hash do conteúdo (quadros + itinerário + trajetos); muda quando a linha muda. */
  hash: string;
  /** Primeira vez que vimos o conteúdo atual (ISO). O site não informa a data real de alteração. */
  alteradaEm: string;
}

export interface DadosOnibus {
  versao: 1;
  /** Campus do app (enum Campus do nossa-ufsc). */
  campus: 'florianopolis' | 'blumenau';
  fonte: string;
  /** Quando a coleta rodou (ISO). */
  coletadoEm: string;
  /** Datas (AAAA-MM-DD) que operam com outro quadro, ex.: feriado → domingo. */
  diasEspeciais: Record<string, TipoDia>;
  /** Pontos do campus (id, nome, lat, lon) — referência para `Trajeto.pontos`. */
  pontos: { id: string; nome: string; lat: number; lon: number }[];
  /** Só as linhas que passam pelo campus. */
  linhas: Linha[];
}
