# Stage 3 — Take-home · System Design Doc

## Assignment (from Pam)

Design cloud sync for **500 new device types/quarter** with schema evolution, multi-tenant isolation, **p99 freshness < 30s**. ~3 pages + diagram.

## Angles from Ryan's background

| Requirement | Proof point |
|-------------|-------------|
| Schema evolution | Printer sync dual-write playbook |
| Multi-tenant | Regional rollout flags |
| Freshness SLA | 14h → 4min migration |
| Field team DX | sabre-device-ingest SDK |

## Structure

1. Requirements & assumptions  
2. Diagram (Kafka + registry + sync workers)  
3. Rollout phases — no big-bang  
4. Failure modes + on-call  
5. Tradeoffs section (Jim will read this)

## Pitfalls

- Designing Dundies notification system by accident
- Skipping on-call implications — Dwight will ask later
