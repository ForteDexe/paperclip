---
name: outpost-case
description: Create or update a durable Outpost Case when recurring incidents, repeated debugging, or a long-lived investigation needs to connect multiple tasks over time.
---

# Outpost Case

A Case is a durable subject that work happens around. Use it for a recurring
bug, incident, or investigation that may produce several tasks over time.

Do not create a Case for every task. Start with the task; create or link a Case
only when recurrence or durable cross-task history is useful. A Case does not
replace task ownership, status, or execution.

Use a stable `caseType` and `key` so retries update the same Case. Link related
tasks with role `work` or `reference`. Keep compact facts in `fields`; put long
findings in Case documents.

Read [references/api-reference.md](references/api-reference.md) for the exact
upsert, link, and document contracts. Cases must be enabled in Outpost.

