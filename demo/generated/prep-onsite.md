# Stage 3 — Onsite · 4 × 45 min

> Best stage for README screenshots — rich doc with mapped stories and metrics.

## What they're assessing

### 1. EM behavioral (Sam Rivera)
- Cross-team influence, conflict, mentoring
- How you prioritize platform vs product deadlines

### 2. Architecture deep-dive
- Streaming migration end-to-end — dual-write, validation, cutover
- Schema registry decisions; exactly-once vs at-least-once tradeoffs

### 3. Cross-functional (PM + SRE)
- Communicating SLAs; incident response; saying no with alternatives

### 4. Coding (practical, not leetcode trivia)
- Likely: stream processing edge case, idempotency, or API design

## Likely questions

- Tell me about the hardest technical decision in your streaming migration.
- How did you get 12 teams to adopt your SDK?
- Describe a production incident you owned.
- How would you onboard a new event type safely?

## Your strongest stories mapped to each

| Round | Story | Land this metric |
|-------|-------|------------------|
| EM behavioral | SDK adoption without authority | 12 teams, NPS 71 |
| Architecture | Streaming migration | 18h → 5min, zero incidents |
| Cross-functional | CDC lag for finance close | 4h → 22min, +8% cost |
| Coding / design | streambench replay tool | 380 stars, load testing narrative |

## Talking points

- **Migration:** Draw dual-write timeline on whiteboard; emphasize feature flags per event type
- **SDK:** Pilot team strategy — don't mandate, prove value
- **Incidents:** Postmortem owner — blameless, action items tracked
- Ask Sam about guild RFC cadence and on-call rotation split

## Pitfalls to avoid

- Diving into Flink internals before clarifying requirements
- Staff = people manager — clarify IC staff track
- Forgetting to ask interviewers questions in every round

## My notes (editable)

- [ ] Review Northwind schema registry blog before arch round  
- [ ] Prepare whiteboard dual-write diagram  
- [x] Re-read Sam's LinkedIn posts on operability  
