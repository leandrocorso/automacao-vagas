import { chromium } from "playwright";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

async function salvarSessao() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("https://www.linkedin.com/login");

  const rl = readline.createInterface({ input, output });
  await rl.question("Faça login no LinkedIn na janela aberta e pressione ENTER aqui...");
  rl.close();

  await context.storageState({ path: "linkedin-auth.json" });
  console.log("Sessão salva em linkedin-auth.json");

  await browser.close();
}

salvarSessao();