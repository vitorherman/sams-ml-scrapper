import { NextResponse } from 'next/server';
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

function parseBRLToNumber(input: string): number | null {
  if (!input) return null;
  const m = input.match(/R\$\s*([\d\.,]+)/i);
  const raw = (m ? m[1] : input)
    .replace(/\s/g, '')
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^\d.]/g, '');
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function formatBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

const ML_STORAGE_STATE_PATH = path.join(process.cwd(), '.ml-storage-state.json');

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout(${label}) after ${ms}ms`)), ms);
    promise
      .then((v) => {
        clearTimeout(timer);
        resolve(v);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

async function fetchFirstMercadoLivrePrice(
  page: import('playwright').Page,
  query: string,
  samsPrice: number,
): Promise<{ price: number | null; reason: string }> {
  // Aguarda o container de resultados (o ML alterna entre alguns layouts)
  await page
    .waitForSelector('li.ui-search-layout__item, ol.ui-search-layout, ul.ui-search-layout, div.ui-search-result__wrapper', {
      timeout: 15000,
    })
    .catch(() => null);

  const result = await page.evaluate(({ query, samsPrice }) => {
    const normalize = (t: string) => t.replace(/\s+/g, ' ').replace(/\u00A0/g, ' ').trim();
    const normLower = (t: string) => normalize(t).toLowerCase();

    const body = document.body?.innerText ? document.body.innerText.toLowerCase() : '';
    if (body.includes('para continuar, acesse sua conta')) {
      return { price: null, reason: 'ml_requires_login' };
    }
    if (body.includes('captcha') || body.includes('verificar') || body.includes('confira') || body.includes('segurança')) {
      return { price: null, reason: 'captcha_or_verification' };
    }

    const toNumber = (txt: string): number | null => {
      const m = normalize(txt).match(/R\$\s*([\d\.,]+)/i);
      if (!m) return null;
      const raw = m[1].replace(/\s/g, '').replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, '');
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    };

    const tokenSet = (text: string): Set<string> => {
      const stop = new Set([
        'de', 'da', 'do', 'das', 'dos', 'com', 'para', 'sem', 'em', 'na', 'no', 'e', 'ou', 'a', 'o', 'as', 'os',
      ]);
      const tokens = normLower(text)
        .replace(/[^a-z0-9à-ÿ\s]/gi, ' ')
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => t.length >= 3 && !stop.has(t));
      return new Set(tokens);
    };

    const overlapRatio = (a: Set<string>, b: Set<string>): number => {
      if (a.size === 0) return 0;
      let hits = 0;
      for (const t of a) {
        if (b.has(t)) hits++;
      }
      return hits / a.size;
    };

    const isOriginalPriceNode = (el: Element): boolean => {
      let cur: Element | null = el;
      for (let i = 0; i < 4 && cur; i++) {
        const cls = ((cur as HTMLElement).className || '').toString().toLowerCase();
        if (
          cls.includes('original') ||
          cls.includes('old') ||
          cls.includes('cross') ||
          cls.includes('list-price') ||
          cls.includes('strike')
        ) {
          return true;
        }
        cur = cur.parentElement;
      }
      return false;
    };

    const getPriceFromCard = (card: Element): number | null => {
      // Captura todos os preços monetários do card e prioriza preços "atuais" (não riscados)
      const amountNodes = Array.from(card.querySelectorAll('span.andes-money-amount__fraction'));
      const candidates: number[] = [];
      const backup: number[] = [];

      for (const node of amountNodes) {
        const frac = normalize((node as HTMLElement).innerText || node.textContent || '');
        const centsNode = node.parentElement?.querySelector('span.andes-money-amount__cents') as HTMLElement | null;
        const cents = normalize(centsNode?.innerText || centsNode?.textContent || '');
        const txt = cents ? `R$ ${frac},${cents}` : `R$ ${frac}`;
        const n = toNumber(txt);
        if (n === null) continue;

        if (isOriginalPriceNode(node)) {
          backup.push(n);
        } else {
          candidates.push(n);
        }
      }

      if (candidates.length > 0) return candidates[0];
      if (backup.length > 0) return backup[0];

      const aria = card.querySelector('[aria-label*="R$"], [title*="R$"]') as HTMLElement | null;
      const ariaTxt = normalize(aria?.getAttribute('aria-label') || aria?.getAttribute('title') || '');
      const n2 = ariaTxt ? toNumber(ariaTxt) : null;
      if (n2 !== null) return n2;
      return null;
    };

    const queryTokens = tokenSet(query);
    const cardSelectors = [
      'li.ui-search-layout__item',
      'div.ui-search-result__wrapper',
      'div.ui-search-result__content-wrapper',
      'div.ui-search-result',
    ];

    for (const sel of cardSelectors) {
      const cards = Array.from(document.querySelectorAll(sel));
      if (cards.length === 0) continue;
      const maxCards = Math.min(cards.length, 20);

      for (let i = 0; i < maxCards; i++) {
        const card = cards[i];
        const cardText = normLower((card as HTMLElement).innerText || card.textContent || '');
        const titleEl = card.querySelector('h2, a[title], .poly-component__title, .ui-search-item__title') as HTMLElement | null;
        const title = normalize(titleEl?.innerText || titleEl?.textContent || '');
        const price = getPriceFromCard(card);
        if (price === null) continue;

        // Ignora itens internacionais
        if (cardText.includes('internacional')) continue;

        // Evita falsos positivos absurdos (ex.: capa de console para um console)
        const priceRatio = samsPrice > 0 ? price / samsPrice : 1;
        if (priceRatio < 0.18) continue;

        // Relevância textual mínima com o produto buscado
        const titleTokens = tokenSet(title || cardText);
        const rel = overlapRatio(queryTokens, titleTokens);
        if (rel < 0.35) continue;

        return { price, reason: `card_${i + 1}_selected_rel_${rel.toFixed(2)}_ratio_${priceRatio.toFixed(2)}` };
      }
    }

    // Se chegamos aqui, provavelmente mudou layout ou foi bloqueado
    return { price: null, reason: 'no_candidate_after_filters' };
  }, { query, samsPrice });

  const price =
    result && typeof result.price === 'number' && Number.isFinite(result.price) ? result.price : null;
  const reason = (result && result.reason) ? String(result.reason) : 'unknown';

  return { price, reason };
}

async function fetchFirstMercadoLivrePriceByHtml(
  query: string,
  linkML: string,
): Promise<{ price: number | null; reason: string }> {
  try {
    const url = linkML || `https://lista.mercadolivre.com.br/${encodeURIComponent(query)}_OrderId_PRICE_NoIndex_True`;
    const res = await withTimeout(
      fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        cache: 'no-store',
      }),
      20000,
      'ml_html_fetch',
    );

    if (!res.ok) {
      return { price: null, reason: `ml_html_http_${res.status}` };
    }

    const html = await withTimeout(res.text(), 15000, 'ml_html_text');
    const lower = html.toLowerCase();

    if (lower.includes('para continuar, acesse sua conta')) {
      return { price: null, reason: 'ml_requires_login' };
    }
    if (lower.includes('captcha') || lower.includes('verificar') || lower.includes('seguran')) {
      return { price: null, reason: 'ml_html_captcha_or_verification' };
    }

    // 1) Tenta JSON-LD (mais estável)
    const jsonLdBlocks = Array.from(
      html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi),
    )
      .map((m) => m[1]?.trim())
      .filter(Boolean);

    for (const raw of jsonLdBlocks) {
      try {
        const parsed = JSON.parse(raw as string);
        const nodes = Array.isArray(parsed) ? parsed : [parsed];
        for (const node of nodes) {
          if (node?.itemListElement && Array.isArray(node.itemListElement) && node.itemListElement.length > 0) {
            const first = node.itemListElement[0];
            const offerPrice = first?.item?.offers?.price ?? first?.offers?.price;
            const n = typeof offerPrice === 'string' || typeof offerPrice === 'number'
              ? Number(String(offerPrice).replace(',', '.'))
              : NaN;
            if (Number.isFinite(n)) {
              return { price: n, reason: 'ml_html_jsonld_itemlist' };
            }
          }
        }
      } catch {
        // ignora bloco JSON-LD inválido
      }
    }

    // 2) Tenta classe de preço do card
    const fractionMatch = html.match(/andes-money-amount__fraction[^>]*>\s*([\d\.]+)\s*</i);
    if (fractionMatch) {
      const fraction = Number((fractionMatch[1] || '').replace(/\./g, ''));
      const centsMatch = html.match(/andes-money-amount__cents[^>]*>\s*(\d{1,2})\s*</i);
      const cents = centsMatch ? Number(centsMatch[1]) : 0;
      if (Number.isFinite(fraction) && Number.isFinite(cents)) {
        return { price: Number((fraction + cents / 100).toFixed(2)), reason: 'ml_html_fraction_cents' };
      }
    }

    // 3) Fallback textual: primeiro "R$ 1.234,56" do documento
    const textual = html.match(/R\$\s*([\d\.]+,\d{2}|[\d\.]+)/i);
    if (textual) {
      const normalized = (textual[1] || '').replace(/\./g, '').replace(',', '.');
      const n = Number(normalized);
      if (Number.isFinite(n)) {
        return { price: n, reason: 'ml_html_textual_first_price' };
      }
    }

    return { price: null, reason: 'ml_html_price_not_found' };
  } catch (e: any) {
    return { price: null, reason: `ml_html_error_${e?.message || 'unknown'}` };
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;

  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      results[idx] = await mapper(items[idx], idx);
    }
  });

  await Promise.all(workers);
  return results;
}

export async function POST(req: Request) {
  let browser;
  try {
    const { url } = await req.json();
    const hasMlSession = await fileExists(ML_STORAGE_STATE_PATH);

    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    // Launch browser
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      ...(hasMlSession ? { storageState: ML_STORAGE_STATE_PATH } : {}),
    });

    if (hasMlSession) {
      console.log(`[ML] Sessão carregada de ${ML_STORAGE_STATE_PATH}`);
    } else {
      console.log('[ML] Sessão não encontrada. Rode "npm run ml:login" para habilitar extração do Mercado Livre.');
    }

    const page = await context.newPage();
    
    // 1. Acessa a página normalmente para a VTEX inicializar a sessão padrão
    console.log(`Acessando a URL fornecida: ${url}`);
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(3000);

    // 2. Força a regionalização usando a API oficial da VTEX + Cookies + LocalStorage
    console.log('Aplicando regionalização (API de Sessão + Cookie + LocalStorage)...');
    
    const segmentValue = 'eyJjYW1wYWlnbnMiOm51bGwsImNoYW5uZWwiOiIxIiwicHJpY2VUYWJsZXMiOm51bGwsInJlZ2lvbklkIjoiVTFjamMyRnRjMk5zZFdJME5qYzRPM05oYlhOamJIVmlOakExT0E9PSIsInV0bV9jYW1wYWlnbiI6bnVsbCwidXRtX3NvdXJjZSI6bnVsbCwidXRtaV9jYW1wYWlnbiI6bnVsbCwiY3VycmVuY3lDb2RlIjoiQlJMIiwiY3VycmVuY3lTeW1ib2wiOiJSJCIsImNvdW50cnlDb2RlIjoiQlJBIiwiY3VsdHVyZUluZm8iOiJwdC1CUiIsImNoYW5uZWxQcml2YWN5IjoicHVibGljIn0';
    const regionId = "U1cjc2Ftc2NsdWI0Njc4O3NhbXNjbHViNjA1OA==";

    await context.addCookies([
      { name: 'vtex_segment', value: segmentValue, domain: '.samsclub.com.br', path: '/' },
      { name: 'vtex_segment', value: segmentValue, domain: 'www.samsclub.com.br', path: '/' }
    ]);

    await page.evaluate(async (data) => {
      window.localStorage.setItem('vtex_segment', data.segmentValue);
      try {
        await fetch('/api/sessions/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            public: {
              regionId: { value: data.regionId }
            }
          })
        });
      } catch (e) {
        console.error('Erro na API de sessions:', e);
      }
    }, { segmentValue, regionId });

    // 3. Recarrega a página para que a VTEX consuma a nova sessão
    console.log('Recarregando a página com a nova localidade...');
    await page.reload({ waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(5000);

    // --- Extração da Localidade (Validação do Cookie) ---
    let locationText = 'Localidade não identificada';
    try {
      console.log('Extraindo localidade do cabeçalho...');
      locationText = await page.evaluate(() => {
        const elements = Array.from(document.querySelectorAll('*'));
        let bestMatch = '';
        for (const el of elements) {
          const hasDirectText = Array.from(el.childNodes).some(
            node => node.nodeType === Node.TEXT_NODE && (node.textContent?.trim().length || 0) > 0
          );
          if (!hasDirectText) continue;
          const text = el.textContent?.replace(/\s+/g, ' ').trim() || '';
          if (text.toLowerCase().includes("sam's club") && text.length < 60) {
            const rect = el.getBoundingClientRect();
            if (rect.top >= 0 && rect.top < 300 && rect.width > 0 && rect.height > 0) {
              if (!bestMatch || text.length < bestMatch.length) {
                bestMatch = text;
              }
            }
          }
        }
        return bestMatch || 'Localidade não encontrada no topo da página';
      });
      console.log(`Localidade detectada: ${locationText}`);
    } catch (e) {
      console.error('Erro ao extrair localidade:', e);
    }

    // --- Lógica de Paginação (Clicar em "Ver Mais") ---
    console.log('Iniciando carregamento de todas as páginas...');
    let hasMore = true;
    let clickCount = 0;
    const maxClicks = 100;

    while (hasMore && clickCount < maxClicks) {
      let foundButton = false;
      for (let i = 0; i < 15; i++) {
        await page.evaluate(() => window.scrollBy(0, 800));
        await page.waitForTimeout(1000);

        foundButton = await page.evaluate(() => {
          const elements = Array.from(document.querySelectorAll('button, a, div'));
          const btn = elements.find(el => {
            const htmlEl = el as HTMLElement;
            if (htmlEl.clientHeight > 150 || htmlEl.clientWidth > 800) return false;
            const text = (htmlEl.innerText || htmlEl.textContent || '').toLowerCase().replace(/\s+/g, ' ').trim();
            return (text.includes('mostrar mais') || text.includes('ver mais') || text.includes('carregar mais')) 
                   && htmlEl.offsetParent !== null;
          });
          if (btn) {
            btn.scrollIntoView({ block: 'center' });
            return true;
          }
          return false;
        });
        if (foundButton) break;
      }

      if (foundButton) {
        console.log(`Clicando no botão "Ver Mais" (Clique #${clickCount + 1})...`);
        try {
          await page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('button, a, div'));
            const btn = elements.find(el => {
              const htmlEl = el as HTMLElement;
              if (htmlEl.clientHeight > 150 || htmlEl.clientWidth > 800) return false;
              const text = (htmlEl.innerText || htmlEl.textContent || '').toLowerCase().replace(/\s+/g, ' ').trim();
              return (text.includes('mostrar mais') || text.includes('ver mais') || text.includes('carregar mais')) 
                     && htmlEl.offsetParent !== null;
            }) as HTMLElement;
            if (btn) btn.click();
          });
          clickCount++;
          await page.waitForTimeout(5000); 
          const progress = await page.evaluate(() => {
            const els = Array.from(document.querySelectorAll('span, div'));
            const progEl = els.find(e => {
              const htmlEl = e as HTMLElement;
              if (htmlEl.clientHeight > 100) return false;
              const t = (htmlEl.innerText || '').toLowerCase().replace(/\s+/g, ' ').trim();
              return t.includes('mostrando') && t.includes('de');
            });
            return progEl ? (progEl as HTMLElement).innerText.replace(/\n/g, ' ').trim() : '';
          });
          if (progress) console.log(`Progresso atual: ${progress}`);
        } catch (e) {
          console.log('Erro ao clicar no botão:', e);
          await page.waitForTimeout(2000);
        }
      } else {
        console.log('Botão "Ver Mais" não encontrado após scroll. Fim da listagem alcançado.');
        hasMore = false;
      }
    }

    // --- Scroll Final para Lazy Loading ---
    console.log('Fazendo scroll final para garantir renderização de todos os itens...');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1000);
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        let totalHeight = 0;
        const distance = 600;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;
          if (totalHeight >= scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 300);
      });
    });

    await page.waitForTimeout(5000);

    // Extraction: Adicionando a lógica do link ML
    console.log('[VTEX] Extraindo lista de produtos da página...');
    const finalProducts = await page.evaluate(() => {
      const items = document.querySelectorAll('[class*="vtex-product-summary-2-x-container"]');
      const results: any[] = [];

      items.forEach((item) => {
        const nameElement = item.querySelector('[class*="brandName"]') as HTMLElement;
        const name = nameElement ? nameElement.innerText.trim() : '';

        const linkElement = item.querySelector('a') as HTMLAnchorElement;
        const link = linkElement ? linkElement.href : '';

        let price = '';
        const showcasePrice = item.querySelector('[class*="vtex-productShowCasePrice"]') as HTMLElement;
        
        if (showcasePrice && showcasePrice.innerText) {
          price = showcasePrice.innerText;
        } else {
          const allElements = item.querySelectorAll('span, div');
          for (const el of Array.from(allElements)) {
            const htmlEl = el as HTMLElement;
            const text = htmlEl.innerText || htmlEl.textContent || '';
            const className = htmlEl.className || '';
            if (
              text.includes('R$') && 
              typeof className === 'string' && 
              !className.toLowerCase().includes('listprice')
            ) {
              price = text;
              break;
            }
          }
        }

        if (price) {
          const match = price.match(/R\$\s*([\d\.,]+)/);
          if (match) {
            price = match[1].replace(/\./g, '').trim();
          } else {
            price = price.replace(/R\$\s?/g, '').replace(/\./g, '').replace(/\s/g, '').replace(/\n/g, '').trim();
          }
        }

        if (name && price) {
          // --- LÓGICA DE GERAÇÃO DO LINK ML ---
          const queryML = encodeURIComponent(name);
          const linkML = `https://lista.mercadolivre.com.br/${queryML}_OrderId_PRICE_NoIndex_True`;
          
          results.push({
            produto: name,
            valor: `R$ ${price}`,
            link: link,
            linkML: linkML, // Novo campo
            precoML: '---',  // Inicializado para a tabela
            diferenca: '---', // Inicializado para a tabela
            variacao: '---'   // Inicializado para a tabela
          });
        }
      });

      return results;
    });
    console.log(`[VTEX] Produtos extraídos (com duplicados): ${finalProducts.length}`);

    const uniqueProductsMap = new Map();
    for (const p of finalProducts) {
      if (!uniqueProductsMap.has(p.link)) {
        uniqueProductsMap.set(p.link, p);
      }
    }

    const uniqueProducts = Array.from(uniqueProductsMap.values());
    console.log(`[VTEX] Produtos únicos para comparar: ${uniqueProducts.length}`);

    console.log(`[ML] Enriquecendo ${uniqueProducts.length} itens no Mercado Livre...`);
    const total = uniqueProducts.length;
    let mlBlockedByLogin = !hasMlSession;

    const enriched = await mapWithConcurrency(uniqueProducts, 1, async (p, idx) => {
      if (mlBlockedByLogin) {
        return {
          ...p,
          precoML: '---',
          diferenca: '---',
          variacao: '---',
          isLucro: false,
        };
      }

      const samsPrice = parseBRLToNumber(p.valor);
      if (!p.linkML || samsPrice === null) {
        return { ...p, isLucro: false };
      }

      let mlPrice: number | null = null;
      let mlReason: string | null = null;
      const startedAt = Date.now();

      console.log(`[ML] (${idx + 1}/${total}) ${p.produto}`);

      try {
        // Sem sessão válida do ML, evita desperdiçar minutos em 145 tentativas.
        if (!hasMlSession) {
          mlReason = 'ml_session_missing_run_npm_run_ml_login';
        } else {
          const mlPage = await context.newPage();
          mlPage.setDefaultTimeout(20000);

          await withTimeout(
            mlPage.goto(p.linkML, { waitUntil: 'networkidle', timeout: 35000 }),
            40000,
            'ml_goto',
          );

          const extracted = await withTimeout(fetchFirstMercadoLivrePrice(mlPage, p.produto, samsPrice), 18000, 'ml_extract');
          mlPrice = extracted.price;
          mlReason = extracted.reason;
          await mlPage.close().catch(() => null);

          if (mlReason === 'ml_requires_login') {
            mlBlockedByLogin = true;
            console.log(
              '[ML] Sessão inválida/expirada: Mercado Livre pediu login. Rode "npm run ml:login" novamente.',
            );
          }
        }
      } catch (e) {
        console.log('Falha ao buscar preço no ML:', p.linkML, e);
      }

      if (mlPrice === null) {
        console.log(
          `[ML] (${idx + 1}/${total}) SEM PRECO -> ${mlReason || 'unknown'} (elapsed ${Date.now() - startedAt}ms)`
        );
        return { ...p, isLucro: false };
      }

      const diff = mlPrice - samsPrice;
      const variacao = samsPrice > 0 ? (diff / samsPrice) * 100 : null;

      console.log(
        `[ML] (${idx + 1}/${total}) OK preco=${formatBRL(mlPrice)} diff=${formatBRL(diff)} var=${
          variacao === null ? '---' : `${variacao.toFixed(2)}%`
        } reason=${mlReason || 'unknown'} (elapsed ${Date.now() - startedAt}ms)`
      );

      return {
        ...p,
        precoML: formatBRL(mlPrice),
        diferenca: formatBRL(diff),
        variacao: variacao === null ? '---' : `${variacao.toFixed(2)}%`,
        isLucro: diff > 0,
      };
    });

    return NextResponse.json({ data: enriched, location: locationText });
  } catch (error: any) {
    console.error('Scraping error:', error);
    return NextResponse.json({ error: error.message || 'Failed to scrape data' }, { status: 500 });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}