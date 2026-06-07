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

### 1. Push to GitHub
```bash
git init
git add .
git commit -m "initial commit"
gh repo create summerscope --public --push
# or: git remote add origin https://github.com/YOUR_USERNAME/summerscope.git && git push -u origin main
```

### 2. Deploy to Vercel
```bash
npm install -g vercel
vercel --prod
```
Or go to [vercel.com](https://vercel.com), import your GitHub repo, and click Deploy. No build command needed — it's a static site.

### 3. Add your Anthropic API key to GitHub Secrets
1. Go to your GitHub repo → **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret**
3. Name: `ANTHROPIC_API_KEY`
4. Value: your Anthropic API key from [console.anthropic.com](https://console.anthropic.com)

That's it! The GitHub Action will now run every Monday and push updated `data.json` to your repo, which triggers a Vercel redeploy automatically.

---

## Deploy to Netlify (alternative)

```bash
npm install -g netlify-cli
netlify deploy --prod --dir .
```

Or drag-and-drop the folder at [app.netlify.com](https://app.netlify.com). Then add `ANTHROPIC_API_KEY` to Netlify's environment variables under **Site settings → Environment variables**.

---

## Run the updater manually

```bash
npm install
ANTHROPIC_API_KEY=your_key_here npm run update
```

The updater:
- Checks all programs still marked "open" (closed: false)
- Rechecks recently-closed programs (within 90 days) for any corrections
- Uses Claude + web search to verify deadlines, dates, and costs
- Updates `data.json` in place
- Commits and pushes if run via GitHub Actions

---

## Add or edit a program

Edit `data.json` directly. Each program entry has this shape:

```json
{
  "id": 29,
  "name": "Program Name",
  "host": "Institution Name",
  "logo": "2-4 letter abbreviation",
  "color": "#hexcolor",
  "cat": ["STEM", "Research"],
  "fmt": "In-Person",
  "loc": "City, State",
  "grades": [10, 11, 12],
  "cost": "Free",
  "costN": 0,
  "costB": "Free",
  "dates": "June 15 – July 30, 2026",
  "dl": "Mar 1, 2026",
  "dlt": "2026-03-01",
  "closed": true,
  "prestige": 4,
  "isNew": false,
  "desc": "Full description here.",
  "link": "https://program-website.edu",
  "note": "Optional insider tip or status note."
}
```

`costB` must be one of: `"Free"`, `"Under3k"`, `"3kTo8k"`, `"Over8k"`

`fmt` must be one of: `"In-Person"`, `"Online"`, `"Hybrid"`

---

## Custom domain

In Vercel: **Project settings → Domains → Add** your domain and follow the DNS instructions.

---

## Tech stack

- **Frontend:** Vanilla HTML/CSS/JS — zero dependencies, no build step
- **Data layer:** Static `data.json` fetched at page load
- **Auto-update:** Node.js script + Anthropic SDK (`@anthropic-ai/sdk`) with web search
- **Automation:** GitHub Actions cron job (every Monday 8am UTC)
- **Hosting:** Vercel (or Netlify)

---

*Not affiliated with any program listed. Always verify on official sites before applying.*
