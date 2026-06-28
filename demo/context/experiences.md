# Experiences — Story Bank

## Story: Streaming migration (Relay)

**Situation:** Nightly batch pipeline; product wanted near-real-time dashboards.  
**Task:** Lead migration without downtime for Black Friday traffic.  
**Action:** Dual-write → validate → cutover over 6 weeks; feature flags per event type.  
**Result:** Freshness **18h → <5 min**; **zero** customer incidents; team of 4.

**Best for:** Technical leadership, ambiguity, scale, tradeoffs.

---

## Story: SDK adoption (Relay)

**Situation:** 12 teams copy-pasted ingestion boilerplate; drift caused outages.  
**Task:** One supported path without blocking team velocity.  
**Action:** Paired with 3 pilot teams; semver + changelog; office hours.  
**Result:** **12 teams onboarded**, ~**60%** less bespoke code; NPS 42 → 71 on platform survey.

**Best for:** Developer experience, influence without authority, staff scope.

---

## Story: CDC pipeline (DataFlow)

**Situation:** 4-hour Snowflake lag blocking finance close.  
**Task:** Reduce lag without doubling infra cost.  
**Action:** Debezium + incremental sync; partitioned by tenant size.  
**Result:** Lag **4h → 22 min**; infra cost **+8%** only.

**Best for:** Data depth, cost awareness, debugging production.

---

## Metrics cheat sheet

| Metric | Value |
|--------|-------|
| Daily events (Relay) | 40M |
| SDK teams onboarded | 12 |
| Pipeline uptime | 99.97% |
| streambench stars | 380 |
