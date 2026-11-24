import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const outRoot = new URL("../out/", import.meta.url);

test("exports static HTML with Controle do Gás PWA metadata", async () => {
  const html = await readFile(new URL("index.html", outRoot), "utf8");

  assert.match(html, /<html lang="pt-BR">/i);
  assert.match(html, /<title>Controle do Gás<\/title>/);
  assert.match(html, /href="\/controle-do-gas-pwa\/manifest\.json"/);
  assert.match(html, /Abrindo Controle do Gás/);
  assert.doesNotMatch(html, /COMPATIBILIDADE ANDROID/i);
});

test("includes required PWA and GitHub Pages assets", async () => {
  const requiredFiles = [
    ".nojekyll",
    "manifest.json",
    "sw.js",
    "icons/apple-touch-icon.png",
    "icons/icon-192.png",
    "icons/icon-512.png",
  ];

  await Promise.all(
    requiredFiles.map((file) => access(new URL(file, outRoot))),
  );
});

test("supports light, dark and automatic theme styles", async () => {
  const css = await readFile(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );

  assert.match(css, /:root\[data-theme="light"\]/);
  assert.match(
    css,
    /@media \(prefers-color-scheme: light\)\s*\{\s*:root:not\(\[data-theme="dark"\]\)/,
  );
  assert.match(css, /color-scheme:\s*light/);
  assert.match(css, /color-scheme:\s*dark/);
});

test("implements Phase 1 dashboard labels, chart details, and bottom nav clearance", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /SEU BOTIJÃO ATUAL/);
  assert.match(page, /Última reposição/);
  assert.match(page, /Próxima reposição estimada/);
  assert.match(page, /Intervalo médio/);
  assert.doesNotMatch(page, /label="Frequência"/);
  assert.match(page, /chart-avg-line/);
  assert.match(css, /padding-bottom:\s*calc\(108px \+ env\(safe-area-inset-bottom\)\)/);
});

test("implements Phase 3 navigation labels, supplier comparison, and savings card", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /full:\s*"Início"/);
  assert.match(page, /full:\s*"Registrar compra"/);
  assert.match(page, /full:\s*"Fornecedores"/);
  assert.match(page, /full:\s*"Ajustes"/);
  assert.doesNotMatch(page, /nav-primary/);
  assert.match(page, /ECONOMIA NA ÚLTIMA COMPRA/);
  assert.match(page, /MENOR PREÇO NOS SEUS REGISTROS/);
  assert.match(page, /Observações/);
});

test("implements Phase 4 consumption stats, reminders, and report exports", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /Estatísticas de consumo/);
  assert.match(page, /Gasto mensal estimado/);
  assert.match(page, /LEMBRETES DE REPOSIÇÃO/);
  assert.match(page, /Adicionar ao calendário \(\.ics\)/);
  assert.match(page, /Exportar relatório PDF/);
  assert.match(page, /Exportar planilha Excel \(\.csv\)/);
});
