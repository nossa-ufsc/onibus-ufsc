# onibus-ufsc

Linhas, horários e trajetos dos ônibus que passam pelo campus Trindade da UFSC, para o app Nossa UFSC.

Fonte: tabela oficial do **Consórcio Fênix** (`consorciofenix.com.br/horarios`), páginas públicas.
Roda todo dia no GitHub Actions; as mudanças aparecem no histórico de `data/linhas.json`.

## Como funciona

1. **Catálogo** — a página `/horarios` embute a lista de todas as linhas (~190).
2. **Página de cada linha** — quadros de horários por tipo de dia (úteis / sábado / domingos e feriados) e por
   aba de saída, marcas de elevador (`E`) e de horário previsto (`*`), e o itinerário rua a rua.
3. **Filtro barato** — só segue quem tem rua do entorno do campus no itinerário (ou já passava no campus).
4. **Mapa oficial** — o KML de cada sentido. Fica a linha cujo trajeto passa a **≤ 30 m** de algum ponto de ônibus
   do campus (`src/data/pontos-campus.json`, vindo do OSM). Linha nova entra e linha extinta sai sozinhas.
5. **Casamento saída ↔ trajeto** — para o app saber quando o ônibus de cada saída passa em cada ponto:
   terminal onde o trajeto começa → circular que passa pelo terminal (distâncias recontadas a partir dele) →
   nome do trajeto → eliminação. Toda saída precisa ficar ligada a um trajeto, senão a validação falha.
6. **Validação** antes de gravar qualquer coisa (`src/lib/validate.ts`): horários em ordem (virando a meia-noite
   no máximo uma vez), trajetos com desenho e dentro da região, ≥ 5 linhas no campus, no máximo 3 linhas
   sumindo de uma vez, nenhuma linha perdendo mais de 60% dos horários. Se falhar, nada é gravado e o app
   continua com o último dado bom.
7. **Envio** — `POST {CONVEX_SITE_URL}/ingest/bus-lines` com `Authorization: Bearer {INGEST_API_KEY}` e o
   snapshot inteiro (`DadosOnibus`, ver `src/lib/types.ts`).

O que **não** vem do site e é calculado aqui:

- **Quando a linha mudou** — o "Alterada em" do site é sempre a data de hoje. Usamos um hash do conteúdo de
  cada linha; `alteradaEm` é a primeira coleta em que o conteúdo atual apareceu.
- **Feriados** — a tabela de operações especiais do site parou em 2019. `src/lib/feriados.ts` calcula os
  feriados nacionais e de Florianópolis (operam como domingo) e as vésperas de Natal/Ano-Novo e a segunda de
  Carnaval (operam como sábado), para o ano corrente e o seguinte.
- **Horário em cada ponto** — o site só tem a saída do terminal. O snapshot traz a distância percorrida
  da saída até cada ponto (`Trajeto.pontos[].distanciaM`); o app estima a passagem com uma velocidade média
  por faixa horária e mostra como "previsto pela tabela".

## Rodar localmente

```bash
bun install
bun test                    # parsers e validação contra páginas reais salvas em test/fixtures
bun src/index.ts --dry-run  # coleta e valida; não grava nada
bun src/index.ts --skip-db  # grava data/linhas.json, sem enviar ao Convex
bun src/index.ts            # grava e envia (precisa de CONVEX_SITE_URL e INGEST_API_KEY)
```

Uma coleta faz ~215 requisições (4 em paralelo, com pausa) e leva ~2 min.

## Workflows

| Workflow | Quando | O quê |
| --- | --- | --- |
| `onibus.yml` — Coletar Ônibus | todo dia 06:23 BRT + manual | coleta, valida, envia ao Convex e commita `data/` |
| `retry.yml` | quando o de cima falha | reexecuta em runner novo, até 3 tentativas |
| `keepalive.yml` | segunda 09:41 BRT | heartbeat em `data/keepalive.txt` |
| `ci.yml` | push / PR | typecheck + testes |

**Keep-alive:** o GitHub desativa workflows agendados após 60 dias sem atividade, e commits feitos com o
`GITHUB_TOKEN` não contam. Por isso os commits usam uma **deploy key SSH** com escrita. A coleta commita
`data/last-run.txt` e `data/last-status.txt` todo dia, mesmo quando falha, e o keep-alive semanal é a rede de
segurança.

### Secrets

| Secret | Para quê |
| --- | --- |
| `BUS_COMMIT_SSH_KEY` | chave privada da deploy key (com write) — commits do keep-alive |
| `CONVEX_SITE_URL` | ex.: `https://<deployment>.convex.site` |
| `INGEST_API_KEY` | mesma chave dos outros pipelines (`INGEST_API_KEY` do Convex) |

Sem `CONVEX_SITE_URL`/`INGEST_API_KEY` a coleta roda, valida e commita o snapshot, só pula o envio.

## Manutenção

- **Pontos do campus mudaram** (ponto novo/removido no OSM): `bun scripts/atualizar-pontos.ts` e commitar.
- **Layout do site mudou**: a coleta falha na validação ou no parser, o app segue com o último dado bom.
  Salvar a página nova em `test/fixtures/`, ajustar `src/lib/fenix.ts` até os testes passarem.
- **Se o site bloquear os runners do GitHub** (aconteceu com os sites da UFSC nos cardápios): rodar
  `bun src/index.ts` por cron no VPS, como o `cardapios-ufsc`.
