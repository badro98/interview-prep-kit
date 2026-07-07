import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";
import { runMigrations } from "./lib/migrate.js";
import { backfillJobIds } from "./lib/db.js";

async function boot() {
  const { jobId } = runMigrations();
  try {
    // The backfill is idempotent, so it's safe to race it against a timeout:
    // if another tab holds a blocking IndexedDB connection open, we don't
    // want to hang the boot forever — just retry the backfill next boot.
    await Promise.race([
      backfillJobIds(jobId),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
  } catch (err) {
    // IndexedDB backfill failing must not block the app; legacy audio rows
    // just stay hidden until the next successful boot.
    console.warn("iprep: jobId backfill failed", err);
  }
}

boot().catch((err) => {
  console.error("iprep: boot failed", err);
}).finally(() => {
  ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});
