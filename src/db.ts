import Database from "better-sqlite3";
import path from "node:path";

const DB_PATH = path.resolve(process.cwd(), "vagas.db");

export const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS vagas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    linkedin_id TEXT NOT NULL UNIQUE,
    url TEXT NOT NULL,
    titulo TEXT NOT NULL,
    empresa TEXT NOT NULL,
    descricao TEXT NOT NULL,
    easy_apply INTEGER NOT NULL DEFAULT 0,
    nota REAL,
    analise_texto TEXT,
    status TEXT NOT NULL DEFAULT 'COLETADA',
    email_triagem_enviado INTEGER NOT NULL DEFAULT 0,
    criado_em TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
`);

export type StatusVaga =
  | "COLETADA"
  | "ANALISADA"
  | "ENVIADA"
  | "EXTERNA_MANUAL"
  | "ERRO";

export interface VagaRow {
  id: number;
  linkedin_id: string;
  url: string;
  titulo: string;
  empresa: string;
  descricao: string;
  easy_apply: number;
  nota: number | null;
  analise_texto: string | null;
  status: StatusVaga;
  email_triagem_enviado: number;
  criado_em: string;
}

export interface NovaVagaInput {
  linkedin_id: string;
  url: string;
  titulo: string;
  empresa: string;
  descricao: string;
  easy_apply: boolean;
}

const stmtExiste = db.prepare<[string], { existe: number }>(
  "SELECT 1 AS existe FROM vagas WHERE linkedin_id = ? LIMIT 1"
);

const stmtInserir = db.prepare(`
  INSERT OR IGNORE INTO vagas (
    linkedin_id,
    url,
    titulo,
    empresa,
    descricao,
    easy_apply,
    status
  ) VALUES (
    @linkedin_id,
    @url,
    @titulo,
    @empresa,
    @descricao,
    @easy_apply,
    'COLETADA'
  )
`);

const stmtPendentesAnalise = db.prepare<[], VagaRow>(
  "SELECT * FROM vagas WHERE nota IS NULL ORDER BY id ASC"
);

const stmtSalvarAnalise = db.prepare<[number, string, number]>(`
  UPDATE vagas
  SET nota = ?,
      analise_texto = ?,
      status = 'ANALISADA'
  WHERE id = ?
`);

const stmtPendentesEmail = db.prepare<[], VagaRow>(`
  SELECT * FROM vagas
  WHERE nota IS NOT NULL
    AND email_triagem_enviado = 0
  ORDER BY nota DESC, id ASC
`);

const stmtMarcarEmail = db.prepare<[number]>(
  "UPDATE vagas SET email_triagem_enviado = 1 WHERE id = ?"
);

export function vagaExistePorLinkedinId(linkedinId: string): boolean {
  return Boolean(stmtExiste.get(linkedinId));
}

export function inserirVaga(vaga: NovaVagaInput): boolean {
  const info = stmtInserir.run({
    linkedin_id: vaga.linkedin_id,
    url: vaga.url,
    titulo: vaga.titulo,
    empresa: vaga.empresa,
    descricao: vaga.descricao,
    easy_apply: vaga.easy_apply ? 1 : 0,
  });
  return info.changes > 0;
}

export function listarVagasPendentesAnalise(): VagaRow[] {
  return stmtPendentesAnalise.all();
}

export function salvarAnaliseVaga(
  id: number,
  nota: number,
  analiseTexto: string
): void {
  stmtSalvarAnalise.run(nota, analiseTexto, id);
}

export function listarVagasPendentesEmailTriagem(): VagaRow[] {
  return stmtPendentesEmail.all();
}

export const marcarEmailTriagemEnviado = db.transaction((ids: number[]) => {
  for (const id of ids) {
    stmtMarcarEmail.run(id);
  }
});
