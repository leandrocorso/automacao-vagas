import "dotenv/config";
import { chromium, Locator, Page } from "playwright";
import path from "node:path";
import { inserirVaga, vagaExistePorLinkedinId } from "./db.js";

const BROWSER_DATA_DIR = path.resolve(process.cwd(), "browser-data");
const META_VAGAS_NOVAS = 20;
const MAX_PAGINAS = 10;

function extrairLinkedinIdDeTexto(texto: string | null): string | null {
  if (!texto) return null;
  const matchView = texto.match(/\/jobs\/view\/(\d+)/);
  if (matchView?.[1]) return matchView[1];
  const matchParam = texto.match(/currentJobId=(\d+)/);
  if (matchParam?.[1]) return matchParam[1];
  if (/^\d+$/.test(texto.trim())) return texto.trim();
  return null;
}

function limparTextoUnico(texto: string): string {
  const linhas = texto
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (linhas.length === 0) return "";
  // LinkedIn às vezes duplica o título para leitores de tela na segunda linha
  if (linhas.length >= 2 && linhas[0] === linhas[1]) {
    return linhas[0];
  }
  return linhas[0];
}

async function obterTextoPrimeiroSeletor(
  page: Page,
  seletores: string[]
): Promise<string> {
  for (const seletor of seletores) {
    const loc = page.locator(seletor).first();
    if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
      const txt = (await loc.innerText().catch(() => "")).trim();
      if (txt) return limparTextoUnico(txt);
    }
  }
  return "";
}

async function detectarEasyApply(page: Page): Promise<boolean> {
  const seletoresBotao = [
    ".jobs-apply-button--top-card button",
    ".jobs-s-apply button",
    ".jobs-details__main-content button.jobs-apply-button",
    "button.jobs-apply-button",
  ];

  for (const seletor of seletoresBotao) {
    const botoes = page.locator(seletor);
    const total = await botoes.count();
    for (let i = 0; i < total; i++) {
      const botao = botoes.nth(i);
      if (!(await botao.isVisible().catch(() => false))) continue;
      const texto = (await botao.innerText().catch(() => "")).toLowerCase();
      const aria = ((await botao.getAttribute("aria-label")) ?? "").toLowerCase();
      if (
        /candidatura simplificada|easy apply/i.test(texto) ||
        /candidatura simplificada|easy apply/i.test(aria)
      ) {
        return true;
      }
    }
  }

  const porRole = page
    .locator(".jobs-details__main-content, .jobs-search__job-details--container, main")
    .getByRole("button", { name: /candidatura simplificada|easy apply/i })
    .first();

  return await porRole.isVisible().catch(() => false);
}

async function rolarListaDeVagas(page: Page): Promise<void> {
  const containers = [
    ".jobs-search-results-list",
    ".scaffold-layout__list > div",
    ".jobs-search-two-pane__results-list",
  ];

  for (const sel of containers) {
    const container = page.locator(sel).first();
    if ((await container.count()) > 0) {
      for (let step = 0; step < 5; step++) {
        await container
          .evaluate((el) => {
            el.scrollBy(0, 700);
          })
          .catch(() => {});
        await page.waitForTimeout(350);
      }
      return;
    }
  }

  await page.mouse.wheel(0, 2000);
  await page.waitForTimeout(500);
}

async function extrairIdDoCard(card: Locator): Promise<string | null> {
  const attrJobId =
    (await card.getAttribute("data-occludable-job-id")) ??
    (await card.getAttribute("data-job-id"));
  const direto = extrairLinkedinIdDeTexto(attrJobId);
  if (direitoValido(direto)) return direto;

  const innerJobDiv = card.locator("[data-job-id]").first();
  if ((await innerJobDiv.count()) > 0) {
    const idInner = extrairLinkedinIdDeTexto(
      await innerJobDiv.getAttribute("data-job-id")
    );
    if (direitoValido(idInner)) return idInner;
  }

  const link = card.locator("a[href*='/jobs/view/']").first();
  if ((await link.count()) > 0) {
    const href = await link.getAttribute("href");
    const idHref = extrairLinkedinIdDeTexto(href);
    if (direitoValido(idHref)) return idHref;
  }

  return null;
}

function direitoValido(id: string | null): id is string {
  return Boolean(id && /^\d+$/.test(id));
}

function construirUrlPaginada(baseUrl: string, offset: number): string {
  const url = new URL(baseUrl);
  if (offset > 0) {
    url.searchParams.set("start", String(offset));
  } else {
    url.searchParams.delete("start");
  }
  return url.toString();
}

async function coletarVagas(): Promise<void> {
  const searchUrl = process.env.LINKEDIN_SEARCH_URL?.trim();
  if (!searchUrl) {
    throw new Error(
      "Variável LINKEDIN_SEARCH_URL não definida no arquivo .env."
    );
  }

  console.log(`Iniciando coleta de vagas (meta: ${META_VAGAS_NOVAS} vagas novas)...`);

  const context = await chromium.launchPersistentContext(BROWSER_DATA_DIR, {
    headless: false,
    slowMo: 100,
    viewport: { width: 1366, height: 850 },
  });

  let novasSalvas = 0;
  const idsVistosNestaExecucao = new Set<string>();

  try {
    const page = context.pages()[0] ?? (await context.newPage());

    for (
      let paginaIdx = 0;
      paginaIdx < MAX_PAGINAS && novasSalvas < META_VAGAS_NOVAS;
      paginaIdx++
    ) {
      const offset = paginaIdx * 25;
      const urlPagina = construirUrlPaginada(searchUrl, offset);
      console.log(`\n[Página ${paginaIdx + 1}] Acessando: ${urlPagina}`);

      await page.goto(urlPagina, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2500);

      const urlAtual = page.url();
      if (
        urlAtual.includes("/login") ||
        urlAtual.includes("/authwall") ||
        urlAtual.includes("/checkpoint")
      ) {
        throw new Error(
          `Sessão expirada ou bloqueada (${urlAtual}). Execute 'npx tsx src/login.ts' primeiro.`
        );
      }

      await rolarListaDeVagas(page);

      const cards = page.locator(
        "li[data-occludable-job-id], div.job-card-container[data-job-id]"
      );
      const totalCards = await cards.count();

      if (totalCards === 0) {
        console.log("Nenhum card de vaga encontrado nesta página. Encerrando paginação.");
        break;
      }

      console.log(`Encontrados ${totalCards} cards na página ${paginaIdx + 1}.`);
      let novosIdsNaPagina = 0;

      for (let i = 0; i < totalCards && novasSalvas < META_VAGAS_NOVAS; i++) {
        const card = cards.nth(i);
        await card.scrollIntoViewIfNeeded().catch(() => {});

        const linkedinId = await extrairIdDoCard(card);
        if (!linkedinId) continue;

        if (idsVistosNestaExecucao.has(linkedinId)) continue;
        idsVistosNestaExecucao.add(linkedinId);
        novosIdsNaPagina++;

        if (vagaExistePorLinkedinId(linkedinId)) {
          console.log(`  - [${linkedinId}] Já existe no banco, pulando.`);
          continue;
        }

        const urlCanonica = `https://www.linkedin.com/jobs/view/${linkedinId}/`;

        try {
          // Clica no card para carregar os detalhes no painel lateral na mesma visita
          const linkTituloCard = card
            .locator("a.job-card-container__link, a.job-card-list__title--link, a")
            .first();

          if ((await linkTituloCard.count()) > 0) {
            await linkTituloCard.click({ timeout: 5000 });
          } else {
            await card.click({ timeout: 5000 });
          }

          await page.waitForTimeout(1400);

          const descricaoLoc = page
            .locator(
              ".jobs-description__content, #job-details, .jobs-box__html-content"
            )
            .first();
          await descricaoLoc.waitFor({ state: "visible", timeout: 10000 });

          const tituloFallbackCard = limparTextoUnico(
            await linkTituloCard.innerText().catch(() => "")
          );
          const empresaFallbackCard = limparTextoUnico(
            await card
              .locator(
                ".artdeco-entity-lockup__subtitle, .job-card-container__primary-description"
              )
              .first()
              .innerText()
              .catch(() => "")
          );

          const titulo =
            (await obterTextoPrimeiroSeletor(page, [
              ".job-details-jobs-unified-top-card__job-title",
              ".jobs-unified-top-card__job-title",
              ".jobs-details__main-content h1",
              "h1",
            ])) ||
            tituloFallbackCard ||
            "Título não identificado";

          const empresa =
            (await obterTextoPrimeiroSeletor(page, [
              ".job-details-jobs-unified-top-card__company-name",
              ".jobs-unified-top-card__company-name",
            ])) ||
            empresaFallbackCard ||
            "Empresa não identificada";

          const descricao = (await descricaoLoc.innerText()).trim();
          if (!descricao) {
            console.warn(`  ! [${linkedinId}] Descrição vazia, ignorando.`);
            continue;
          }

          const easyApply = await detectarEasyApply(page);

          const inserida = inserirVaga({
            linkedin_id: linkedinId,
            url: urlCanonica,
            titulo,
            empresa,
            descricao,
            easy_apply: easyApply,
          });

          if (inserida) {
            novasSalvas++;
            console.log(
              `  + [${novasSalvas}/${META_VAGAS_NOVAS}] Salva: "${titulo}" @ ${empresa} (${
                easyApply ? "Easy Apply" : "Externa"
              })`
            );
          }

          // Pausa curta entre cliques para manter navegação natural
          await page.waitForTimeout(900 + Math.floor(Math.random() * 700));
        } catch (errCard) {
          console.warn(
            `  ! Erro ao capturar detalhes da vaga ${linkedinId}:`,
            errCard instanceof Error ? errCard.message : errCard
          );
        }
      }

      if (novosIdsNaPagina === 0) {
        console.log("Nenhuma vaga inédita encontrada nesta página. Encerrando busca.");
        break;
      }
    }
  } finally {
    await context.close();
  }

  console.log(`\nColeta concluída! Total de vagas novas salvas hoje: ${novasSalvas}`);
}

coletarVagas().catch((err) => {
  console.error("Erro na coleta de vagas:", err);
  process.exit(1);
});
