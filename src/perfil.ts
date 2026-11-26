import * as fs from "node:fs";
import * as path from "node:path";

function listarArquivosMd(dirBase: string, dirAtual = dirBase): string[] {
  const entradas = fs.readdirSync(dirAtual, { withFileTypes: true });
  const arquivos: string[] = [];

  for (const entrada of entradas) {
    const caminhoCompleto = path.join(dirAtual, entrada.name);
    if (entrada.isDirectory()) {
      arquivos.push(...listarArquivosMd(dirBase, caminhoCompleto));
    } else if (entrada.isFile() && entrada.name.endsWith(".md")) {
      arquivos.push(caminhoCompleto);
    }
  }

  return arquivos;
}

export function carregarBasePerfil(pastaPerfil = "./perfil"): string {
  const dirAbsoluto = path.resolve(pastaPerfil);
  const arquivos = listarArquivosMd(dirAbsoluto);

  if (arquivos.length === 0) {
    throw new Error(`Nenhum arquivo .md encontrado em ${dirAbsoluto}`);
  }

  return arquivos
    .map((caminho) => {
      const relativo = path.relative(dirAbsoluto, caminho).replace(/\\/g, "/");
      const conteudo = fs.readFileSync(caminho, "utf-8");
      return `=== ARQUIVO: ${relativo} ===\n${conteudo}`;
    })
    .join("\n\n");
}