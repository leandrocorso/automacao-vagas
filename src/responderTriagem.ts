import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { GoogleGenAI, Type } from "@google/genai";
import { carregarBasePerfil } from "./perfil.js";

export type TipoCampoFormulario = "text" | "number" | "textarea" | "select" | "radio" | "checkbox";

export interface PerguntaTriagem {
  id: string;
  label: string;
  tipo: TipoCampoFormulario;
  obrigatoria: boolean;
  opcoes?: string[];
}

export interface RespostaTriagem {
  id: string;
  resposta: string;
  confianca: "alta" | "media" | "baixa";
  precisa_revisao: boolean;
  justificativa: string;
}

interface ContextoVaga {
  titulo: string;
  empresa: string;
  descricao: string;
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function responderPerguntasTriagem(
  vaga: ContextoVaga,
  perguntas: PerguntaTriagem[]
): Promise<RespostaTriagem[]> {
  if (perguntas.length === 0) return [];

  const systemPrompt = fs.readFileSync(
    path.resolve("./prompts/career-assistant.md"),
    "utf-8"
  );
  const basePerfil = carregarBasePerfil("./perfil");

  const prompt = `
BASE DE CONHECIMENTO DO CANDIDATO:
${basePerfil}

VAGA:
${vaga.titulo} — ${vaga.empresa}
${vaga.descricao}

PERGUNTAS DO FORMULÁRIO DE TRIAGEM (JSON):
${JSON.stringify(perguntas, null, 2)}

REGRAS DE PREENCHIMENTO:
1. Para campos do tipo "number", retorne APENAS dígitos (ex: "10", "13000"). Nunca inclua texto ou símbolos.
2. Para campos do tipo "select" ou "radio", retorne EXATAMENTE uma das strings listadas em "opcoes".
3. Para campos "textarea" sobre experiências práticas, responda de forma objetiva usando o método STAR (Situação, Tarefa, Ação, Resultado).
4. Para pretensão salarial ou modelo de contratação, use exatamente os valores de Sobre.md.
5. Se a informação não existir nos arquivos do candidato ou envolver dado sensível (documentos, dependentes), deixe "resposta" vazia, marque "confianca": "baixa" e "precisa_revisao": true.
`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: {
      systemInstruction: systemPrompt,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          respostas: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                resposta: { type: Type.STRING },
                confianca: {
                  type: Type.STRING,
                  enum: ["alta", "media", "baixa"],
                },
                precisa_revisao: { type: Type.BOOLEAN },
                justificativa: { type: Type.STRING },
              },
              required: [
                "id",
                "resposta",
                "confianca",
                "precisa_revisao",
                "justificativa",
              ],
            },
          },
        },
        required: ["respostas"],
      },
    },
  });

  if (!response.text) {
    throw new Error("Resposta vazia da API do Gemini ao processar triagem.");
  }

  const parsed = JSON.parse(response.text) as { respostas: RespostaTriagem[] };
  return parsed.respostas;
}