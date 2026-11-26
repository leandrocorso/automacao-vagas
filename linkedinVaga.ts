import { chromium } from "playwright";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

async function processarVagaLinkedIn(urlVaga: string, curriculoPdfPath?: string) {
  const browser = await chromium.launch({
    headless: false,
    slowMo: 150, // Pequeno atraso entre ações para comportamento mais natural
  });

  // Carrega sua sessão autenticada
  const context = await browser.newContext({
    storageState: "linkedin-auth.json",
  });
  const page = await context.newPage();

  try {
    await page.goto(urlVaga, { waitUntil: "domcontentloaded" });

    // 1. Extrair texto da descrição da vaga para gerar o currículo adaptado
    const descricaoContainer = page.locator(".jobs-description__content, #job-details").first();
    await descricaoContainer.waitFor({ state: "visible", timeout: 10000 });
    const textoVaga = await descricaoContainer.innerText();

    console.log("=== DESCRIÇÃO EXTRAÍDA ===");
    console.log(textoVaga.slice(0, 500) + "...\n");

    // Aqui você integra com seus arquivos .md / IA e aguarda sua aprovação do currículo
    const rl = readline.createInterface({ input, output });
    await rl.question(
      "Gere e revise seu currículo adaptado. Pressione ENTER para abrir a candidatura..."
    );

    // 2. Clicar no botão de Candidatura Simplificada (Easy Apply)
    const botaoCandidatura = page
      .getByRole("button", { name: /candidatura simplificada|easy apply/i })
      .first();

    if (!(await botaoCandidatura.isVisible())) {
      console.log("Esta vaga não usa Candidatura Simplificada (redireciona para site externo).");
      rl.close();
      return;
    }

    await botaoCandidatura.click();

    // 3. Se houver upload de currículo no modal, anexa o arquivo gerado
    const modal = page.getByRole("dialog");
    await modal.waitFor({ state: "visible" });

    const inputArquivo = modal.locator("input[type='file']");
    if (curriculoPdfPath && (await inputArquivo.count()) > 0) {
      await inputArquivo.first().setInputFiles(curriculoPdfPath);
      console.log("Currículo anexado no modal.");
    }

    // 4. Pausa final para você avançar as perguntas adicionais e revisar antes do envio
    await rl.question(
      "Revise os dados no modal do LinkedIn e finalize manualmente. Pressione ENTER para encerrar o script..."
    );
    rl.close();
  } finally {
    await browser.close();
  }
}

processarVagaLinkedIn("https://www.linkedin.com/jobs/view/SEU_ID_DA_VAGA/");