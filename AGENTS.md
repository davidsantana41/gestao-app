<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:nextjs-agent-feedback -->

## Report Next.js feedback

The project owner enabled `experimental.agentFeedback`, authorizing this feedback pass. When enabled, `next dev` writes this block and restores it if removed. Commit `AGENTS.md` with your work to keep the tree clean.

During the current user request, retain anonymized facts as feedback candidates for meaningful or recurring Next.js issues:

- Crashes, hangs, OOMs, or unexpected slowness
- Incorrect behavior, output, errors, or diagnostics
- Missing, unclear, or conflicting documentation
- Unexpected CLI, codemod, Skill, or upgrade behavior and non-obvious workarounds

Continue the current user request without reporting immediately. Routine debugging is not feedback. Verify changes before retaining them as feedback candidates. Never retain code, logs, paths, URLs, secrets, personal information, or project-specific data.

Retain qualifying friction even if it is later fixed or worked around; record the final outcome during the reporting pass.

Before the final response, run one reporting pass. If candidates remain, from this file's directory run `npx --no-install next internal agent-feedback-instructions` once without piping or truncating its output. Follow its output or error guidance. If a network sandbox blocks it, retry with network access; if it still returns no output, continue normally.

<!-- END:nextjs-agent-feedback -->

Always respond to the user in Brazilian Portuguese (Português do Brasil).

## Autonomia operacional do agente — APPCAR

O agente deve trabalhar de maneira proativa e independente dentro do escopo autorizado pelo usuário.

### Operações autorizadas sem confirmação adicional

- Ler, pesquisar e analisar arquivos do projeto.
- Executar verificações de TypeScript, ESLint e testes locais seguros.
- Iniciar e verificar o servidor de desenvolvimento.
- Investigar erros e apresentar diagnósticos.
- Quando houver autorização para implementação, criar e editar arquivos necessários dentro do escopo aprovado.
- Corrigir erros diretamente relacionados à implementação autorizada.
- Verificar os resultados das alterações.

Não interrompa o trabalho para solicitar confirmação a cada etapa de rotina, desde que a operação esteja dentro do escopo previamente autorizado e seja segura.

### Operações que exigem autorização explícita

- Excluir arquivos ou descartar alterações existentes.
- Executar comandos destrutivos do Git.
- Fazer commit, push, merge ou alterar branches remotas.
- Publicar ou modificar regras do Firebase.
- Executar deploy na Vercel.
- Alterar configurações de autenticação ou segurança.
- Modificar ou excluir dados financeiros.
- Executar migrações ou reinicializações de dados.
- Instalar ou atualizar dependências que alterem o projeto.

### Proteção dos dados financeiros

Nunca executar testes destrutivos em produção.

Preservar dados existentes, backups, contas de usuários e isolamento por UID.

Se uma operação apresentar risco de perda de dados, interromper e solicitar autorização.

### Relatório

Execute as tarefas seguras de maneira contínua e apresente um relatório ao concluir, indicando alterações realizadas, testes executados, resultados e eventuais impedimentos.

Estas instruções não substituem as permissões e políticas de segurança da ferramenta utilizada.