#!/usr/bin/env node
// Valida propostas e releases do smartmem-commons sem dependencias externas.
//
// Uso:
//   node scripts/validate.mjs --all
//   node scripts/validate.mjs proposals/sa-2026-11-09-001.md
//   node scripts/validate.mjs releases/v2.2.0/release.json
//
// Regras no frontmatter: formato YAML plano (key: value). Arrays usam JSON
// inline: depends_on: [] ou depends_on: ["SM_x.md"]. Strings com dois-pontos
// devem ser JSON: title: "a: b".

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const all = args.length === 0 || args.includes('--all');
const explicit = args.filter((arg) => !arg.startsWith('--'));
const today = new Date().toISOString().slice(0, 10);

const REQUIRED = [
  'id',
  'title',
  'kind',
  'scope',
  'confidence',
  'evidence',
  'depends_on',
  'harness',
  'proposed_by',
  'created',
  'expires',
];
const KIND = new Set(['fato', 'config', 'protocolo']);
const SCOPE = new Set(['global']);
const CONFIDENCE = new Set(['alta', 'media', 'baixa']);
const HARNESS = new Set(['opencode', 'claude-code', 'any']);
const ID_RE = /^sa-\d{4}-\d{2}-\d{2}-\d{3}$/;
const DEPENDS_RE = /^(SM_[a-z0-9-]+\.md|sa-\d{4}-\d{2}-\d{2}-\d{3}|https?:\/\/\S+)$/;

// Padroes de VALOR de credencial/PII, nao de mencao. O scan local do
// `auto publicar` usa o modulo SmartMemSecrets (mais amplo); este e o piso
// que roda no CI sem depender do repo smartdrv1.
const SECRET_PATTERNS = [
  [/\bsk-[A-Za-z0-9]{20,}\b/, 'chave estilo OpenAI'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/, 'token GitHub'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/, 'token GitHub fine-grained'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'chave AWS'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'chave privada'],
  [/:\/\/[^\s:/@]+:[^\s:/@]+@/, 'credencial em URL'],
  [/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/, 'CPF'],
  [/\b(?:\d[ -]?){16}\b/, 'numero de cartao'],
];

function isDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function parseValue(raw) {
  const value = raw.trim();
  if (!value) return '';
  if (value.startsWith('[')) {
    let parsed;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error(`array invalido (use JSON inline): ${value}`);
    }
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
      throw new Error(`array deve conter apenas strings: ${value}`);
    }
    return parsed;
  }
  if (value.startsWith('"')) {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed !== 'string') throw new Error('nao e string');
      return parsed;
    } catch {
      throw new Error(`string JSON invalida: ${value}`);
    }
  }
  if (value.startsWith("'")) {
    if (value.length < 2 || !value.endsWith("'")) {
      throw new Error(`string com aspas simples invalida: ${value}`);
    }
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

function parseFrontmatter(text) {
  const source = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!source.startsWith('---\n')) {
    throw new Error('frontmatter ausente (o arquivo deve comecar com ---)');
  }
  const end = source.indexOf('\n---\n', 4);
  if (end === -1) throw new Error('frontmatter sem linha de fechamento ---');
  const head = source.slice(4, end);
  const body = source.slice(end + 5);
  const data = {};
  for (const line of head.split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const match = line.match(/^([A-Za-z][A-Za-z0-9_]*):(?:[ \t]*(.*))?$/);
    if (!match) throw new Error(`linha invalida no frontmatter: ${line}`);
    const key = match[1];
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      throw new Error(`chave repetida no frontmatter: ${key}`);
    }
    data[key] = parseValue(match[2] ?? '');
  }
  return { data, body };
}

function section(body, names) {
  const lines = body.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index].match(/^##\s+(.+?)\s*$/);
    if (!heading || !names.some((name) => name.test(heading[1]))) continue;
    const content = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (/^##\s+/.test(lines[cursor])) break;
      content.push(lines[cursor]);
    }
    return content.join('\n').trim();
  }
  return null;
}

function scanSecrets(text, errors) {
  for (const [pattern, label] of SECRET_PATTERNS) {
    if (pattern.test(text)) errors.push(`possivel segredo (${label})`);
  }
}

function validateProposal(file, { example = false } = {}) {
  const rel = relative(root, file).replace(/\\/g, '/');
  const errors = [];
  const warnings = [];
  const result = { file: rel, id: null, example, errors, warnings };
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    errors.push(`nao foi possivel ler o arquivo: ${error.message}`);
    return result;
  }

  let data;
  let body;
  try {
    ({ data, body } = parseFrontmatter(text));
  } catch (error) {
    errors.push(error.message);
    return result;
  }

  for (const key of REQUIRED) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) {
      errors.push(`campo obrigatorio ausente: ${key}`);
    }
  }
  for (const key of Object.keys(data)) {
    if (!REQUIRED.includes(key)) errors.push(`campo desconhecido: ${key}`);
  }

  const id = typeof data.id === 'string' ? data.id : '';
  result.id = id || null;
  if (!ID_RE.test(id)) errors.push('id deve casar sa-YYYY-MM-DD-NNN');
  if (!example && basename(file, '.md') !== id) {
    errors.push(`nome do arquivo deve ser ${id || '<id>'}.md`);
  }

  if (typeof data.title !== 'string' || data.title.trim().length < 3) {
    errors.push('title deve ter ao menos 3 caracteres');
  } else if (data.title.length > 120) {
    errors.push('title nao pode passar de 120 caracteres');
  }

  if (!KIND.has(data.kind)) errors.push('kind deve ser fato|config|protocolo');
  if (!SCOPE.has(data.scope)) errors.push('scope deve ser global');
  if (!CONFIDENCE.has(data.confidence)) errors.push('confidence deve ser alta|media|baixa');
  if (!HARNESS.has(data.harness)) errors.push('harness deve ser opencode|claude-code|any');

  if (typeof data.evidence !== 'string' || !data.evidence.trim()) {
    errors.push('evidence nao pode ser vazia');
  } else if (data.evidence.length > 2000) {
    errors.push('evidence nao pode passar de 2000 caracteres');
  }

  if (!Array.isArray(data.depends_on)) {
    errors.push('depends_on deve ser array JSON inline (ex.: [])');
  } else {
    if (data.depends_on.length > 20) errors.push('depends_on nao pode passar de 20 itens');
    if (new Set(data.depends_on).size !== data.depends_on.length) {
      errors.push('depends_on tem item duplicado');
    }
    for (const dependency of data.depends_on) {
      if (!DEPENDS_RE.test(dependency)) {
        errors.push(`depends_on invalido: ${dependency}`);
      }
    }
  }

  if (typeof data.proposed_by !== 'string' || !data.proposed_by.trim()) {
    errors.push('proposed_by nao pode ser vazio');
  } else if (data.proposed_by.length > 80) {
    errors.push('proposed_by nao pode passar de 80 caracteres');
  }

  const created = typeof data.created === 'string' ? data.created : '';
  const expires = typeof data.expires === 'string' ? data.expires : '';
  if (!isDate(created)) errors.push('created deve ser YYYY-MM-DD valido');
  if (!isDate(expires)) errors.push('expires deve ser YYYY-MM-DD valido');
  if (isDate(created) && isDate(expires) && expires < created) {
    errors.push('expires nao pode ser anterior a created');
  }
  if (isDate(created) && created > today) warnings.push('created esta no futuro');
  if (!example && file.includes(`${'proposals'}`) && isDate(expires) && expires < today) {
    warnings.push('proposta expirada; revise ou descarte');
  }

  const requiredSections = [
    ['## Proposta', [/^proposta$/i]],
    ['## Evidencia', [/^evid[eê]ncia$/i]],
    ['## Como aplicar', [/^como aplicar$/i]],
    ['## Risco/reversao', [/^risco(\s+e\s+|\s*\/\s*)revers[aã]o$/i]],
  ];
  for (const [label, names] of requiredSections) {
    const content = section(body, names);
    if (content === null) errors.push(`secao ${label} ausente`);
    else if (content.length < 10) errors.push(`secao ${label} vazia ou curta demais`);
  }

  if (data.kind === 'protocolo') {
    const diff = section(body, [/^diff$/i]);
    if (diff === null) {
      errors.push('kind=protocolo exige secao ## Diff');
    } else {
      const fenced = diff.match(/```diff\s*\n([\s\S]*?)```/i);
      if (!fenced || !fenced[1].trim()) {
        errors.push('## Diff exige bloco ```diff``` com conteudo');
      }
    }
  }

  if (body.length > 32 * 1024) warnings.push('corpo acima de 32 KB; prefira uma mudanca por proposta');
  scanSecrets(text, errors);
  return result;
}

function readAcceptedIds() {
  const ids = new Set();
  const acceptedDir = join(root, 'accepted');
  if (!existsSync(acceptedDir)) return ids;
  for (const name of readdirSync(acceptedDir).filter((entry) => entry.endsWith('.md'))) {
    try {
      const { data } = parseFrontmatter(readFileSync(join(acceptedDir, name), 'utf8'));
      if (typeof data.id === 'string') ids.add(data.id);
    } catch {
      // O erro do arquivo aparece quando validateProposal rodar em --all.
    }
  }
  return ids;
}

function validateRelease(file) {
  const rel = relative(root, file).replace(/\\/g, '/');
  const errors = [];
  const warnings = [];
  const result = { file: rel, id: null, example: false, errors, warnings };
  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    errors.push(`release.json invalido: ${error.message}`);
    return result;
  }

  const required = ['version', 'date', 'proposals', 'accepted_by', 'summary'];
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) {
      errors.push(`campo obrigatorio ausente: ${key}`);
    }
  }

  if (typeof data.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(data.version)) {
    errors.push('version deve ser SemVer X.Y.Z');
  } else if (basename(dirname(file)) !== `v${data.version}`) {
    errors.push(`a pasta deve ser v${data.version}`);
  }

  if (typeof data.date !== 'string' || !isDate(data.date)) {
    errors.push('date deve ser YYYY-MM-DD valido');
  }
  if (typeof data.accepted_by !== 'string' || !data.accepted_by.trim()) {
    errors.push('accepted_by nao pode ser vazio');
  }
  if (typeof data.summary !== 'string' || !data.summary.trim()) {
    errors.push('summary nao pode ser vazio');
  } else if (data.summary.length > 500) {
    errors.push('summary nao pode passar de 500 caracteres');
  }

  if (!Array.isArray(data.proposals) || data.proposals.length === 0) {
    errors.push('proposals deve ser array nao vazio de ids');
  } else {
    const accepted = readAcceptedIds();
    for (const id of data.proposals) {
      if (typeof id !== 'string' || !ID_RE.test(id)) {
        errors.push(`proposal invalida no release: ${id}`);
      } else if (!accepted.has(id)) {
        errors.push(`proposta ${id} nao esta em accepted/`);
      }
    }
  }

  if (data.artifacts !== undefined && (!Array.isArray(data.artifacts) || data.artifacts.some((item) => typeof item !== 'string'))) {
    errors.push('artifacts deve ser array de strings (opcional)');
  }
  scanSecrets(readFileSync(file, 'utf8'), errors);
  return result;
}

function collectAll() {
  const results = [];
  for (const dirName of ['proposals', 'accepted', 'rejected', 'examples']) {
    const dir = join(root, dirName);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
    for (const name of readdirSync(dir).filter((entry) => entry.endsWith('.md')).sort()) {
      results.push(validateProposal(join(dir, name), { example: dirName === 'examples' }));
    }
  }
  const releases = join(root, 'releases');
  if (existsSync(releases) && statSync(releases).isDirectory()) {
    for (const name of readdirSync(releases).sort()) {
      if (name.startsWith('_')) continue;
      const manifest = join(releases, name, 'release.json');
      if (existsSync(manifest)) results.push(validateRelease(manifest));
    }
  }
  return results;
}

function collectExplicit() {
  const results = [];
  for (const argument of explicit) {
    const file = resolve(root, argument);
    if (!existsSync(file)) {
      results.push({ file: argument, id: null, example: false, errors: ['arquivo nao encontrado'], warnings: [] });
      continue;
    }
    if (statSync(file).isDirectory()) {
      results.push({ file: argument, id: null, example: false, errors: ['passe um arquivo, nao um diretorio'], warnings: [] });
      continue;
    }
    if (basename(file) === 'release.json') results.push(validateRelease(file));
    else results.push(validateProposal(file, { example: file.includes(`${'examples'}`) }));
  }
  return results;
}

const results = all ? collectAll() : collectExplicit();

// Duplicata de id entre propostas vivas/arquivadas (examples ficam de fora).
const seen = new Map();
for (const result of results) {
  if (!result.id || result.example) continue;
  if (seen.has(result.id)) {
    result.errors.push(`id duplicado (tambem em ${seen.get(result.id)})`);
  } else {
    seen.set(result.id, result.file);
  }
}

let errorCount = 0;
let warningCount = 0;
for (const result of results) {
  const tag = result.errors.length ? 'ERR ' : result.warnings.length ? 'WARN' : 'OK  ';
  console.log(`${tag} ${result.file}`);
  for (const message of result.errors) {
    console.log(`      error: ${message}`);
    errorCount += 1;
  }
  for (const message of result.warnings) {
    console.log(`      warn : ${message}`);
    warningCount += 1;
  }
}

if (results.length === 0) console.log('nenhuma proposta ou release encontrada');
console.log(`\n${results.length} arquivo(s): ${errorCount} erro(s), ${warningCount} aviso(s)`);
process.exit(errorCount ? 1 : 0);
