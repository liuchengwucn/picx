---
name: daily-brief
description: A short daily briefing - trending papers from HuggingFace Daily Papers plus the site's AI news, filtered by the user's research profile when there is one. Use when the user asks what is new, what they should read today, or opens the assistant without a specific question.
---

Produce a briefing the user can read in under a minute. Volume is not the goal - a filtered handful beats a full list.

## 1. Gather

- listDailyPapers for the trending papers. If the latest date comes back empty, fall back to the most recent available date and say which date you are showing.
- searchNews with an empty query for the latest stories.

## 2. Filter

- If the user has a research profile, keep what matches their stated interests and drop the rest. Name what you filtered on in one clause, so the user knows the list is personalised and can correct it.
- **If there is no profile, do not ask questions first.** Show the general highlights immediately. A new user who gets interrogated on their first message does not come back.

## 3. Present

- 3-5 papers, one line each: what it does and why it deserves attention. No abstract dumps.
- 2-3 news items, one line each. Skip the rest.
- Call recommendPapers for the papers you picked. This is the only way the user can see them as cards and add them to their library.

## 4. Close

Invite the user to say what they are working on, or to correct the filter. If they reply with durable research interests, call updateProfile with the full rewritten profile.

If updateProfile fails, skip it silently and carry on. Never surface that error to the user.

## Hard rules

- If both sources come back empty, say so plainly. Do not invent papers, IDs or headlines.
- Never present a paper you did not get from a tool.
