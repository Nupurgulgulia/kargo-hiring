# The founder's instinct layer

What the eight past-hire CVs say beyond the weighted rubric, and how the dashboard uses it.

**Read this first.** Eight people (five Exceeds, two Meets, one Below) is a very small sample, and
these signals were drawn from the same eight CVs they are now checked against. That makes them
good descriptions of this group and unproven predictors for the next candidate. Treat everything
here as a hunch to weigh, never as a rule. The rubric's own note applies too: a CV cannot show
judgment, collaboration or execution quality, which is often why a hire underperforms.

## What stands out when the three matched pairs are read side by side

The rubric already scores logistics exposure, self-initiated builds, crisis ownership, shipping and
killing features, and building structure from zero. The most informative comparisons are people who
did the *same job* and landed differently:

| Same job | Exceeds | Did not exceed | What differs on the page |
|---|---|---|---|
| Product manager | **Lavanya**: three years inside a 3PL first, sole PM, killed 2 features *against* strong customer demand, wrote the outage post-mortem for both audiences | **Vikram** (Meets): polished PM at an HR-tech SaaS, 12 shipped features, every line a win | Lavanya's CV tells her decisions and misses. Vikram's has no failure, no killed bet and no incident |
| Backend engineer | **Rohan**: started at a CHA firm, built tools for ops users unasked, 30 colleagues adopted a weekend prototype | **Preetham** (Below): one of 12 engineers at a 3,200-person company, results all in system metrics | Rohan's work spreads past his own component. Preetham's stays inside it, with no customer or ops contact visible |
| B2B SaaS go-to-market | **Aditya**: sold inside the port terminal, ran a post-mortem on a *lost* deal | **Rahul** (Meets): 120% of target, every number a win | Both launched a "first case-study programme", so that is not the difference. Port exposure and an owned loss are |

## The eight signals

Strength = how cleanly it separated the five Exceeds hires from the other three **in this sample**.

| Signal | What strong looks like | What weaker looks like | Strength |
|---|---|---|---|
| **Owns the miss** | Names a specific failure, loss or killed bet: what they got wrong, and what changed | Every line is a win; problems are things "identified", never things they got wrong | Moderate |
| **Absorbs the disruption** | Handles it before it reaches the customer or a manager, and the CV shows the cost (a weekend, a night) | Handled through process, rotation or stakeholder management | Moderate |
| **Leaves a standard behind** | Something built unasked is still used and spread beyond their team ("retained permanently", "now standard practice") | Adoption limited to their own team or already their job; or none claimed | High |
| **States a stance, not an inventory** | The summary says how they believe work should be done, in their words | A competency list or title labels, or no summary | Tentative (Aditya is an exception) |
| **Autonomy defined by what is absent** | "Without a product layer", "no account manager layer", "limited oversight", "sole PM" | Scope described by the structure navigated: roadmap reviews, "part of a 12-engineer team" | Moderate (Rahul also writes "no CMO above") |
| **The numbers measure someone else's pain** | Support tickets down 60%, churn 6% against a 24% team average | ARR, pipeline, CAC, uptime, query time | Tentative |
| **Operator first, builder second** | Years doing the work inside a logistics operation, then software for it; uses the work's own vocabulary | Software or sales first, logistics as a customer segment or an API integration | High (overlaps rubric criterion 1) |
| **Credits others' outcomes** | A trainee promoted, a mentee promoted, an engineering lead's note, a client that passed inspection | "Mentored two engineers" with no result; only self-reported wins | Tentative |

Counts across the five Exceeds / three others (strong–some–absent), from `db/instinct.json`:

| Signal | Exceeds | Others |
|---|---|---|
| Owns the miss | 3–2–0 | 0–1–2 |
| Absorbs the disruption | 3–2–0 | 0–1–2 |
| Leaves a standard behind | 5–0–0 | 0–2–1 |
| States a stance | 3–1–1 | 0–0–3 |
| Autonomy by absence | 5–0–0 | 0–2–1 |
| Numbers measure others' pain | 2–3–0 | 0–1–2 |
| Operator first | 4–1–0 | 0–0–3 |
| Credits others | 3–1–1 | 0–0–3 |

The strength rating of each hire against each signal is my reading of the CV, recorded in
`db/instinct.json` with a short note so it can be checked and changed.

## What did not separate them

These look like evidence and are not. The founder's read is told to ignore them:

- Certifications and conference talks (Vikram has the most; Exceeds hires hold them too).
- School or employer prestige.
- Metric-dense writing on its own (Vikram and Rahul are full of numbers).
- "From scratch" language on its own (Rahul uses it twice).
- Whether the job title says Product Manager (only Lavanya's did; four of the five Exceeds hires
  came from engineering, operations, customer success and sales).

## How the dashboard uses it

Every scored candidate gets a **founder's read**: one paragraph in Arjun's voice saying which past
hire or hires the CV most resembles on these signals and why, a "where I could be wrong" line, and
the eight signals rated for that candidate. It appears on the candidate page between the scores and
the interview brief.

What it is **not**:

- It does not change the score, the recommendation, the decision, or any email. Nothing in the
  scoring or send code reads it.
- It does not tell Arjun what to do. A validator rejects drafts containing hire/reject/interview
  language, retries once with the reasons, and otherwise shows no read at all.
- It does not invent history. The model may only use what is in the candidate's CV and in the eight
  profiles; it may not make up anecdotes or quotes for Arjun or the past hires.
- It does not reason from school, employer prestige, location, age, gender or name. No one's
  pronouns are known, so it uses names and "they".
- It is labelled "AI draft in your voice", so it is never mistaken for Arjun's own notes, which stay
  in "Your decision".

A resemblance to a Meets or Below hire is reported as plainly as one to an Exceeds hire, and a weak
match is allowed to say it is weak.

## Keeping it honest

- The signals and the eight profiles live in `db/instinct.json`. `npm run db:setup` loads them and
  refuses to continue if any score or outcome disagrees with `db/rubric.txt`.
- Each new hire's outcome is a new data point. Add them to the JSON, and revisit the signals once
  there are enough to test them on people who were *not* used to write them.
- The profiles are distilled employment histories of real people (first names only, no contact
  details). They are sent to the AI as reference on every founder's read, and they sit in this
  repository, so keep the repository private.
- Each founder's read is one more AI call per candidate (six per candidate now), which matters on a
  free Gemini quota.
