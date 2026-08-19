---
name: topic-scan
description: Scan arXiv for a research topic from several angles at once, deduplicate, group by sub-direction, and surface the papers worth reading as cards. Use when the user wants to survey a field, catch up on a topic, or find related work - anything broader than looking up one paper.
---

Survey `$ARGUMENT` as a field, not as a keyword.

If `$ARGUMENT` is empty, ask what topic to scan. Do not guess.

## 1. Plan the angles first

Write down 3-5 distinct search angles before searching anything. Good angles differ in kind, not in wording:

- the method or technique itself
- the problem it solves, phrased the way practitioners phrase it
- a competing or predecessor approach
- the benchmark, dataset or application domain
- the known failure mode, or the critique of the approach

Two angles that would return the same papers are one angle. State the angles so the user can add one.

## 2. Search

One searchArxiv call per angle. **Keep each query to 2-5 words** - the query is matched as a phrase, so a long sentence returns nothing. Add a category filter such as cs.CL only when the topic is ambiguous across fields.

Run searchMyPapers on the same topic too. Telling the user which of these they already have is worth more than one more arXiv hit.

## 3. Consolidate

- Deduplicate across angles by arXiv id.
- Group into 2-4 sub-directions, named after what actually distinguishes them.
- Within a group, order by what you would read first, not by date.
- Drop everything that only matched superficially. A shorter honest list is the deliverable.

## 4. Present

Per group: one sentence on what the group is about, then 2-4 papers with one line each on what it contributes and how it differs from its neighbours. Mark the ones already in the user's library.

Call recommendPapers with the papers worth adding, at most 8.

Close by naming the angle you would scan next, and ask whether to run it.

## Hard rules

- Never present a paper you did not get from a tool. No IDs, titles or numbers from memory.
- If an angle returns nothing useful, say which one and move on.
