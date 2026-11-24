// Camada de rede: User-Agent de browser, timeout generoso, retry com backoff só para erros
// transitórios (5xx/429/rede) e um limite de concorrência para não martelar o site do Fênix.

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const TIMEOUT_MS = 60_000;
const TENTATIVAS = 3;

export async function fetchHtml(url: string): Promise<string> {
  let ultimoErro: unknown;
  for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'pt-BR,pt;q=0.9' },
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) return await res.text();
      const erro = new Error(`GET ${url} -> HTTP ${res.status}`);
      if (res.status < 500 && res.status !== 429) throw Object.assign(erro, { definitivo: true });
      ultimoErro = erro;
    } catch (e) {
      if ((e as { definitivo?: boolean }).definitivo) throw e;
      ultimoErro = e;
    }
    if (tentativa < TENTATIVAS) {
      console.error(`⚠ Tentativa ${tentativa}/${TENTATIVAS} falhou para ${url}; aguardando…`);
      await Bun.sleep(4_000 * tentativa);
    }
  }
  throw ultimoErro instanceof Error ? ultimoErro : new Error(String(ultimoErro));
}

/** map assíncrono com no máximo `limite` requisições simultâneas e uma pausa entre elas. */
export async function mapLimitado<T, R>(
  itens: T[],
  limite: number,
  fn: (item: T, i: number) => Promise<R>,
  pausaMs = 250,
): Promise<R[]> {
  const out: R[] = new Array(itens.length);
  let proximo = 0;
  async function trabalhador() {
    while (proximo < itens.length) {
      const i = proximo++;
      out[i] = await fn(itens[i], i);
      if (pausaMs) await Bun.sleep(pausaMs);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, trabalhador));
  return out;
}
