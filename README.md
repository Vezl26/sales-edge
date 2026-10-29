# Sales Edge — AI sales notes for Even G2 glasses

Built for selling beef, deli, chocolate and prepared foods.

**On the lens during a conversation**
- Live transcript with **Me** vs **Customer** (or the customer's name).
- Say a beef cut ("how's strip loin running?", "one eighty nine A", "flap meat") and you get the **latest USDA boxed beef price** in $/lb, its range, day-over-day move, the Select/Choice price, your case price, and a question to ask.
- Say "cutout", "kill", "fed cattle", "ground beef/trim" and you get those numbers.
- Say a price ("$9.20 a pound") and you get $/cwt, $/kg and the price per 40,000 lb load.
- Say the customer's name and you get their talking points: open follow-ups, what they buy, notes, and related news.
- Say an item from **your own price lists** (deli, chocolate, prepared foods) and its row appears.

**After the conversation:** a clean summary with topics, real follow-ups (who, what, when), prices and volumes mentioned, customer needs, and talking points for next time. Every call is saved and searchable.

## Cost: $0
| Piece | How it's free |
|---|---|
| USDA prices, slaughter, fed cattle | Public USDA reports, pulled by GitHub Actions (free) |
| News (beef, cattle, grocery, deli, cocoa, Cargill, Richmond) | Google News RSS, every 3 hours |
| Hosting | GitHub Pages (free) |
| Transcription | Deepgram — new accounts get free starting credit |
| Deep summaries | "Copy for Claude" → paste into your Claude chat (on your subscription). Optional in-app AI with a free Gemini or Groq key. |

## Privacy
Customers, your numbers, price lists and call transcripts are stored **only on your phone** in the Even app. They are never written to this repo. The repo only holds the app code and public USDA and news data. Use **Data → Export backup** now and then.

## One-time setup (all from your phone)
1. **GitHub:** create a free account and an **empty public repo** named `sales-edge`, then add these files to it (or have Claude push them).
2. In the repo, go to **Settings → Pages → Source: GitHub Actions**.
3. Go to **Actions → "Update data and deploy" → Run workflow**. After 2–3 minutes your app is live at `https://YOURNAME.github.io/sales-edge/`.
4. **Install on the glasses:** open `https://YOURNAME.github.io/sales-edge/install.html` on another screen, or on a computer. In the Even Realities app, scan the QR code to load the app on your glasses. You can also download `sales-edge.ehpk` from that page and upload it to your Even Hub developer account.
5. **Deepgram key:** sign up at console.deepgram.com, create an API key, and paste it into **Settings** in the app.
6. **Voice check:** go to **Settings → Start 6-sec voice check** and talk normally. This teaches the app how loud *your* voice is at the glasses, which is how it tells you apart from the customer.
7. **Load your data:** use **Customers → Import CSV** (columns: Customer, Item, Volume, Price, Contact, Segment, Notes) and **Data** for your numbers and price lists. If your data is in Excel, use "Save As CSV" first.

## Using it
- **Glasses home menu:** Start call · Start call with a customer · Market brief · News · Recent calls · Open follow-ups.
- **During a call:** tap = pause/resume · swipe = flip through cards · double-tap = end the call and summarize.
- **Phone:** Live tab shows everything. Tap any transcript line to switch who said it.
- **Deep notes with Claude (on your subscription):** see below.

## Meeting prep (read it on your glasses mid-conversation)
- **Phone → Prep tab → Create prep.** Pick the customer and date. The app drafts it from open follow-ups, the last call, what they buy (with today's USDA price), market points, questions to ask, news and what you've learned about them.
- Edit it freely. Each `## Heading` becomes one card on the glasses.
- **Prep with Claude** sends it, along with their history, to your Claude Project for a sharper version. Paste Claude's answer back into the notes.
- **On the glasses:** the prep loads automatically when you start a call with that customer, or as soon as the app hears their name. **Swipe** with the ring to flip through it, alongside the price cards. You can also read it beforehand under **Meeting prep** in the glasses menu. On the last page, tap to start the call with it loaded.

## Market tracking (automatic)
- **Wholesale:** USDA boxed beef cutout and every cut (daily), cattle slaughter, fed cattle.
- **Retail:** USDA weekly grocery-store beef ad prices (ground beef, steaks, roasts) vs last week and last year, plus the feature rate.
- **News:** beef, cattle, grocery, deli, cocoa, Cargill, Richmond (every 3 hours).
- **Your weekly reports:** Data tab → type "Weekly report" with its week. The newest one is marked **CURRENT** and feeds prep and Claude. Older ones stay as history.

## Topic prep (e.g. "ground beef issue")
Create a prep with a topic and the draft pulls in:
- what happened, from your notes and documents (temps, lots, credits)
- past calls that mention it
- wholesale and retail prices for it
- how it should be handled (USDA FSIS points, with your specs first)
- a quality-claim checklist
- auto talking points that compare what happened against the standard (e.g. "walk-in at 44°F is above the 40°F hold standard")
- this week's report

All of it shows on your glasses as swipeable cards.

## During a call with prep: Teleprompter + Conversate
- **Prep comes first.** When a call has prep, the right panel works like a teleprompter: your goal stays pinned, the current point is marked ▶, and the next points line up below it.
- **It follows the conversation.** When something on the prep gets talked about, it's checked off ✓ and the next point moves up. Swipe down = mark done and move on, swipe up = go back.
- **Off-prep help.** If the conversation drifts somewhere the prep doesn't cover, it pulls the best matching lines from your documents (weekly reports, notes, price lists) as a REFERENCE pop-up. After 20 seconds it switches back to your prep, or you can swipe to go back right away. Price cards pop up the same way.
- **Suggested replies (SAY:).** When the customer asks something or pushes back (price, competitor, supply, quality, delivery, holiday ads, retail), a line to say pops up, built from today's USDA numbers. With a free AI key in Settings, it also suggests replies for any other question.
- **After the call:** any prep points you didn't get to show up in the summary as "Not covered".

## Claude Project — your notes hub
Set it up once (the app's **Data → Claude Project kit** walks you through it):
1. In Claude: **Projects → New project → "Sales Edge"**.
2. Paste `claude-project/PROJECT-INSTRUCTIONS.md` (or tap **Copy instructions** in the app) into the project's **Instructions**.
3. Add the app's exports to **Project files**: `customers.md`, `my-data.md` (your numbers and price lists), `market-today.md`. Your yearly reports, PDFs or spreadsheets can go here too.
4. Copy the project's link into **Settings → Claude Project link**.

After every call:
**Send to Claude** (copies the call and opens your project) → start a new chat and paste → copy Claude's answer → in the app, **Bring Claude's notes back** → Save.
The follow-ups become checkboxes, the notes show on your glasses, and the "Remember" facts go to the customer's profile, which feeds your talking points next time.
Because every call chat lives in the project, you can ask things like "what did I talk about with Food Lion on 10/12?" or "prep me for my call with Ukrop's."

**Where does data go?** Load it into the **app** (Customers and Data tabs). That's what feeds the live cards on your glasses. Then export it to the **Claude Project** with the kit buttons. Re-export when it changes.

## How "who said it" works
The G2 mics sit on your face, so your voice is much louder than the customer's. The app combines that loudness with the speech service's speaker separation to label each line. It's usually right. Tap a line to fix it, or use "Swap Alan/Customer".

## Getting better over time
- Each call's needs and follow-ups can be saved to the customer ("Save notes to customer"), and they show up as talking points next time.
- Price history builds up daily in `app/public/data/history.json`. That powers the 5-day and 20-day averages and the up/down moves.
- Add more spoken names for cuts in `app/src/intel/lexicon.ts`, and news topics in `pipeline/news-topics.json`.

## Notes
- USDA prices are $/cwt (per 100 lb). The app shows $/lb. Reports update on weekday afternoons, Central time.
- Recording laws: Virginia is one-party consent, but some states require everyone's consent. A quick "mind if I take notes?" covers you.
- This isn't affiliated with USDA, Even Realities, Anthropic or Cargill.
