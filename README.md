# DimBat

Ferramenta web para **dimensionar** estações de energia portáteis (power stations) com baterias de lítio: capacidade, autonomia, potência contínua/pico e comparação de modelos.

## Funcionalidades

- Cálculo de consumo diário e energia necessária (DoD, eficiência do inversor, margem)
- Catálogo JSON com modelos EcoFlow, Bluetti, Jackery, Anker, Goal Zero, Generac
- Recomendações ranqueadas por adequação
- Comparação lado a lado (até 3 modelos)
- API simples `GET /api/estacoes`

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

O banco de modelos fica em `data/estacoes.json`. Preços e specs são aproximados — valide sempre com a ficha oficial do fabricante.
