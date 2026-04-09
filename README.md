# SummerScope 🎓

The complete database of summer programs, hackathons, and competitions for high school students (grades 9–12). Auto-updated weekly using the Anthropic API with web search.

**Live site:** https://summerscope.vercel.app *(your URL after deployment)*

---

## Project structure

```
summerscope/
├── index.html                    ← The website (fetches data.json at load time)
├── data.json                     ← All program and event data (auto-updated)
├── update.js                     ← Node.js script to refresh data via Anthropic API
├── package.json
├── vercel.json                   ← Vercel deployment config
├── netlify.toml                  ← Netlify deployment config (alternative)
├── .gitignore
└── .github/
    └── workflows/
        └── update-data.yml       ← GitHub Actions: runs update.js every Monday
```

---

## Deploy to Vercel (recommended, 5 minutes)



## Tech stack

- **Frontend:** Vanilla HTML/CSS/JS — zero dependencies, no build step
- **Data layer:** Static `data.json` fetched at page load
- **Auto-update:** Node.js script + Anthropic SDK (`@anthropic-ai/sdk`) with web search
- **Automation:** GitHub Actions cron job (every Monday 8am UTC)
- **Hosting:** Vercel (or Netlify)

---

*Not affiliated with any program listed. Always verify on official sites before applying.*
