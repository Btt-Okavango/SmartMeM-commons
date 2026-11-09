import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const validator = join(root, 'scripts', 'validate.mjs');

function run(file) {
  return spawnSync(process.execPath, [validator, file], {
    cwd: root,
    encoding: 'utf8',
  });
}

function proposal({ kind = 'protocolo', diff = true, section = true } = {}) {
  const diffBlock = diff
    ? '\n## Diff\n\n```diff\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n```\n'
    : '';
  const how = section ? '## Como aplicar\n\nAplicar via release.\n' : '';
  return `---
id: sa-2026-11-09-999
title: "Teste de protocolo"
kind: ${kind}
scope: global
confidence: alta
evidence: "teste automatizado"
depends_on: []
harness: any
proposed_by: teste
created: 2026-11-09
expires: 2026-11-23
---

## Proposta

Mudar algo no protocolo.

## Evidência

Medido em teste automatizado.

${how}
## Risco/reversão

Risco baixo; reverter com a release anterior.
${diffBlock}`;
}

function withTemp(content) {
  const dir = mkdtempSync(join(tmpdir(), 'smartmem-commons-'));
  const file = join(dir, 'sa-2026-11-09-999.md');
  writeFileSync(file, content, 'utf8');
  return { dir, file };
}

test('o exemplo do repositorio passa', () => {
  const result = run('examples/proposal.example.md');
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('protocolo valido com diff passa', () => {
  const fixture = withTemp(proposal());
  try {
    const result = run(fixture.file);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('protocolo sem diff falha', () => {
  const fixture = withTemp(proposal({ diff: false }));
  try {
    const result = run(fixture.file);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /kind=protocolo exige secao ## Diff/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('secao obrigatoria ausente falha', () => {
  const fixture = withTemp(proposal({ section: false }));
  try {
    const result = run(fixture.file);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /secao ## Como aplicar ausente/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('segredo de valor falha', () => {
  const fixture = withTemp(proposal().replace('Medido em teste automatizado.', 'token ghp_abcdefghijklmnopqrstuvwxyz0123456789'));
  try {
    const result = run(fixture.file);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /possivel segredo \(token GitHub\)/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});
