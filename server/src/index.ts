import "dotenv/config";
import cors from "cors";
import express from "express";
import type { HealthCheckResponse } from "@careerpilot/shared";

const app = express();
const port = Number(process.env.PORT ?? 8787);

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  const body: HealthCheckResponse = {
    status: "ok",
    service: "careerpilot-server",
    timestamp: new Date().toISOString(),
  };
  res.json(body);
});

app.listen(port, () => {
  console.log(`careerpilot server listening on http://localhost:${port}`);
});
