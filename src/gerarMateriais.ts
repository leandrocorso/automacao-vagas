import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { GoogleGenAI, Type } from "@google/genai";
import { marked } from "marked";
import { chromium } from "playwright";
import {db} from "./db.js";
import { carregarBasePerfil } from "./perfil.js";

interface VagaRow {
  id: number;
  linkedin_id: string;
  url: string;
  titulo: string;
  empresa: string;
  descricao: string;
}

interface PacoteCandidatura {
  curriculo_md: string;
  carta_apresentacao_md: string;
  resposta_recrutador_md: string;
  resumo_adaptacoes: string[];
  lacunas_identificadas: string[];
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

function gerarSlug(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function gerarPdfAts(markdown: string, caminhoPdf: string): Promise<void> {
  const htmlCorpo = await marked.parse(markdown);
  const htmlCompleto = `
    <!DOCTYPE html>
    <html lang="pt-BR">
      <head>
        <meta charset="UTF-8" />
        <style>
          body {
            font-family: Arial, Helvetica, sans-serif;
            font-size: 10.5pt;
            line-height: 1.4;
            color: #111;
            margin: 0;
          }
          h1 { font-size: 16pt; margin: 0 0 4px 0; }
          h2 { font-size: 12pt; border-bottom: 1px solid #333; padding-bottom: 2px; margin: 14px 0 6px 0; }
          h3 { font-size: 10.5pt; margin: 10px 0 2px 0; }
          p, li { margin: 3px 0; }
          ul { padding-left: 18px; margin: 4px 0; }
        </style>
      </head>
      <body>${htmlCorpo}</body>
    </html>
  `;

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(htmlCompleto, { waitUntil: "networkidle" });
    await page.pdf({
      path: caminhoPdf,
      format: "A4",
      margin: { top: "14mm", right: "14mm", bottom: "14mm", left: "14mm" },
      printBackground: false,
    });
  } finally {
    await browser.close();
  }
}

async function gerarMaterial(linkedinId: string): Promise<void> {
  const vaga = db
    .prepare("SELECT id, linkedin_id, url, titulo, empresa, descricao FROM vagas WHERE linkedin_id = ?")
    .get(linkedinId) as VagaRow | undefined;

  if (!vaga) {
    throw new Error(`Vaga com linkedin_id=${linkedinId} não encontrada no banco.`);
  }

  const systemPrompt = fs.readFileSync(path.resolve("./prompts/career-assistant.md"), "utf-8");
  const basePerfil = carregarBasePerfil("./perfil");

  console.log(`Gerando pacote para: ${vaga.titulo} — ${vaga.empresa}...`);

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: `
BASE DE CONHECIMENTO DO CANDIDATO:
${basePerfil}

VAGA ALVO:
Título: ${vaga.titulo}
Empresa: ${vaga.empresa}
URL: ${vaga.url}

Descrição:
${vaga.descricao}

Gere o pacote completo de candidatura seguindo rigorosamente as instruções do sistema.
    `,
    config: {
      systemInstruction: systemPrompt,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          curriculo_md: { type: Type.STRING },
          carta_apresentacao_md: { type: Type.STRING },
          resposta_recrutador_md: { type: Type.STRING },
          resumo_adaptacoes: { type: Type.ARRAY, items: { type: Type.STRING } },
          lacunas_identificadas: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: [
          "curriculo_md",
          "carta_apresentacao_md",
          "resposta_recrutador_md",
          "resumo_adaptacoes",
          "lacunas_identificadas",
        ],
      },
    },
  });

  if (!response.text) {
    throw new Error("Resposta vazia da API do Gemini.");
  }

  const pacote = JSON.parse(response.text) as PacoteCandidatura;

  const pastaSaida = path.resolve(
    `./vagas/${gerarSlug(vaga.empresa)}-${vaga.linkedin_id}`
  );
  fs.mkdirSync(pastaSaida, { recursive: true });

  fs.writeFileSync(
    path.join(pastaSaida, "vaga.md"),
    `# ${vaga.titulo} — ${vaga.empresa}\n\nURL: ${vaga.url}\n\n${vaga.descricao}`
  );
  fs.writeFileSync(path.join(pastaSaida, "curriculo.md"), pacote.curriculo_md);
  fs.writeFileSync(path.join(pastaSaida, "carta-de-apresentacao.md"), pacote.carta_apresentacao_md);
  fs.writeFileSync(path.join(pastaSaida, "resposta-recrutador.md"), pacote.resposta_recrutador_md);

  const caminhoPdf = path.join(pastaSaida, "curriculo.pdf");
  await gerarPdfAts(pacote.curriculo_md, caminhoPdf);

  db.prepare("UPDATE vagas SET status = 'PRONTA' WHERE id = ?").run(vaga.id);

  console.log(`\nPacote salvo em: ${pastaSaida}`);
  console.log("\n=== RESUMO DAS ADAPTAÇÕES ===");
  pacote.resumo_adaptacoes.forEach((item) => console.log(`- ${item}`));

  if (pacote.lacunas_identificadas.length > 0) {
    console.log("\n=== LACUNAS IDENTIFICADAS ===");
    pacote.lacunas_identificadas.forEach((item) => console.log(`- ${item}`));
  }

  console.log("\nRevise o curriculo.pdf antes de rodar o script de aplicação.");
}

const argVaga = process.argv.find((arg) => arg.startsWith("--vaga="));
const linkedinId = argVaga?.split("=")[1];

if (!linkedinId) {
  console.error("Uso: npx tsx src/gerarMaterial.ts --vaga=<LINKEDIN_ID>");
  process.exit(1);
}

gerarMaterial(linkedinId).catch((err: unknown) => {
  console.error("Erro ao gerar material:", err);
  process.exit(1);
});