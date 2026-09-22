import express from "express";

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.static("public"));

app.get("/api/status", (_req, res) => {
  res.json({
    radar: "online",
    status: "OK",
    mensagem: "Radar Live iniciado com sucesso"
  });
});

app.listen(PORT, () => {
  console.log(`Radar Live rodando na porta ${PORT}`);
});
