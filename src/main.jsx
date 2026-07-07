import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";
import { runMigrations } from "./lib/migrate.js";
import { backfillJobIds } from "./lib/db.js";

async function boot() {
  const { jobId } = runMigrations();
  try {
    await backfillJobIds(jobId);
  } catch (err) {
    // IndexedDB backfill failing must not block the app; legacy audio rows
    // just stay hidden until the next successful boot.
    console.warn("iprep: jobId backfill failed", err);
  }
  ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

boot();
