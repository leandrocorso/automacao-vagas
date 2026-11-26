import "dotenv/config";
import { GoogleGenAI, Type, Schema } from "@google/genai";
import { listarVagasPendentesAnalise, salvarAnaliseVaga, VagaRow } from "./db.js";
import { carregarBasePerfil } from "./perfil.js";

const MODELO_GEMINI = "gemini-2.5-flash";

interface AnaliseEstruturada {
  nota: number;
  pontos_fortes: string[];
  pontos_fracos: string[];
  veredito: string;
}

const analiseSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    nota: {
      type: Type.NUMBER,
      description:
        "Nota de 0 a 10 indicando a aderência do candidato aos requisitos da vaga.",
    },
    pontos_fortes: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description:
        "Lista objetiva de pontos fortes e experiências do perfil alinhados à vaga.",
    },
    pontos_fracos: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description:
        "Lista objetiva de lacunas, requisitos ausentes ou riscos em relação à vaga.",
    },
    veredito: {
      type: Type.STRING,
      description:
        "Recomendação direta sobre valer a pena se candidatar e estratégia sugerida.",
    },
  },
  required: ["nota", "pontos_fortes", "pontos_fracos", "veredito"],
};

function carregarPerfilMarkdown(): string {
  return carregarBasePerfil("./perfil");
}

function formatarAnaliseTexto(analise: AnaliseEstruturada): string {
  const fortes =
    analise.pontos_fortes.length > 0
      ? analise.pontos_fortes.map((p) => `- ${p}`).join("\n")
      : "- Nenhum ponto forte destacado.";

  const fracos =
    analise.pontos_fracos.length > 0
      ? analise.pontos_fracos.map((p) => `- ${p}`).join("\n")
      : "- Nenhuma lacuna relevante identificada.";

  return [
    "Pontos Fortes:",
    fortes,
    "",
    "Pontos Fracos:",
    fracos,
    "",
    "Veredito:",
    analise.veredito.trim(),
  ].join("\n");
}

async function avaliarVagaComGemini(
  ai: GoogleGenAI,
  perfilCompleto: string,
  vaga: VagaRow
): Promise<{ nota: number; analiseTexto: string }> {
  const prompt = `Você é um especialista sênior em recrutamento técnico e triagem de carreira.
Compare o PERFIL DO CANDIDATO com a VAGA abaixo de forma realista, criteriosa e honesta.

=== PERFIL DO CANDIDATO ===
${perfilCompleto}

=== DADOS DA VAGA ===
Título: ${vaga.titulo}
Empresa: ${vaga.empresa}
Modalidade de candidatura: ${vaga.easy_apply ? "Easy Apply (Simplificada)" : "Site Externo"}
URL: ${vaga.url}

Descrição da Vaga:
${vaga.descricao}
`;

  const response = await ai.models.generateContent({
    model: MODELO_GEMINI,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: analiseSchema,
      temperature: 0.2,
    },
  });

  const textoJson = response.text;
  if (!textoJson) {
    throw new Error("Resposta vazia da API do Gemini.");
  }

  const parsed = JSON.parse(textoJson) as AnaliseEstruturada;
  const notaNormalizada = Math.max(
    0,
    Math.min(10, Math.round(Number(parsed.nota) * 10) / 10)
  );

  return {
    nota: notaNormalizada,
    analiseTexto: formatarAnaliseTexto(parsed),
  };
}

async function analisarVagasPendentes(): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Variável GEMINI_API_KEY não definida no arquivo .env.");
  }

  const perfilCompleto = carregarPerfilMarkdown();
  const pendentes = listarVagasPendentesAnalise();

  if (pendentes.length === 0) {
    console.log("Nenhuma vaga pendente de análise (nota IS NULL).");
    return;
  }

  console.log(
    `Iniciando análise de ${pendentes.length} vaga(s) com ${MODELO_GEMINI}...`
  );

  const ai = new GoogleGenAI({ apiKey });
  let analisadasComSucesso = 0;

  for (let i = 0; i < pendentes.length; i++) {
    const vaga = pendentes[i];
    const prefixo = `[${i + 1}/${pendentes.length}]`;

    try {
      const { nota, analiseTexto } = await avaliarVagaComGemini(
        ai,
        perfilCompleto,
        vaga
      );
      salvarAnaliseVaga(vaga.id, nota, analiseTexto);
      analisadasComSucesso++;
      console.log(
        `${prefixo} Nota ${nota.toFixed(1)} | #${vaga.id} "${vaga.titulo}" @ ${vaga.empresa}`
      );
    } catch (err) {
      console.error(
        `${prefixo} Erro ao analisar vaga #${vaga.id} (${vaga.titulo}):`,
        err instanceof Error ? err.message : err
      );
    }
  }

  console.log(
    `\nAnálise finalizada! ${analisadasComSucesso}/${pendentes.length} vaga(s) atualizadas com status = 'ANALISADA'.`
  );
}

analisarVagasPendentes().catch((err) => {
  console.error("Erro na execução da análise:", err);
  process.exit(1);
});
