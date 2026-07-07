import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";
import { runMigrations, applyDemoResync } from "./lib/migrate.js";
import { backfillJobIds } from "./lib/db.js";
import { getJobs, ensureDefaultJob } from "./lib/jobs.js";
import * as storage from "./lib/storage.js";
import { DEMO } from "../interview.config.js";

const DEMO_STATE_KEY = "demo:localStateVersion";

async function boot() {
  // Demo resync runs BEFORE runMigrations: when the demo config's
  // localStateVersion bumps, wipe all iprep: state and stamp the new
  // version so migrations run fresh, then reseed a demo job below. Non-demo
  // builds (DEMO null) skip all of this.
  if (DEMO?.localStateVersion != null && applyDemoResync(DEMO.localStateVersion)) {
    storage.set(DEMO_STATE_KEY, DEMO.localStateVersion);
  }

  let { jobId } = runMigrations();

  // Demo builds need a seed-backed job for context/generated files and
  // config STAGES with `file` props — reseed one if migrations didn't
  // create anything (e.g. right after a resync wipe with no legacy keys).
  if (DEMO && getJobs().length === 0) {
    jobId = ensureDefaultJob().id;
  }

  if (!jobId) return;

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
