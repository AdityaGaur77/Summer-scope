#!/usr/bin/env node
/**
 * SummerScope Auto-Updater
 * Uses the Anthropic API + web search to verify and refresh program data.
 * Run manually or via GitHub Actions cron.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=your_key node update.js
 */

import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, "data.json");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

// ── Helper: sleep to avoid rate limits ────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Check a single program via Claude + web search ────────────────────────────
async function checkProgram(program) {
  const year = new Date().getFullYear();
  const prompt = `Today is ${today}. I need to verify current information about the "${program.name}" summer program for high school students.

Please search the web and answer these specific questions:
1. Is the ${year} application still open, or has it closed? What was/is the deadline?
2. What are the exact program dates for ${year}?
3. Has the cost changed? (current cost: ${program.cost})
4. Any major changes to the program for ${year}?

Return ONLY a JSON object with these fields (no markdown, no extra text):
{
  "closed": boolean (true if deadline has passed or applications are closed),
  "deadline": "the deadline string, e.g. 'Feb 15, ${year}'",
  "dlt": "deadline as ISO date string YYYY-MM-DD, e.g. '${year}-02-15'",
  "dates": "program dates string",
  "cost": "cost string",
  "costN": number (numeric cost, 0 if free),
  "note": "brief note about current status (1–2 sentences)",
  "changed": boolean (true if anything significant changed from what I provided)
}

Current data for reference:
- closed: ${program.closed}
- deadline: ${program.dl}
- dates: ${program.dates}
- cost: ${program.cost}`;

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{ role: "user", content: prompt }],
    });

    // Extract the final text response
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock) return null;

    const raw = textBlock.text.trim().replace(/```json\n?|```\n?/g, "");
    const parsed = JSON.parse(raw);
    return parsed;
  } catch (err) {
    console.error(`  ✗ Failed to check ${program.name}:`, err.message);
    return null;
  }
}

// ── Main update loop ──────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🔄 SummerScope Auto-Updater — ${today}`);
  console.log("─".repeat(50));

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("❌ ANTHROPIC_API_KEY environment variable not set.");
    process.exit(1);
  }

  // Load current data
  const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));
  let changedCount = 0;

  // Determine which programs to check:
  // - Always check programs that are currently marked "open" (closed: false)
  // - Check closed programs only if their deadline was within the last 30 days
  //   (to catch programs that recently closed)
  // - Skip programs closed more than 90 days ago (stable, no updates expected)
  const now = new Date();
  const programsToCheck = data.programs.filter((p) => {
    if (!p.closed) return true; // Always recheck open programs
    const deadline = new Date(p.dlt);
    const daysSinceClosed = (now - deadline) / (1000 * 60 * 60 * 24);
    return daysSinceClosed <= 90; // Recheck recently closed programs
  });

  console.log(
    `📋 Checking ${programsToCheck.length} of ${data.programs.length} programs...\n`
  );

  for (const program of programsToCheck) {
    const status = program.closed ? "closed" : "open";
    process.stdout.write(`  Checking: ${program.name} [${status}]... `);

    const update = await checkProgram(program);

    if (update && update.changed) {
      console.log(`✅ Updated`);
      // Apply updates to the program
      if (update.closed !== undefined) program.closed = update.closed;
      if (update.deadline) program.dl = update.deadline;
      if (update.dlt) program.dlt = update.dlt;
      if (update.dates) program.dates = update.dates;
      if (update.cost) program.cost = update.cost;
      if (typeof update.costN === "number") program.costN = update.costN;
      if (update.note) program.note = update.note;
      changedCount++;
    } else if (update) {
      console.log(`— No changes`);
    } else {
      console.log(`⚠ Skipped (API error)`);
    }

    // Rate limit: wait 1.5s between requests
    await sleep(1500);
  }

  // Update metadata
  data.meta.lastUpdated = today;
  data.meta.programCount = data.programs.length;

  // Write updated data back
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));

  console.log(`\n✅ Done. ${changedCount} program(s) updated.`);
  console.log(`📅 data.json updated: ${today}`);

  if (changedCount > 0) {
    console.log(
      "\n💡 Commit and push data.json to trigger a Vercel/Netlify redeploy."
    );
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
