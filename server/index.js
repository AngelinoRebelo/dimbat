const path = require("path");
const fs = require("fs");
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");

app.disable("x-powered-by");

function sendJsonFile(fileName, res) {
  fs.readFile(path.join(DATA_DIR, fileName), "utf8", (err, raw) => {
    if (err) {
      console.error(err);
      res.status(500).json({ error: `Não foi possível ler ${fileName}.` });
      return;
    }
    res.type("json").send(raw);
  });
}

app.get("/api/estacoes", (_req, res) => sendJsonFile("estacoes.json", res));
app.get("/api/solar", (_req, res) => sendJsonFile("solar.json", res));

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
