import { chromium } from "playwright";
import path from "node:path";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const BROWSER_DATA_DIR = path.resolve(process.cwd(), "browser-data");

async function realizarLoginPersistente(): Promise<void> {
  console.log(`Iniciando navegador com perfil persistente em: ${BROWSER_DATA_DIR}`);

  const context = await chromium.launchPersistentContext(BROWSER_DATA_DIR, {
    headless: false,
    viewport: { width: 1280, height: 800 },
  });

  const rl = readline.createInterface({ input, output });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto("https://www.linkedin.com/login", {
      waitUntil: "domcontentloaded",
    });

    console.log("\n========================================================");
    console.log("1. Faça login manualmente no LinkedIn na janela aberta.");
    console.log("2. Resolva qualquer verificação (2FA/CAPTCHA) se solicitado.");
    console.log("3. Aguarde carregar a página inicial (/feed).");
    console.log("========================================================\n");

    await rl.question(
      "Quando estiver logado no LinkedIn, pressione ENTER aqui para salvar e fechar..."
    );

    const urlAtual = page.url();
    console.log(`URL atual detectada: ${urlAtual}`);
    console.log("Salvando sessão persistente em ./browser-data e fechando navegador...");
  } finally {
    rl.close();
    await context.close();
  }

  console.log("Sessão salva com sucesso!");
}

realizarLoginPersistente().catch((err) => {
  console.error("Erro durante o login persistente:", err);
  process.exit(1);
});
