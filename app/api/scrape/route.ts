import { NextResponse } from 'next/server';
import { chromium } from 'playwright';

export async function POST(req: Request) {
  let browser;
  try {
    const { url } = await req.json();

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
    });

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

    const uniqueProductsMap = new Map();
    for (const p of finalProducts) {
      if (!uniqueProductsMap.has(p.link)) {
        uniqueProductsMap.set(p.link, p);
      }
    }

    return NextResponse.json({ data: Array.from(uniqueProductsMap.values()), location: locationText });
  } catch (error: any) {
    console.error('Scraping error:', error);
    return NextResponse.json({ error: error.message || 'Failed to scrape data' }, { status: 500 });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}