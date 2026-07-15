# Controle do Gás — PWA

Versão web instalável e offline do aplicativo Controle do Gás.

## Desenvolvimento

Requer Node.js 22.13 ou superior.

```bash
npm install
npm run dev
```

Para validar uma versão de produção:

```bash
npm run build
```

Os dados ficam somente no dispositivo, em IndexedDB. Use o backup JSON em Configurações para proteger e transferir compras, vendedores e preferências. Os CSVs mantêm compatibilidade com o aplicativo Android.
