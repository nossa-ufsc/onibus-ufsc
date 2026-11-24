// Contrato do snapshot (data/linhas.json) e do payload enviado ao Convex (POST /ingest/bus-lines).
// Mudanças devem ser ADITIVAS: o app antigo continua lendo os campos que já existem.

/** Tipo de dia da tabela do Consórcio Fênix. Feriado opera como `domingo`. */
export type TipoDia = 'util' | 'sabado' | 'domingo';

export interface Saida {
  /** "HH:MM" como na tabela. Saídas da madrugada (ex.: 00:05) pertencem ao fim do dia de operação. */
  hora: string;
  /** Veículo com elevador (marca "E" na tabela). */
  acessivel: boolean;
  /** Horário previsto, dependente do trânsito (marca "*" na tabela). */
  previsto: boolean;
}

export interface Quadro {
  tipoDia: TipoDia;
  /** Terminal/ponto de saída como na aba do site, ex.: "TICEN - Plataforma A - Box 6". */
  origem: string;
  /** Código curto do terminal quando reconhecido (TICEN, TITRI…), para casar com o trajeto. */
  terminal: string | null;
  saidas: Saida[];
}

export interface PontoNoTrajeto {
  /** id de src/data/pontos-campus.json */
  pontoId: string;
  /** Distância percorrida desde a saída (origem) até o ponto (m). */
  distanciaM: number;
}

export interface Trajeto {
  /** Nome da variante no mapa oficial, ex.: "233 Ida T.TIC - T.TIR". */
  nome: string;
  /** Abas de saída (`Quadro.origem`) cujos ônibus fazem este trajeto. É por aqui que o app
   *  liga um horário de saída às distâncias até os pontos. */
  origens: string[];
  /** Terminal em que o desenho começa (inferido pela geografia), quando reconhecido. */
  terminal: string | null;
  comprimentoM: number;
  /** [lon, lat], simplificado (~5 m). */
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
  /** Campus do app (enum Campus do nossa-ufsc). Por enquanto só o Trindade. */
  campus: 'florianopolis';
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
