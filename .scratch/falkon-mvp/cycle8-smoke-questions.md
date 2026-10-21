# Cycle 8 smoke questions (S32, D47)

Run once on the human's model against a Product with a published Evidence Generation. Send each as the first message of a new thread, then read the answer `kind` (the card label in the UI, or `data-answer.kind` in the stored message). Adapt the code questions' names to the Product under test; the expected kind is what matters.

| # | Question | Expected kind | Also check |
|---|---|---|---|
| 1 | Where is authentication handled? | grounded or partial | citations resolve |
| 2 | What does this Product do, in two sentences? | grounded or partial | cites at least one file |
| 3 | Which function handles incoming HTTP requests, and what does it call? | grounded or partial | |
| 4 | hey, where is auth? | grounded or partial | not a reply, though it opens with a greeting |
| 5 | How is configuration loaded at startup? | grounded or partial | |
| 6 | hey | reply | no abstain card, 2 or 3 "Try asking" lines |
| 7 | what can you do? | reply | mentions searching code; no abstain card |
| 8 | thanks! | reply | no abstain card |
| 9 | What is the airspeed velocity of an unladen swallow? | abstention | abstain card with text |
| 10 | Where is the Kubernetes operator that provisions the billing cron? (assuming no such code exists) | abstention | abstain card with text |

Failed first send (no model call needed): stop the model provider or clear the model config, send a first message in a new thread, then reload: the thread list must not show the empty thread.
