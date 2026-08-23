# privacy-agent

An agent that searches the internet for **your own** personal data, works out how
badly each page exposes you, and drives the removal to done.

It is built on [Agent Reach](https://github.com/Panniantong/agent-reach) for
internet access. Agent Reach is a router, not a scraper: it installs and
health-checks the upstream tools (Jina Reader, Exa, `gh`, `twitter-cli`,
`opencli`, `rdt`) and reports which backend is live for each platform. This agent
asks it what is available and dispatches accordingly, instead of hard-coding one
fragile scraper per site.

```
scan  ->  score  ->  classify  ->  ledger  ->  letters  ->  verify
find      is it     how bad is    remember    draft the    did it
pages     me?       it?           it          request      come down?
```

The last arrow is the point. A one-shot search tells you what is out there today;
removal is a loop, because people-search sites re-import you from the same
upstream feeds a few weeks after they take you down. The ledger is what lets
`verify` tell "removed" from "never seen again", and record a re-listing as its
own event.

---

## Quick start

```bash
node privacy-agent/agent.mjs init          # create identity.json (gitignored)
$EDITOR privacy-agent/identity.json        # fill in who you are
node privacy-agent/agent.mjs doctor        # what can this machine actually reach?
node privacy-agent/agent.mjs scan --dry-run  # see the queries before any run
node privacy-agent/agent.mjs scan
node privacy-agent/agent.mjs report
node privacy-agent/agent.mjs letters       # drafts into out/outbox -- sends nothing
```

Then, after you have submitted the opt-outs:

```bash
node privacy-agent/agent.mjs mark <finding-id> requested
node privacy-agent/agent.mjs verify        # run this again in two weeks, and again
```

Agent Reach is optional. Without it you still get web search and page reads
through the same free backends it routes to; with it you also get the
login-gated channels (Twitter/X, Reddit, Instagram, Facebook) once you have
configured them there:

```bash
pip install agent-reach && agent-reach install --env=auto
```

## Commands

| Command | What it does |
|---|---|
| `init` | Copy `identity.example.json` to `identity.json` |
| `doctor` | Show which Agent Reach channels and upstream backends are live |
| `scan` | Search, read, score and record. `--dry-run` prints the plan only |
| `report` | Prioritised markdown report into `out/report.md` |
| `letters` | Per-finding opt-out checklist or drafted deletion request |
| `mark <id> <status>` | `triaged` / `requested` / `removed` / `ignored` |
| `verify` | Re-read known pages: confirm removals, catch re-listings |
| `registry [--verify]` | List the broker registry; `--verify` probes every opt-out URL live |
| `status` | One-screen summary of the ledger |

Useful flags: `--channels web,brokers,github`, `--max-pages 60`,
`--min-confidence 0.45`, `--min-severity 3`, `--jurisdiction EU`,
`--identity <path>`, `--registry <path>`, `--out <dir>`, `-v`.

## How it decides a page is you

The failure mode worth engineering against is a report full of strangers who
share your name. Every selector carries an exclusivity weight -- an email address
is 0.95, a bare name is 0.3 -- and a page's confidence is a noisy-OR over the
distinct selectors it matches, with a bonus when two independent kinds of
selector land on the same page.

Two caps do the real work: a page matching **only** your name is capped at 0.35,
below the 0.45 default threshold, and a page matching only weak context
(employer, city, birth year) is capped at 0.2. So "Jane Q. Public was appointed to
a county board in Ohio" does not enter the ledger, while "Jane Q. Public,
Springfield IL, (555) 010-1234" does.

Phone numbers match on digits, so every formatting variant is one selector.
Names also match the `Last, First` order that listing sites use.

## How it decides how bad it is

| Severity | Examples |
|---|---|
| critical | Government ID number, date of birth, or address **and** phone on one page |
| high | Home address, phone, named relatives, age, court/property/voter records |
| medium | Email address, employer or school, a photo of you |
| low | A handle or profile link, a post you wrote |

Any page on a known people-search broker starts at **high**, even when the
preview shows almost nothing -- the page exists to sell the dossier behind it.

## The removal side

`letters` writes one document per finding into `out/outbox/`:

- **The site has an opt-out flow** -> a checklist with the exact URL, what to
  have ready, and what the site's quirks are. Faster than any letter.
- **It does not** -> a drafted deletion request citing the law for your
  `jurisdiction` (CCPA/CPRA, Colorado, Virginia, Connecticut, Texas, GDPR, UK
  GDPR), with the statutory response deadline.

Drafts identify you as thinly as the request allows. Handing a broker more
detail than it needs to find the record just enriches the profile you are trying
to delete.

**The agent never sends anything.** You read the draft, edit it, and send it from
your own address.

`data/brokers.json` seeds 24 entries -- people-search sites, the upstream
aggregators that feed them, the search-index removal tools, and Have I Been
Pwned as a check rather than a target. Opt-out routes move constantly, so treat
every entry as a lead: `registry --verify` probes each URL live and `--write`
stamps what it actually got back.

## Safety model

- **Self-scan only.** `identity.json` must assert `selfScan` and `subjectIsMe`
  before the agent will run. It is a tool for finding your own exposure.
- **Read-only.** Nothing here posts, comments, logs in, or submits a form.
- **Polite.** Per-host rate limiting, capped concurrency, and a page budget per
  run.
- **Redacted at rest.** Evidence snippets are masked on the way into the ledger,
  so `findings.json` and `report.md` are not a second copy of the leak. Reports
  name pages and categories, not values.
- **Gitignored.** `identity.json` and `out/` never enter version control.

Everything you put in `identity.json` becomes a search term. Start with name,
city, email and handles; add a phone or address once you trust the matching.

## Tests

```bash
npm run privacy:test
```

Sixteen unit tests cover scoring, severity, redaction, the plan order and the
ledger state machine. Three integration tests run the real pipeline -- fetch, read
fallback, score, classify, report, draft -- against a local HTTP stand-in for a
people-search site, so the whole path is exercised without sending a query about
a real person anywhere.

## Limits worth knowing

- Channels needing a login only work once Agent Reach is configured for them.
  Without that they degrade to a site-scoped web search, which sees less.
- The `searchUrl` patterns in the registry are inferred from public URL shapes
  and are the first thing to break when a site redesigns; findings still arrive
  through web search when a pattern goes stale.
- De-indexing a result is not removal. Do the source page first, the search
  index second.
- Some exposure cannot be recalled. If your address turns up in a breach dump,
  treat it as permanent and change what you can -- the password, the number, the
  address on file.
