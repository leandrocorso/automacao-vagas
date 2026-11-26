import "dotenv/config";
import nodemailer from "nodemailer";
import {
  listarVagasPendentesEmailTriagem,
  marcarEmailTriagemEnviado,
  VagaRow,
} from "./db.js";

function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function corDaNota(nota: number): string {
  if (nota >= 8) return "#15803d";
  if (nota >= 6) return "#b45309";
  return "#b91c1c";
}

function montarHtmlEmail(vagas: VagaRow[]): string {
  const cardsHtml = vagas
    .map((vaga) => {
      const nota = vaga.nota ?? 0;
      const badgeCor = corDaNota(nota);
      const tipoCandidatura = vaga.easy_apply
        ? '<span style="background:#dbeafe;color:#1e40af;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600;">Easy Apply</span>'
        : '<span style="background:#f3f4f6;color:#374151;padding:2px 8px;border-radius:12px;font-size:12px;">Aplicação Externa</span>';

      const analiseHtml = escaparHtml(vaga.analise_texto ?? "Sem análise.")
        .replace(
          /^(Pontos Fortes:|Pontos Fracos:|Veredito:)$/gm,
          "<strong>$1</strong>"
        )
        .replace(/\n/g, "<br>");

      return `
        <div style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:16px;background:#ffffff;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
            <span style="background:${badgeCor};color:#ffffff;padding:4px 10px;border-radius:6px;font-weight:700;font-size:14px;">
              Nota ${nota.toFixed(1)} / 10
            </span>
            <div>
              <span style="color:#6b7280;font-size:12px;margin-right:6px;">ID #${vaga.id}</span>
              ${tipoCandidatura}
            </div>
          </div>

          <h3 style="margin:6px 0 4px 0;font-size:18px;color:#111827;">
            <a href="${escaparHtml(vaga.url)}" style="color:#2563eb;text-decoration:none;">
              ${escaparHtml(vaga.titulo)}
            </a>
          </h3>
          <p style="margin:0 0 12px 0;color:#4b5563;font-size:14px;font-weight:600;">
            ${escaparHtml(vaga.empresa)}
          </p>

          <div style="font-size:14px;line-height:1.5;color:#1f2937;background:#f9fafb;padding:12px;border-radius:6px;">
            ${analiseHtml}
          </div>

          <p style="margin:12px 0 0 0;font-size:13px;">
            <a href="${escaparHtml(vaga.url)}" style="color:#2563eb;font-weight:600;">
              Abrir vaga no LinkedIn &rarr;
            </a>
          </p>
        </div>
      `;
    })
    .join("\n");

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:720px;margin:0 auto;padding:16px;background:#f3f4f6;">
      <h2 style="margin-top:0;color:#111827;">Triagem de Vagas LinkedIn (${vagas.length} vaga${vagas.length === 1 ? "" : "s"})</h2>
      <p style="color:#4b5563;font-size:14px;">
        Vagas ordenadas da maior para a menor nota de aderência ao perfil:
      </p>
      ${cardsHtml}
    </div>
  `;
}

function montarTextoPlanoEmail(vagas: VagaRow[]): string {
  return vagas
    .map((vaga) => {
      const nota = (vaga.nota ?? 0).toFixed(1);
      const tipo = vaga.easy_apply ? "Easy Apply" : "Aplicação Externa";
      return [
        `==================================================`,
        `[Nota ${nota}/10] [ID #${vaga.id}] ${vaga.titulo} - ${vaga.empresa} (${tipo})`,
        `Link: ${vaga.url}`,
        ``,
        vaga.analise_texto ?? "Sem análise.",
      ].join("\n");
    })
    .join("\n\n");
}

async function enviarEmailTriagem(): Promise<void> {
  const emailUser = process.env.EMAIL_USER?.trim();
  const emailPass = process.env.EMAIL_PASS?.trim();
  const emailTo = process.env.EMAIL_TO?.trim();

  if (!emailUser || !emailPass || !emailTo) {
    throw new Error(
      "Variáveis EMAIL_USER, EMAIL_PASS e EMAIL_TO devem estar definidas no arquivo .env."
    );
  }

  const vagas = listarVagasPendentesEmailTriagem();
  if (vagas.length === 0) {
    console.log(
      "Nenhuma vaga analisada pendente de envio (email_triagem_enviado = 0)."
    );
    return;
  }

  console.log(`Preparando envio de e-mail com ${vagas.length} vaga(s)...`);

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: emailUser,
      pass: emailPass,
    },
  });

  const dataHoje = new Date().toLocaleDateString("pt-BR");
  const melhorNota = (vagas[0]?.nota ?? 0).toFixed(1);

  await transporter.sendMail({
    from: emailUser,
    to: emailTo,
    subject: `[Triagem LinkedIn ${dataHoje}] ${vagas.length} vagas analisadas (Top nota: ${melhorNota})`,
    text: montarTextoPlanoEmail(vagas),
    html: montarHtmlEmail(vagas),
  });

  marcarEmailTriagemEnviado(vagas.map((v) => v.id));
  console.log(
    `E-mail enviado com sucesso para ${emailTo}! ${vagas.length} vaga(s) marcadas com email_triagem_enviado = 1.`
  );
}

enviarEmailTriagem().catch((err) => {
  console.error("Erro ao enviar e-mail de triagem:", err);
  process.exit(1);
});
