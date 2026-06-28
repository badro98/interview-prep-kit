# Stage 3 — Take-home · System Design Doc

## What they're assessing

- Can you structure ambiguous platform problems?
- Written clarity — Pat reviews RFCs for staff hires
- Tradeoff reasoning (latency, cost, operability)
- Scope control in 48 hours (~3 pages, not a novel)

## Assignment (from Maya)

Design ingestion path for **new retailer onboarding 500 event types/week** with schema evolution, multi-tenant isolation, and **p99 < 30s** freshness. Document API, storage, failure modes.

## Your angles from experience

| Requirement | Your proof point |
|-------------|------------------|
| Schema evolution | Relay dual-write migration; contract tests at DataFlow |
| Multi-tenant | CDC partitioning by tenant size |
| Freshness SLA | 18h → 5min migration playbook |
| DX for squads | relay-ingest SDK adoption story |

## Structure to use

1. Requirements & assumptions  
2. High-level diagram (Kafka + registry + Flink — align with their stack if known)  
3. Schema versioning strategy  
4. Failure modes + on-call implications  
5. Rollout phases — don't big-bang  

## Pitfalls to avoid

- Designing for 10B/day on day one without phased rollout
- Skipping operability / on-call section
- No explicit tradeoffs section
