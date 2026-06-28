# Experiences — Story Bank

## Story: Printer sync migration

**Situation:** Nightly batch firmware checks; sales demos showed stale device state.  
**Task:** Lead real-time sync without bricking 120K units.  
**Action:** Phased rollout, feature flags per region, dual-write validation.  
**Result:** Stale window **14h → 4 min**; **zero** bricked devices during cutover.

**Best for:** Jim, Dwight (architecture), Michael (ownership).

---

## Story: SDK adoption (sabre-device-ingest)

**Situation:** Nine field teams maintained forked ingestion scripts.  
**Task:** One supported path without blocking velocity.  
**Action:** Pilot with 3 teams, office hours, semver discipline.  
**Result:** **9 teams onboarded**, ~**55%** less bespoke code.

**Best for:** Jim (HM), Angela (process).

---

## Story: WUPHF scale lesson

**Situation:** Notification spike took down manual ops.  
**Task:** Stabilize without funding for proper infra.  
**Action:** Queue backpressure, paging, postmortem.  
**Result:** **2M msgs/month** handled; learned to design for failure upfront.

**Best for:** "Tell me about failure" — Michael Scott final.

---

## Metrics cheat sheet

| Metric | Value |
|--------|-------|
| Active devices | 120K |
| SDK teams | 9 |
| Uptime | 99.95% |
| Stale config fix | 14h → 4min |
