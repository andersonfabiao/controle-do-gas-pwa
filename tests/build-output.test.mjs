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
