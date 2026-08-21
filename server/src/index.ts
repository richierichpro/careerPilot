import "dotenv/config";
import cors from "cors";
import express from "express";
import type { HealthCheckResponse } from "@careerpilot/shared";
import { resumeRouter } from "./routes/resume";
import { profileRouter } from "./routes/profile";

const app = express();
const port = Number(process.env.PORT ?? 8787);

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn(
    "ANTHROPIC_API_KEY is not set — resume parsing will fail until it's configured in server/.env",
  );
}

app.use(cors());
app.use(express.json());

app.use("/api/resume", resumeRouter);
app.use("/api/profile", profileRouter);

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
