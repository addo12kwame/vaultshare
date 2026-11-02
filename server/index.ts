import { createApp } from "./app.js";
import path from "node:path";
const port = Number(process.env.PORT || 3001);
const origin = process.env.APP_ORIGIN || "http://localhost:5173";
const { app } = createApp(path.resolve(process.env.DATA_DIR || "data"), origin);
app.listen(port, "127.0.0.1", () =>
  console.log(`VaultShare API running at http://localhost:${port}`),
);
