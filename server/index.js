const path = require("path");
const fs = require("fs");
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, "..");
const DATA_PATH = path.join(ROOT, "data", "estacoes.json");

app.disable("x-powered-by");

app.get("/api/estacoes", (_req, res) => {
  fs.readFile(DATA_PATH, "utf8", (err, raw) => {
    if (err) {
      console.error(err);
      res.status(500).json({ error: "Não foi possível ler o catálogo." });
      return;
    }
    res.type("json").send(raw);
  });
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "dimbat" });
});

app.use(express.static(path.join(ROOT, "public")));

app.get("*", (_req, res) => {
  res.sendFile(path.join(ROOT, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`DimBat listening on http://0.0.0.0:${PORT}`);
});
