const fs = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline');
const { chromium } = require('playwright');

const STORAGE_PATH = path.join(process.cwd(), '.ml-storage-state.json');

function waitEnter(promptText) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(promptText, () => {
      rl.close();
      resolve();
    });
  });
}

async function main() {
  console.log('[ML LOGIN] Abrindo navegador para autenticar no Mercado Livre...');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();

  await page.goto('https://www.mercadolivre.com.br/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log('[ML LOGIN] Faça login manualmente no navegador aberto.');
  console.log('[ML LOGIN] Quando terminar (e ver que está logado), volte aqui e pressione ENTER.');

  await waitEnter('Pressione ENTER para salvar a sessão... ');

  const state = await context.storageState();
  await fs.writeFile(STORAGE_PATH, JSON.stringify(state, null, 2), 'utf8');

  console.log(`[ML LOGIN] Sessão salva em: ${STORAGE_PATH}`);
  await browser.close();
}

main().catch((err) => {
  console.error('[ML LOGIN] Erro:', err);
  process.exit(1);
});
