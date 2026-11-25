import ts from 'typescript';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('./src/', import.meta.url));
const allowed = new Set(['ManagerHR', 'HR', 'OK']);
const issues = [];
const attributes = new Set(['aria-label', 'alt', 'title', 'placeholder']);
function inspect(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const file = join(path, entry.name);
    if (entry.isDirectory()) inspect(file);
    else if (/\.tsx$/.test(file) && !/\.test\.tsx$/.test(file)) {
      const source = ts.createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      const report = (node, value) => {
        const text = value.replace(/\s+/g, ' ').trim();
        if (!text || allowed.has(text) || !/[\p{L}]/u.test(text)) return;
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        issues.push(`${relative(root, file)}:${line + 1}: ${text.slice(0, 100)}`);
      };
      function visit(node) {
        if (ts.isJsxText(node)) report(node, node.text);
        if (
          ts.isJsxAttribute(node) &&
          attributes.has(node.name.getText(source)) &&
          node.initializer &&
          ts.isStringLiteral(node.initializer)
        )
          report(node, node.initializer.text);
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
}
inspect(root);
const source = ts.createSourceFile(
  'index.ts',
  readFileSync(join(root, 'i18n/index.ts'), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
);
let messages;
function find(node) {
  if (
    ts.isVariableDeclaration(node) &&
    node.name.getText(source) === 'messages' &&
    node.initializer &&
    ts.isAsExpression(node.initializer)
  )
    messages = node.initializer.expression;
  ts.forEachChild(node, find);
}
find(source);
if (!messages || !ts.isObjectLiteralExpression(messages))
  throw new Error('Cannot inspect core translation catalog');
const catalogs = new Map();
for (const locale of messages.properties) {
  if (!ts.isPropertyAssignment(locale) || !ts.isObjectLiteralExpression(locale.initializer))
    continue;
  const keys = new Map();
  for (const prop of locale.initializer.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const key = prop.name.getText(source);
    if (keys.has(key)) issues.push(`Duplicate ${locale.name.getText(source)} key: ${key}`);
    keys.set(key, prop.initializer);
    if (ts.isStringLiteral(prop.initializer) && !prop.initializer.text.trim())
      issues.push(`Empty ${locale.name.getText(source)} key: ${key}`);
  }
  catalogs.set(locale.name.getText(source), keys);
}
for (const lang of ['vi', 'en']) if (!catalogs.has(lang)) issues.push(`Missing locale: ${lang}`);
if (catalogs.has('vi') && catalogs.has('en'))
  for (const lang of ['vi', 'en'])
    for (const key of catalogs.get(lang).keys())
      if (!catalogs.get(lang === 'vi' ? 'en' : 'vi').has(key))
        issues.push(`Missing translation for ${key} in ${lang === 'vi' ? 'en' : 'vi'}`);
console.log(`i18n check: ${issues.length} potential issues`);
for (const issue of issues) console.log(issue);
if (issues.length) process.exitCode = 1;
