# DimBat

Ferramenta web para **dimensionar** estações de energia portáteis (power stations) com baterias de lítio: capacidade, autonomia, potência contínua/pico e comparação de modelos.

## Funcionalidades

- Cálculo de consumo diário e energia necessária (DoD, eficiência do inversor, margem)
- Dimensionamento solar (HSP, perdas, quantidade de painéis, inversores e estações)
- Catálogos com links oficiais: estações, painéis e inversores
- Recomendações ranqueadas por adequação
- Comparação lado a lado (até 3 estações)
- APIs `GET /api/estacoes` e `GET /api/solar`

## Stack

- HTML / CSS / JS (frontend estático)
- Node.js + Express (servir arquivos + API)
- Pronto para deploy no **Railway**

## Desenvolvimento local

```bash
npm install
npm start
```

Abra `http://localhost:3000`.

## Railway

1. Conecte este repositório no Railway
2. O start command é `npm start`
3. A porta é lida de `PORT` (Railway injeta automaticamente)

## Dados

Os bancos ficam em `data/estacoes.json` (power stations) e `data/solar.json` (painéis e inversores). Preços e specs são aproximados — valide sempre no site oficial do fabricante (cada card tem o link).
