# Controle do Gás — PWA

Aplicativo web instalável (PWA) e offline para acompanhar compras, consumo e duração estimada do botijão de gás.

## Desenvolvimento

Requer Node.js 22.13 ou superior.

```bash
npm install
npm run dev
```

Para validar o build estático e os testes:

```bash
npm run lint
npm test
```

## Publicação

O push na branch `main` gera a exportação estática (`./out`) e publica automaticamente no GitHub Pages via GitHub Actions.

## Dados e backup

Os dados ficam armazenados localmente no dispositivo (IndexedDB). Use o backup JSON em **Configurações** para salvar ou restaurar suas compras, vendedores e preferências.
