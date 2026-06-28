# Stage 4 — Onsite · 3 × 45 min

> Architecture, cross-functional, and coding — Sam (HM) already covered in Stage 2.

## What they're assessing

### 1. Architecture deep-dive
- Streaming migration end-to-end — dual-write, validation, cutover
- Schema registry decisions; exactly-once vs at-least-once tradeoffs

### 2. Cross-functional (PM + SRE)
- Communicating SLAs; incident response; saying no with alternatives

### 3. Coding (practical, not leetcode trivia)
- Likely: stream processing edge case, idempotency, or API design

## Likely questions

- Walk through your streaming migration architecture on a whiteboard.
- How would you onboard a new event type safely at Northwind's scale?
- Describe a production incident you owned.
- How do you work with PM when platform work blocks a launch?

## Your strongest stories mapped to each

| Round | Story | Land this metric |
|-------|-------|------------------|
| Architecture | Streaming migration | 18h → 5min, zero incidents |
| Cross-functional | CDC lag for finance close | 4h → 22min, +8% cost |
| Coding / design | streambench replay tool | 380 stars, load testing narrative |

## Talking points

- Draw dual-write timeline on whiteboard; feature flags per event type
- Postmortem owner — blameless, action items tracked
- Ask each interviewer one question about team priorities

## Pitfalls to avoid

- Re-explaining SDK story Sam already heard — go deeper on arch
- Diving into Flink internals before clarifying requirements

## My notes (editable)

- [ ] Review Northwind schema registry blog before arch round  
- [ ] Prepare whiteboard dual-write diagram  
