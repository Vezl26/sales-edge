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
- **Ask Claude about a call:** Calls → open the call → **Copy for Claude** → paste it into Claude. Tip: make a Claude Project with your customer files so it always has context.

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
