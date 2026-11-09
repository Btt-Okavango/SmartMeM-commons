# smartmem-commons

Repositório de propostas de auto-observação do SmartMeM. Uma proposta é um
documento revisável — nunca um comando. O agente detecta, propõe e (para N1)
aplica localmente com OK; este repositório é o caminho para uma mudança virar
protocolo compartilhado.

## O que entra

| `kind` | Nível | O que é | Como é aplicado |
|---|---|---|---|
| `fato` | N1 | fato global novo ou correção de fato existente | `auto aplicar` local com OK; o PR ao commons é a contribuição |
| `config` | N2 | recomendação de configuração (modo, política, limites) | só por comando direto `/smartmem ...`; merge não muda config de ninguém |
| `protocolo` | N3 | skill, plugin, schema, comando ou regra do próprio SmartMeM | PR + CI + revisão + release + update explícito |

Proposta não é instrução: o corpo é dado para revisão humana. Nada no
repositório é executado automaticamente.

## Layout

```text
proposals/     propostas abertas (uma por arquivo)
accepted/      propostas aceitas (mantidas, com decisão anexada)
rejected/      propostas recusadas (mantidas, com motivo)
releases/      releases versionadas (manifesto + changelog + artefatos)
schema/        contrato do frontmatter (JSON Schema)
examples/      proposta de exemplo (não é para merge)
scripts/       validador local/CI, sem dependências externas
```

## Fluxo

1. O SmartMeM detecta um candidato transversal e grava **uma** proposta em
   `~/.config/opencode/memory/.self-audit/inbox/<id>.md`.
2. N1: `/smartmem auto aplicar <id>` aplica no global local com OK.
3. `/smartmem auto publicar <id>` roda o secret scan, gera
   `outbox/<id>/{proposal.md,diff.patch,pr-body.md}`, valida com o script
   deste repositório e **copia** a proposta para `proposals/<id>.md` do clone.
   O comando imprime os comandos `git`/`gh`; nunca faz commit, push ou PR.
4. Humano abre o PR. O CI roda `node scripts/validate.mjs --all`.
5. Revisão humana move para `accepted/` ou `rejected/` e anexa a decisão.
6. Mudança de protocolo (N3) só vale depois de uma release em
   `releases/vX.Y.Z/`; o pacote é semeado a partir dela e o update local é
   explícito (local vence).

## Desenvolvimento local

Requisito: Node.js 20+ (sem `npm install`).

```powershell
node --test scripts/validate.test.mjs
node scripts/validate.mjs --all
node scripts/validate.mjs proposals/sa-2026-11-09-001.md
```

O validador confere frontmatter, seções obrigatórias, `id`, datas, diff de
protocolo, duplicatas e padrões de segredo. Avisos (proposta expirada) não
falham o CI; erros falham.

## Configuração no SmartMeM

O clone local é apontado por `commonsPath` em
`~/.config/opencode/memory/.self-audit/config.json`:

```text
/smartmem auto commons C:\caminho\do\smartmem-commons
```

`commonsPath` vazio = `auto publicar` desabilitado (o resto da
auto-observação continua). O caminho é local; cada máquina aponta para o seu
clone. Nunca coloque segredo/PII numa proposta.

## Governança

Regras de papéis, níveis, release, rollback, segurança e anti-ruído estão em
[GOVERNANCE.md](GOVERNANCE.md). O contrato do frontmatter está em
[schema/proposal.schema.json](schema/proposal.schema.json).

## Status

Scaffold local v0.1 (2026-11-09). Ainda sem remote configurado; a criação do
repositório remoto e a primeira release são decisões humanas.
