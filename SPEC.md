# Projeto: Automação de Triagem e Candidatura no LinkedIn

## Stack

- Node.js + TypeScript (`tsx` para execução direta)
- Playwright (automação de navegador com `launchPersistentContext` em `./browser-data`)
- SQLite (`better-sqlite3`, arquivo `vagas.db`)
- Google GenAI SDK (`@google/genai`, modelo `gemini-2.5-flash` com Structured Outputs)
- Nodemailer (envio de e-mails via Gmail com Senha de App)

## Arquitetura Geral (Roadmap Completo)

1. **Login persistente (`src/login.ts`)**: Login manual no LinkedIn salvando sessão em `./browser-data`.
2. **Coleta (`src/coletar.ts`)**: Busca vagas no LinkedIn, deduplica pelo `linkedin_id` (`UNIQUE` no SQLite), captura título, empresa, descrição e flag `easy_apply` na mesma visita. Meta: 20 vagas novas/dia.
3. **Análise e Ranqueamento (`src/analisar.ts`)**: Lê arquivos `.md` do perfil em `./perfil/`, avalia vagas com `nota IS NULL` via API do Gemini, gera nota (0–10), pontos fortes, pontos fracos e veredito, e atualiza o banco (`status = 'ANALISADA'`).
4. **E-mail de Triagem (`src/email.ts`)**: Envia e-mail ordenado por maior nota com links e análises das vagas onde `email_triagem_enviado = 0`.
5. **[Entrega 2] Geração de Material**: Script recebe ID da vaga, usa system prompt da skill `career-assistant` via `@google/genai` + arquivos `./perfil/*.md` para gerar currículo (PDF via Playwright HTML->PDF) e carta de apresentação.
6. **[Entrega 2] Aplicação Assistida**: Playwright abre vaga Easy Apply, anexa PDF, preenche formulários e pausa para revisão humana antes do clique final.
7. **[Entrega 2] Controle de Status**: Atualizar status no banco (`ENVIADA`, `EXTERNA_MANUAL`, `ERRO`) + screenshot em caso de erro.
8. **[Entrega 2] E-mail de Relatório**: Resumo de sucessos e erros das aplicações.

## Escopo Atual: Entrega 1 (Etapas 1 a 4)

Estrutura esperada:

- `perfil/` (arquivos `.md` do currículo)
- `browser-data/` (ignorado no git)
- `src/db.ts` (tabela `vagas` com `id`, `linkedin_id UNIQUE`, `url`, `titulo`, `empresa`, `descricao`, `easy_apply`, `nota`, `analise_texto`, `status`, `email_triagem_enviado`, `criado_em`)
- `src/login.ts`
- `src/coletar.ts`
- `src/analisar.ts`
- `src/email.ts`
- `.env` (`GEMINI_API_KEY`, `LINKEDIN_SEARCH_URL`, `EMAIL_USER`, `EMAIL_PASS`, `EMAIL_TO`)
- `.gitignore` (incluindo `browser-data/`, `vagas.db`, `.env`, `node_modules/`)
