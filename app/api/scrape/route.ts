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
    // O regionId foi extraído decodificando o base64 do segmentValue acima
    const regionId = "U1cjc2Ftc2NsdWI0Njc4O3NhbXNjbHViNjA1OA==";

    // A. Atualiza os cookies no contexto do navegador
    await context.addCookies([
      { name: 'vtex_segment', value: segmentValue, domain: '.samsclub.com.br', path: '/' },
      { name: 'vtex_segment', value: segmentValue, domain: 'www.samsclub.com.br', path: '/' }
    ]);

    // B. Executa no contexto da página: LocalStorage + Chamada de API
    await page.evaluate(async (data) => {
      // Força no LocalStorage
      window.localStorage.setItem('vtex_segment', data.segmentValue);
      
      // Chama a API de sessão da VTEX para registrar a região no backend deles
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
          // Apenas elementos que contêm texto direto (ignora containers pais gigantes)
          const hasDirectText = Array.from(el.childNodes).some(
            node => node.nodeType === Node.TEXT_NODE && (node.textContent?.trim().length || 0) > 0
          );
          if (!hasDirectText) continue;

          const text = el.textContent?.replace(/\s+/g, ' ').trim() || '';
          
          // Verifica se o texto contém "Sam's Club" e não é muito longo
          if (text.toLowerCase().includes("sam's club") && text.length < 60) {
            const rect = el.getBoundingClientRect();
            // Garante que o elemento está no topo da página e é visível
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
    // ----------------------------------------------------

    let retries = 0;
    const maxRetries = 3; 
    const maxScrolls = 200; // Safety limit
    let scrollCount = 0;
    const scrollDistance = 500;

    // Scroll to the bottom of the page
    while (retries < maxRetries && scrollCount < maxScrolls) {
      try {
        const previousScrollY = await page.evaluate(() => window.scrollY);
        await page.evaluate((dist) => window.scrollBy(0, dist), scrollDistance);
        
        await page.waitForTimeout(500);
        
        const currentScrollY = await page.evaluate(() => window.scrollY);
        const windowHeight = await page.evaluate(() => window.innerHeight);
        const documentHeight = await page.evaluate(() => document.body.scrollHeight);
        
        if (currentScrollY === previousScrollY || currentScrollY + windowHeight >= documentHeight) {
          retries++;
          // Try a small scroll up to trigger observers
          await page.evaluate(() => window.scrollBy(0, -300));
          await page.waitForTimeout(500);
          await page.evaluate(() => window.scrollBy(0, 500));
          await page.waitForTimeout(500);
        } else {
          retries = 0;
        }
      } catch (err: any) {
        if (err.message.includes('Execution context was destroyed') || err.message.includes('Target closed')) {
          console.warn('Navigation detected during scroll, waiting for page to stabilize...');
          await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
          await page.waitForTimeout(2000);
        } else {
          throw err;
        }
      }
      
      scrollCount++;
    }

    // IMPORTANT: Mandatory 10 seconds delay after scrolling finishes
    await page.waitForTimeout(10000);

    // Extraction: Only after the delay
    const finalProducts = await page.evaluate(() => {
      const items = document.querySelectorAll('[class*="vtex-product-summary-2-x-container"]');
      const results: { produto: string; valor: string; link: string }[] = [];

      items.forEach((item) => {
        // Extract Name using innerText
        const nameElement = item.querySelector('[class*="brandName"]') as HTMLElement;
        const name = nameElement ? nameElement.innerText.trim() : '';

        // Extract Link
        const linkElement = item.querySelector('a') as HTMLAnchorElement;
        const link = linkElement ? linkElement.href : '';

        // Extract Price
        let price = '';
        const showcasePrice = item.querySelector('[class*="vtex-productShowCasePrice"]') as HTMLElement;
        
        if (showcasePrice && showcasePrice.innerText) {
          price = showcasePrice.innerText;
        } else {
          // Fallback: search for R$ ignoring listPrice
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
          // Clean price: remove R$, dots, spaces, newlines. Keep comma.
          // Example: "por R$ 2.299,90" -> "2299,90"
          const match = price.match(/R\$\s*([\d\.,]+)/);
          if (match) {
            price = match[1].replace(/\./g, '').trim();
          } else {
            price = price.replace(/R\$\s?/g, '').replace(/\./g, '').replace(/\s/g, '').replace(/\n/g, '').trim();
          }
        }

        if (name && price) {
          results.push({
            produto: name,
            valor: price,
            link: link,
          });
        }
      });

      return results;
    });

    // Deduplicate by link just in case
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
