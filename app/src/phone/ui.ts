// Phone screen (the Even app shows this page while the glasses show their own UI).
import type { App } from '../app'
import type { Call, Customer, KnowledgeDoc, Settings } from '../types'
import { uid, importCustomersCsv, parseDelimited, numbersDigest, reportHighlights } from '../kb/knowledge'
import { pdfToText } from '../kb/pdf'
import { CUTS, lexFor } from '../intel/lexicon'
import { bestRow, perLb, money, pct, fmtPct, shortDate, priceCard, cutoutCard, killCard, cattleCard } from '../intel/market'
import { transcriptText, summaryToText, fmtClock } from '../calls/summarize'
import { PROJECT_INSTRUCTIONS, customersFile, docsFile } from '../calls/claude'
import { draftPrep, prepPacket, prepCards, type Prep } from '../prep/prep'
import { AI_PRESETS, aiEnabled } from '../ai/llm'

type Tab = 'live' | 'prep' | 'calls' | 'customers' | 'know' | 'market' | 'settings'

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const $ = <T extends HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel)

export class PhoneUI {
  tab: Tab = 'live'
  openCallId: string | null = null
  editCustomerId: string | null = null
  editPrepId: string | null = null
  callSearch = ''
  marketQuery = ''
  newsTopic = ''
  private root: HTMLElement
  private raf = 0

  constructor(private app: App) {
    this.root = document.querySelector('#app')!
    app.subscribe(() => {
      // Don't wipe half-typed forms; just refresh the toast and header there.
      const formView = this.tab === 'settings' || this.tab === 'know' || (this.tab === 'customers' && !!this.editCustomerId) || (this.tab === 'prep' && !!this.editPrepId)
      if (formView) this.updateChrome()
      else this.schedule()
    })
    this.root.addEventListener('click', e => this.onClick(e))
    this.root.addEventListener('change', e => this.onChange(e))
    this.root.addEventListener('input', e => this.onInput(e))
    this.render()
  }

  private updateChrome() {
    const t = $('.toast', this.root)
    if (this.app.toast) {
      if (t) t.textContent = this.app.toast
      else this.root.insertAdjacentHTML('beforeend', `<div class="toast">${esc(this.app.toast)}</div>`)
    } else t?.remove()
  }

  private schedule() {
    if (this.raf) return
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.render() })
  }

  render() {
    // keep typing focus/scroll when re-rendering live views
    const active = document.activeElement as HTMLInputElement | null
    const focusId = active?.id
    const caret = active && 'selectionStart' in active ? active.selectionStart : null
    const scroller = $('.view', this.root)
    const scroll = scroller?.scrollTop ?? 0
    const atBottom = scroller ? scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40 : true

    this.root.innerHTML = `
      <header class="top">
        <div class="brand">Sales Edge</div>
        <div class="pill ${this.app.session ? 'rec' : ''}">${this.app.session ? '● ' + fmtClock(this.app.session.elapsedMs) : this.app.glasses.available ? 'Glasses ready' : 'Preview mode'}</div>
      </header>
      <main class="view">${this.view()}</main>
      ${this.app.toast ? `<div class="toast">${esc(this.app.toast)}</div>` : ''}
      <nav class="tabs">
        ${this.tabBtn('live', 'Live')}${this.tabBtn('prep', 'Prep')}${this.tabBtn('calls', 'Calls')}${this.tabBtn('customers', 'Clients')}
        ${this.tabBtn('know', 'Data')}${this.tabBtn('market', 'Market')}${this.tabBtn('settings', 'Settings')}
      </nav>`

    const v = $('.view', this.root)!
    if (this.tab === 'live' && this.app.session && atBottom) {
      const tr = $('.transcript', v)
      if (tr) tr.scrollTop = tr.scrollHeight
    }
    v.scrollTop = scroll
    if (focusId) {
      const el = document.getElementById(focusId) as HTMLInputElement | null
      if (el) { el.focus(); if (caret != null) try { el.setSelectionRange(caret, caret) } catch { /* not a text field */ } }
    }
  }

  private tabBtn(t: Tab, label: string) {
    return `<button class="tab ${this.tab === t ? 'on' : ''}" data-tab="${t}">${label}</button>`
  }

  private view(): string {
    switch (this.tab) {
      case 'live': return this.liveView()
      case 'prep': return this.editPrepId ? this.prepEditView() : this.prepListView()
      case 'calls': return this.openCallId ? this.callDetailView() : this.callsView()
      case 'customers': return this.editCustomerId ? this.customerEditView() : this.customersView()
      case 'know': return this.knowView()
      case 'market': return this.marketView()
      case 'settings': return this.settingsView()
    }
  }

  // ---------------- LIVE ----------------
  private liveView(): string {
    const a = this.app
    const s = a.session
    const setupMissing = !a.settings.deepgramKey
    if (!s) {
      const opts = a.kb.customers.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')
      return `
        ${setupMissing ? `<div class="card warn">Add your free Deepgram key in <b>Settings</b> so calls get transcribed.</div>` : ''}
        <div class="card">
          <h2>Start a conversation</h2>
          <label>Customer (optional — it also listens for their name)</label>
          <select id="startCustomer"><option value="">— none —</option>${opts}</select>
          <button class="primary big" data-act="start">● Start listening</button>
          <p class="muted">On the glasses: tap = pause, swipe = flip through cards, double-tap = end &amp; summarize.</p>
        </div>
        ${a.lastEnded ? `<div class="card"><h3>Last call</h3><p>${esc(a.lastEnded.summary?.headline || '')}</p><button data-act="openCall" data-id="${a.lastEnded.id}">Open notes</button></div>` : ''}
        ${this.quickMarket()}`
    }
    const segs = s.call.segments
    const other = s.call.otherLabel || 'Customer'
    const lines = segs.map((g, i) => `<div class="seg ${g.spk}" data-act="flip" data-i="${i}"><span class="who">${g.spk === 'A' ? 'Alan' : g.spk === 'C' ? esc(other) : '?'}</span> ${esc(g.text)}</div>`).join('')
    const cards = [...s.cards].reverse().map(c => `<div class="icard ${c.kind}"><div class="ititle">${esc(c.title)}</div><pre>${esc(c.phone)}</pre></div>`).join('')
    return `
      <div class="card row">
        <div><b>${s.paused ? 'Paused' : s.sttState === 'live' ? 'Listening' : esc(s.sttState)}</b> ${s.sttDetail ? `<span class="muted">${esc(s.sttDetail)}</span>` : ''}<br><span class="muted">${esc(s.call.customerName || 'No customer picked')}</span></div>
        <div class="btns">
          <button data-act="pause">${s.paused ? 'Resume' : 'Pause'}</button>
          <button class="danger" data-act="end">End</button>
        </div>
      </div>
      <div class="card">
        <div class="row"><h3>Transcript</h3><button class="small" data-act="swap">Swap Alan/Customer</button></div>
        <div class="transcript">${lines}${s.interim ? `<div class="seg interim">${esc(s.interim)}</div>` : ''}${!lines && !s.interim ? '<p class="muted">Waiting for speech… (tap a line later to fix who said it)</p>' : ''}</div>
        <label>Customer for this call</label>
        <select id="liveCustomer"><option value="">— none —</option>${a.kb.customers.map(c => `<option value="${c.id}" ${c.id === s.call.customerId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      </div>
      <h3 class="sect">Live cards</h3>
      ${cards || '<p class="muted">Say a cut ("how is strip loin running?"), "cutout", "kill", or a customer/item name.</p>'}`
  }

  private quickMarket(): string {
    const m = this.app.market
    const co = cutoutCard(m)
    const kill = killCard(m)
    if (!co && !kill) return `<div class="card"><p class="muted">Market data not loaded (${esc(m.from)}).</p></div>`
    return `<div class="card"><h3>Today's market</h3><pre>${esc([co?.glass, kill?.glass].filter(Boolean).join('\n\n'))}</pre></div>`
  }

  // ---------------- PREP ----------------
  private prepListView(): string {
    const preps = [...(this.app.kb.preps || [])].sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.updatedAt - a.updatedAt)
    const opts = this.app.kb.customers.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')
    return `
      <div class="card">
        <h2>Prep a meeting</h2>
        <label>Who are you meeting?</label>
        <select id="prepCustomer"><option value="">— not a saved customer —</option>${opts}</select>
        <label>When</label><input id="prepDate" type="date" value="${new Date().toISOString().slice(0, 10)}">
        <label>What's it about? (optional)</label><input id="prepTopic" placeholder="e.g. ground beef issue, holiday ribeye program">
        <button class="primary big" data-act="newPrep">Create prep (auto-drafted)</button>
        <p class="muted">The draft pulls in open follow-ups, last call, what they buy with today's USDA prices, market points, questions to ask and news. You edit it, then it shows on your glasses: swipe through it during the call.</p>
      </div>
      ${preps.map(p => `
        <div class="card click" data-act="editPrep" data-id="${p.id}">
          <div class="row"><b>${esc(p.title)}</b><span class="muted">${p.date ? esc(p.date) : ''}</span></div>
          <div class="muted">${esc(p.notes.replace(/#+\s*/g, '').split('\n').filter(l => l.trim()).slice(1, 3).join(' · ').slice(0, 120))}</div>
        </div>`).join('') || '<p class="muted">No prep notes yet.</p>'}`
  }

  private prepEditView(): string {
    const p = (this.app.kb.preps || []).find(x => x.id === this.editPrepId)
    if (!p) return '<p>Not found</p>'
    const cards = prepCards(p)
    return `
      <button class="small" data-act="back">‹ All preps</button>
      <div class="card form">
        <label>Title</label><input id="p_title" value="${esc(p.title)}">
        <label>Customer</label>
        <select id="p_customer"><option value="">— none —</option>${this.app.kb.customers.map(c => `<option value="${c.id}" ${c.id === p.customerId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
        <label>Date</label><input id="p_date" type="date" value="${esc(p.date || '')}">
        <label>Topic</label><input id="p_topic" value="${esc(p.topic || '')}" placeholder="e.g. ground beef issue">
        <label>My goal for this meeting</label><input id="p_goal" placeholder="e.g. lock holiday ribeye volume" value="${esc((p.notes.match(/## Goal\n- (.+)/)?.[1] || '').replace(/^\(.*\)$/, ''))}">
        <label>Prep notes · each "## Heading" becomes a card on your glasses</label>
        <textarea id="p_notes" rows="18">${esc(p.notes)}</textarea>
        <div class="btns wrap">
          <button class="primary" data-act="savePrep">Save</button>
          <button data-act="redraftPrep">Re-draft</button>
          <button data-act="claudePrep">Prep with Claude</button>
          <button data-act="startPrep">Start call with this</button>
          <button class="danger" data-act="delPrep">Delete</button>
        </div>
        <p class="muted">"Prep with Claude" copies everything and opens your Claude Project. Paste it there, then copy Claude's answer back into the notes box and Save.</p>
      </div>
      <h3 class="sect">How it looks on the glasses (${cards.length} cards, swipe with the ring)</h3>
      ${cards.map(c => `<div class="card icard"><pre>${esc(c.glass)}</pre></div>`).join('')}`
  }

  private readPrepForm(p: Prep) {
    const v = (id: string) => ($<HTMLInputElement>(`#${id}`)?.value ?? '').trim()
    p.title = v('p_title') || p.title
    p.customerId = v('p_customer') || undefined
    p.date = v('p_date') || undefined
    p.topic = v('p_topic') || undefined
    p.notes = ($<HTMLTextAreaElement>('#p_notes')?.value ?? p.notes)
    const goal = v('p_goal')
    if (goal) {
      if (/## Goal\n- .*/.test(p.notes)) p.notes = p.notes.replace(/## Goal\n- .*/, `## Goal\n- ${goal}`)
      else p.notes = `## Goal\n- ${goal}\n\n${p.notes}`
    }
  }

  // ---------------- CALLS ----------------
  private callsView(): string {
    const q = this.callSearch.toLowerCase()
    const list = this.app.index.filter(e => !q || `${e.customerName} ${e.headline} ${new Date(e.startedAt).toLocaleDateString()}`.toLowerCase().includes(q))
    const fu = this.app.recentCalls.flatMap(c => (c.summary?.followUps || []).map((f, i) => ({ c, f, i }))).filter(x => !x.f.done)
    return `
      <input id="callSearch" type="search" placeholder="Search calls (customer, topic, date)" value="${esc(this.callSearch)}">
      ${fu.length ? `<div class="card"><h3>Open follow-ups (${fu.length})</h3>${fu.slice(0, 12).map(x => `
        <label class="check"><input type="checkbox" data-act="fuDone" data-id="${x.c.id}" data-i="${x.i}"> <span><b>${esc(x.f.owner)}:</b> ${esc(x.f.text)}${x.f.due ? ` <em>(${esc(x.f.due)})</em>` : ''}<br><span class="muted">${esc(x.c.customerName || 'Call')} · ${new Date(x.c.startedAt).toLocaleDateString()}</span></span></label>`).join('')}</div>` : ''}
      ${list.map(e => `
        <div class="card click" data-act="openCall" data-id="${e.id}">
          <div class="row"><b>${esc(e.customerName || 'Call')}</b><span class="muted">${new Date(e.startedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · ${Math.max(1, Math.round(e.durationSec / 60))}m</span></div>
          <div class="muted">${esc(e.headline || '')}</div>
        </div>`).join('') || '<p class="muted">No calls yet.</p>'}`
  }

  private callDetailCache: Call | null = null
  private callDetailView(): string {
    const id = this.openCallId!
    const call = this.app.recentCalls.find(c => c.id === id) || (this.callDetailCache?.id === id ? this.callDetailCache : null)
    if (!call) {
      void this.app.getCall(id).then(c => { this.callDetailCache = c; this.schedule() })
      return '<p>Loading…</p>'
    }
    const s = call.summary
    const ai = aiEnabled(this.app.settings)
    return `
      <button class="small" data-act="back">‹ All calls</button>
      <div class="card">
        <h2>${esc(call.customerName || 'Call')}</h2>
        <p class="muted">${new Date(call.startedAt).toLocaleString()} · ${fmtClock((call.endedAt ?? call.startedAt) - call.startedAt)}</p>
        <label>Customer</label>
        <select data-field="callCustomer" data-id="${call.id}"><option value="">— none —</option>${this.app.kb.customers.map(c => `<option value="${c.id}" ${c.id === call.customerId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
        <div class="btns wrap">
          <button class="primary" data-act="sendClaude" data-id="${call.id}">Send to Claude</button>
          <button data-act="shareClaude" data-id="${call.id}">Share sheet…</button>
          <button data-act="share" data-id="${call.id}">Share notes</button>
          ${ai ? `<button data-act="aiSum" data-id="${call.id}">AI summary</button>` : ''}
          ${call.customerId ? `<button data-act="learn" data-id="${call.id}">Save notes to customer</button>` : ''}
        </div>
        <p class="muted">${this.app.settings.claudeProjectUrl ? '"Send to Claude" copies the call and opens your Claude Project. Paste it into a new chat there.' : 'Tip: add your Claude Project link in Settings so "Send to Claude" opens it directly. For now it copies the call and opens Claude.'}</p>
      </div>
      <div class="card">
        <h3>Bring Claude's notes back</h3>
        <p class="muted">Copy Claude's answer and paste it here. Follow-ups become checkboxes, the notes show on your glasses, and "Remember" facts are saved to the customer.</p>
        <textarea id="claudeBack" rows="4" placeholder="Paste Claude's summary here"></textarea>
        <button data-act="saveClaude" data-id="${call.id}">Save Claude's notes</button>
      </div>
      ${s ? `<div class="card"><h3>Summary ${s.generatedBy === 'ai' ? '(AI)' : '(automatic)'}</h3><pre>${esc(summaryToText(s))}</pre>
        ${s.followUps.length ? `<h3>Follow-ups</h3>${s.followUps.map((f, i) => `<label class="check"><input type="checkbox" data-act="fuDone" data-id="${call.id}" data-i="${i}" ${f.done ? 'checked' : ''}> <span><b>${esc(f.owner)}:</b> ${esc(f.text)}${f.due ? ` (${esc(f.due)})` : ''}</span></label>`).join('')}` : ''}
      </div>` : ''}
      <div class="card"><h3>My notes</h3><textarea data-field="callNotes" data-id="${call.id}" rows="3" placeholder="Anything to add…">${esc(call.notes || '')}</textarea></div>
      <div class="card"><h3>Transcript</h3>
        ${call.segments.map((g, i) => `<div class="seg ${g.spk}" data-act="flipSaved" data-id="${call.id}" data-i="${i}"><span class="who">${fmtClock(g.t)} ${g.spk === 'A' ? 'Alan' : g.spk === 'C' ? esc(call.otherLabel || 'Customer') : '?'}</span> ${esc(g.text)}</div>`).join('') || '<p class="muted">Empty</p>'}
        <p class="muted">Tap a line to switch who said it.</p>
      </div>
      ${call.cards.length ? `<div class="card"><h3>Cards shown</h3>${call.cards.map(c => `<details><summary>${fmtClock(c.t)} ${esc(c.title)}</summary><pre>${esc(c.body)}</pre></details>`).join('')}</div>` : ''}
      <button class="danger" data-act="delCall" data-id="${call.id}">Delete call</button>`
  }

  // ---------------- CUSTOMERS ----------------
  private customersView(): string {
    return `
      <div class="btns wrap"><button class="primary" data-act="newCustomer">+ Add customer</button>
      <label class="filebtn">Import CSV<input type="file" accept=".csv,.tsv,.txt,text/*" data-act="importCustomers" hidden></label></div>
      <p class="muted">CSV columns it understands: Customer, Item, Volume, Price, Contact, Segment, Notes. One row per customer-item.</p>
      ${this.app.kb.customers.sort((a, b) => a.name.localeCompare(b.name)).map(c => `
        <div class="card click" data-act="editCustomer" data-id="${c.id}">
          <b>${esc(c.name)}</b> ${c.segment ? `<span class="muted">· ${esc(c.segment)}</span>` : ''}
          <div class="muted">${esc(c.items.slice(0, 4).map(i => i.name).join(', '))}${c.items.length > 4 ? '…' : ''}</div>
        </div>`).join('') || '<p class="muted">No customers yet.</p>'}`
  }

  private customerEditView(): string {
    const c = this.app.kb.customers.find(x => x.id === this.editCustomerId)
    if (!c) return '<p>Not found</p>'
    const items = c.items.map(i => [i.name, i.volume, i.price, i.notes].map(x => x ?? '').join(' | ').replace(/( \| )+$/, '')).join('\n')
    const calls = this.app.index.filter(e => e.customerName === c.name).slice(0, 8)
    return `
      <button class="small" data-act="back">‹ Customers</button>
      <div class="card form">
        <label>Name</label><input id="c_name" value="${esc(c.name)}">
        <label>Other names they go by (comma separated)</label><input id="c_aliases" value="${esc(c.aliases.join(', '))}">
        <label>Contact / buyer</label><input id="c_contact" value="${esc(c.contact || '')}">
        <label>Segment</label><input id="c_segment" value="${esc(c.segment || '')}" placeholder="Retail, foodservice, distributor…">
        <label>Location</label><input id="c_location" value="${esc(c.location || '')}">
        <label>What they buy — one per line: item | volume | price | note</label>
        <textarea id="c_items" rows="6" placeholder="180 strips | 2,000 lb/wk | $9.40 | Choice only&#10;Deli turkey breast | 40 cs/wk">${esc(items)}</textarea>
        <label>Notes</label><textarea id="c_notes" rows="4">${esc(c.notes)}</textarea>
        <label>Learned from calls (one per line)</label><textarea id="c_learned" rows="4">${esc(c.learned.join('\n'))}</textarea>
        <div class="btns"><button class="primary" data-act="saveCustomer">Save</button><button class="danger" data-act="delCustomer">Delete</button></div>
      </div>
      ${calls.length ? `<div class="card"><h3>Calls</h3>${calls.map(e => `<div class="click" data-act="openCall" data-id="${e.id}">${new Date(e.startedAt).toLocaleDateString()} — ${esc(e.headline || '')}</div>`).join('')}</div>` : ''}`
  }

  // ---------------- DATA (knowledge) ----------------
  private knowView(): string {
    const docs = this.app.kb.docs
    const s = this.app.settings
    return `
      <div class="card">
        <h2>Claude Project kit</h2>
        <p class="muted">Your one place to talk with Claude about customers and calls. Set it up once:</p>
        <ol class="steps">
          <li>In the Claude app: <b>Projects → New project</b>. Name it "Sales Edge".</li>
          <li>Open the project's <b>Instructions</b> and paste: <button class="small" data-act="copyInstr">Copy instructions</button></li>
          <li>In <b>Project files</b>, add these (tap, then save/paste them as files):<br>
            <button class="small" data-act="kit" data-k="customers">customers.md</button>
            <button class="small" data-act="kit" data-k="data">my-data.md</button>
            <button class="small" data-act="kit" data-k="market">market-today.md</button></li>
          <li>Copy the project's link (Share → Copy link, or from the browser) into <b>Settings → Claude Project link</b>.</li>
        </ol>
        <p class="muted">After that, every call: <b>Send to Claude</b> → paste → copy Claude's answer → <b>Bring Claude's notes back</b>. Re-export the files above when your data changes.</p>
        ${s.claudeProjectUrl ? `<a class="btnlink" href="${esc(s.claudeProjectUrl)}" target="_blank" rel="noopener">Open my Claude Project</a>` : ''}
      </div>
      <div class="card form">
        <h2>Feed it your data</h2>
        <p class="muted">Your yearly/monthly numbers, price lists (deli, chocolate, prepared foods), Cargill news, notes. Stays on your phone only.</p>
        <label>Title</label><input id="d_title" placeholder="e.g. 2026 YTD by customer">
        <label>Type</label>
        <select id="d_kind"><option value="report">Weekly report (newest = current)</option><option value="numbers">My numbers</option><option value="pricing">Price list</option><option value="news">News / company updates</option><option value="notes">Notes</option><option value="other">Other</option></select>
        <label>Week of (for weekly reports)</label><input id="d_asof" type="date" value="${new Date().toISOString().slice(0, 10)}">
        <label>Paste text or CSV</label><textarea id="d_text" rows="6" placeholder="Paste here, or upload a file below"></textarea>
        <div class="btns wrap"><button class="primary" data-act="addDoc">Save</button>
        <label class="filebtn">Upload file<input type="file" accept=".pdf,application/pdf,.csv,.tsv,.txt,.md,.json,text/*" data-act="uploadDoc" hidden></label></div>
        <p class="muted">PDFs (like your weekly outlook) upload directly. Excel: "Save As CSV" first.</p>
      </div>
      ${docs.map(d => `
        <div class="card">
          <div class="row"><b>${esc(d.title)}${d.id === this.app.latestReport()?.id ? ' <span class="pill rec">CURRENT</span>' : ''}</b><span class="muted">${esc(d.kind)}${d.asOf ? ` · week of ${esc(d.asOf)}` : ''} · ${new Date(d.addedAt).toLocaleDateString()}</span></div>
          ${d.table ? `<p class="muted">${d.table.rows.length} rows · columns: ${esc(d.table.headers.join(', '))}</p>` : `<p class="muted">${esc(d.text.slice(0, 140))}${d.text.length > 140 ? '…' : ''}</p>`}
          ${d.kind === 'numbers' || (d.kind === 'report' && d.table) ? `<pre>${esc(numbersDigest(d).join('\n'))}</pre>` : d.kind === 'report' ? `<pre>${esc(reportHighlights(d.text).join('\n\n'))}</pre>` : ''}
          <div class="btns"><button class="small" data-act="copyDoc" data-id="${d.id}">Copy for Claude</button><button class="small danger" data-act="delDoc" data-id="${d.id}">Delete</button></div>
        </div>`).join('')}
      <div class="card">
        <h3>Backup</h3>
        <p class="muted">Export everything (customers, data, calls) to a file you keep. Import restores it.</p>
        <div class="btns wrap"><button data-act="export">Export backup</button><label class="filebtn">Import backup<input type="file" accept=".json" data-act="importBackup" hidden></label></div>
      </div>`
  }

  // ---------------- MARKET ----------------
  private marketView(): string {
    const m = this.app.market
    const s = this.app.settings
    const beef = m.beef
    const q = this.marketQuery.toLowerCase()
    const rows = beef ? CUTS.flatMap(c => ['Choice', 'Select'].map(g => bestRow(beef, c.imps, g))).filter(r => r && (r.wavg ?? 0) > 0)
      .filter(r => !q || `${r!.imps} ${r!.desc} ${lexFor(r!.imps)?.names.join(' ')}`.toLowerCase().includes(q)) : []
    const news = (m.news?.items || []).filter(n => !this.newsTopic || n.topics.includes(this.newsTopic)).slice(0, 40)
    return `
      <div class="card"><div class="row"><h3>USDA ${beef ? shortDate(beef.reportDate) : ''}</h3><button class="small" data-act="refresh">Refresh</button></div>
        <pre>${esc([cutoutCard(m)?.phone, killCard(m)?.phone, cattleCard(m)?.phone].filter(Boolean).join('\n\n') || 'No data')}</pre>
        <p class="muted">Source: ${esc(beef?.source || '—')} · loaded from ${esc(m.from)}</p></div>
      <input id="marketQuery" type="search" placeholder="Find a cut (strip, 189A, brisket…)" value="${esc(this.marketQuery)}">
      <div class="card"><table class="cuts"><tr><th>Cut</th><th>Gr</th><th>$/lb</th><th>d/d</th></tr>
        ${rows.map(r => `<tr data-act="cutCard" data-imps="${r!.imps}" data-grade="${r!.grade}"><td>${esc(r!.imps)} ${esc(lexFor(r!.imps)?.label)}</td><td>${r!.grade[0]}</td><td>${money(perLb(r!.wavg))}</td><td>${fmtPct(pct(r!.wavg, r!.prev))}</td></tr>`).join('')}
      </table><p class="muted">Tap a row for conversions and questions. Default grade: ${s.defaultGrade}.</p></div>
      <div id="cutDetail"></div>
      <h3 class="sect">News</h3>
      <select id="newsTopic"><option value="">All topics</option>${(m.news?.topics || []).map(t => `<option value="${t.id}" ${t.id === this.newsTopic ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select>
      ${news.map(n => `<a class="card news" href="${esc(n.link)}" target="_blank" rel="noopener"><b>${esc(n.title)}</b><div class="muted">${esc(n.source)} · ${new Date(n.date).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric' })}</div></a>`).join('') || '<p class="muted">No news yet.</p>'}`
  }

  private cutTable(): string {
    const beef = this.app.market.beef
    if (!beef) return '(none)'
    const rows = ['| IMPS | Cut | Grade | $/lb | Low | High | Lbs traded |', '|---|---|---|---|---|---|---|']
    for (const c of CUTS) for (const g of ['Choice', 'Select']) {
      const r = bestRow(beef, c.imps, g)
      if (r && (r.wavg ?? 0) > 0) rows.push(`| ${r.imps} | ${c.label} | ${g} | ${money(perLb(r.wavg))} | ${money(perLb(r.low))} | ${money(perLb(r.high))} | ${(r.lbs ?? 0).toLocaleString()} |`)
    }
    return rows.join('\n')
  }

  // ---------------- SETTINGS ----------------
  private settingsView(): string {
    const s = this.app.settings
    const st = this.app.market
    return `
      <div class="card form">
        <h2>Transcription</h2>
        <label>Deepgram API key <a href="https://console.deepgram.com/signup" target="_blank" rel="noopener">(free signup)</a></label>
        <input id="s_deepgram" type="password" value="${esc(s.deepgramKey)}" placeholder="paste key">
        <label>Microphone</label>
        <select id="s_mic"><option value="glasses" ${s.micSource === 'glasses' ? 'selected' : ''}>Glasses (recommended)</option><option value="phone" ${s.micSource === 'phone' ? 'selected' : ''}>Phone</option></select>
        <label>Voice check (teaches it what YOUR voice sounds like at the mic)</label>
        <div class="row"><span class="muted">${s.alanLevelDb != null ? `Calibrated: ${s.alanLevelDb} dB` : 'Not calibrated'}</span><button data-act="calibrate">Start 6-sec voice check</button></div>
        <label>Your first name</label><input id="s_name" value="${esc(s.myName)}">
      </div>
      <div class="card form">
        <h2>Prices</h2>
        <label>Default grade</label>
        <select id="s_grade"><option ${s.defaultGrade === 'Choice' ? 'selected' : ''}>Choice</option><option ${s.defaultGrade === 'Select' ? 'selected' : ''}>Select</option></select>
        <label>Case weights for case pricing — one per line: IMPS = lb (e.g. 180 = 60)</label>
        <textarea id="s_cases" rows="4">${esc(Object.entries(s.caseWeights).map(([k, v]) => `${k} = ${v}`).join('\n'))}</textarea>
      </div>
      <div class="card form">
        <h2>Optional AI (off = 100% free)</h2>
        <p class="muted">Without this, you still get automatic notes plus "Copy for Claude". With a free Gemini or Groq key, summaries happen in the app.</p>
        <label>Preset</label>
        <select id="s_preset"><option value="">— choose —</option>${AI_PRESETS.map((p, i) => `<option value="${i}">${esc(p.label)}</option>`).join('')}<option value="off">Turn AI off</option></select>
        <label>Provider</label>
        <select id="s_aiProvider"><option value="none" ${s.aiProvider === 'none' ? 'selected' : ''}>Off</option><option value="openai-compatible" ${s.aiProvider === 'openai-compatible' ? 'selected' : ''}>OpenAI-compatible (Gemini, Groq…)</option><option value="anthropic" ${s.aiProvider === 'anthropic' ? 'selected' : ''}>Claude API</option></select>
        <label>Base URL</label><input id="s_aiBase" value="${esc(s.aiBaseUrl)}">
        <label>Model</label><input id="s_aiModel" value="${esc(s.aiModel)}">
        <label>API key</label><input id="s_aiKey" type="password" value="${esc(s.aiKey)}">
      </div>
      <div class="card form">
        <h2>Claude</h2>
        <label>Claude Project link</label>
        <input id="s_claude" value="${esc(s.claudeProjectUrl)}" placeholder="https://claude.ai/project/…">
      </div>
      <div class="card form">
        <h2>Market data link</h2>
        <label>Data URL (leave blank to use the built-in link)</label>
        <input id="s_data" value="${esc(s.dataBaseUrl)}" placeholder="https://YOURNAME.github.io/sales-edge/data/">
        <p class="muted">Loaded from: ${esc(st.from)} · USDA report ${esc(st.beef?.reportDate || '—')} · news ${st.news?.updatedAt ? new Date(st.news.updatedAt).toLocaleString() : '—'}</p>
      </div>
      <button class="primary big" data-act="saveSettings">Save settings</button>`
  }

  // ---------------- events ----------------
  private async onClick(e: Event) {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-tab],[data-act]')
    if (!el) return
    const a = this.app
    if (el.dataset.tab) {
      this.tab = el.dataset.tab as Tab
      this.openCallId = null; this.editCustomerId = null; this.editPrepId = null
      this.render(); return
    }
    const act = el.dataset.act!
    const id = el.dataset.id
    if (el instanceof HTMLInputElement && el.type === 'file') return
    switch (act) {
      case 'start': {
        const cid = ($<HTMLSelectElement>('#startCustomer')?.value) || ''
        await a.startCall(a.customerById(cid))
        break
      }
      case 'pause': a.togglePause(); break
      case 'end': await a.endCall(); this.tab = 'calls'; this.openCallId = a.lastEnded?.id ?? null; this.render(); break
      case 'swap': a.session?.swapAll(); break
      case 'flip': a.session?.flip(Number(el.dataset.i)); break
      case 'openCall': this.tab = 'calls'; this.openCallId = id!; this.render(); break
      case 'back': this.openCallId = null; this.editCustomerId = null; this.editPrepId = null; this.render(); break
      case 'flipSaved': {
        const call = await a.getCall(id!)
        const g = call?.segments[Number(el.dataset.i)]
        if (call && g) { g.spk = g.spk === 'A' ? 'C' : 'A'; g.manual = true; await a.updateCall(call) }
        break
      }
      case 'sendClaude': {
        const call = a.recentCalls.find(c => c.id === id) || this.callDetailCache
        if (!call) break
        const text = a.packetFor(call)
        const target = a.settings.claudeProjectUrl || 'https://claude.ai/new'
        // Copy and open in the same tap (iOS blocks pop-ups after an await).
        copySync(text)
        window.open(target, '_blank')
        a.notify('Copied. In Claude: start a new chat and paste.')
        break
      }
      case 'shareClaude': {
        const call = await a.getCall(id!)
        if (!call) break
        const text = a.packetFor(call)
        const name = `call-${new Date(call.startedAt).toISOString().slice(0, 10)}-${(call.customerName || 'customer').replace(/\W+/g, '-').toLowerCase()}.txt`
        if (!(await shareText(name, text))) { await copy(text); a.notify('Sharing not available here, so I copied it instead') }
        break
      }
      case 'saveClaude': {
        const text = ($<HTMLTextAreaElement>('#claudeBack')?.value || '').trim()
        if (!text) { a.notify("Paste Claude's answer first"); break }
        const r = await a.applyClaudeNotes(id!, text)
        a.notify(`Saved: ${r.followUps} follow-ups${r.remembered ? `, ${r.remembered} facts saved to the customer` : ''}`)
        this.callDetailCache = null
        this.render()
        break
      }
      case 'copyInstr': if (await copy(PROJECT_INSTRUCTIONS)) a.notify('Instructions copied, paste them into the Project'); break
      case 'kit': {
        const k = el.dataset.k
        const files: Record<string, [string, () => string]> = {
          customers: ['customers.md', () => customersFile(a.kb)],
          data: ['my-data.md', () => docsFile(a.kb.docs, "Alan's numbers, price lists and notes")],
          market: ['market-today.md', () => `# Market snapshot\nUSDA data as of ${a.market.beef?.reportDate ?? '?'}\n\n${a.marketContext()}\n\n## Choice cut prices ($/lb)\n${this.cutTable()}`],
        }
        const f = files[k!]
        if (!f) break
        const [name, make] = f
        if (!(await shareText(name, make(), true))) { await copy(make()); a.notify(`${name} copied. Paste it into Project files as text.`) }
        break
      }
      case 'share': {
        const call = await a.getCall(id!)
        if (!call) break
        const text = `${call.summary ? summaryToText(call.summary) : ''}\n\n---\n${transcriptText(call)}`
        if (navigator.share) { try { await navigator.share({ title: call.summary?.headline || 'Call notes', text }) } catch { /* cancelled */ } }
        else if (await copy(text)) a.notify('Copied notes')
        break
      }
      case 'aiSum': a.notify('Summarizing…'); await a.aiSummarize(id!); break
      case 'learn': {
        const call = await a.getCall(id!)
        const c = a.customerById(call?.customerId)
        if (!call || !c || !call.summary) break
        const date = new Date(call.startedAt).toLocaleDateString()
        const facts = [...call.summary.customerNeeds.slice(0, 2).map(n => `${date}: needs — ${n}`), ...call.summary.followUps.filter(f => !f.done).slice(0, 2).map(f => `${date}: ${f.owner} to ${f.text}`)]
        c.learned = [...c.learned, ...facts.filter(f => !c.learned.includes(f))].slice(-30)
        c.updatedAt = Date.now()
        await a.saveKB(); a.notify(`Saved ${facts.length} notes to ${c.name}`)
        break
      }
      case 'fuDone': {
        const call = await a.getCall(id!)
        const f = call?.summary?.followUps[Number(el.dataset.i)]
        if (call && f) { f.done = (el as HTMLInputElement).checked; await a.updateCall(call) }
        break
      }
      case 'delCall': if (confirm('Delete this call?')) { await a.removeCall(id!); this.openCallId = null; this.render() } break
      case 'newPrep': {
        const c = a.customerById($<HTMLSelectElement>('#prepCustomer')?.value || '')
        const date = $<HTMLInputElement>('#prepDate')?.value || undefined
        const topic = ($<HTMLInputElement>('#prepTopic')?.value || '').trim() || undefined
        const title = [c?.name, topic].filter(Boolean).join(' · ') || 'Meeting'
        const p: Prep = { id: uid(), customerId: c?.id, title, date, topic, notes: draftPrep(c, a.recentCalls, a.market, a.settings.defaultGrade, { topic, kb: a.kb, latestReport: a.latestReportBrief() }), createdAt: Date.now(), updatedAt: Date.now() }
        await a.savePrep(p); this.editPrepId = p.id; this.render()
        break
      }
      case 'editPrep': this.editPrepId = id!; this.render(); break
      case 'savePrep': case 'redraftPrep': case 'claudePrep': case 'startPrep': {
        const p = (a.kb.preps || []).find(x => x.id === this.editPrepId)
        if (!p) break
        this.readPrepForm(p)
        const c = a.customerById(p.customerId)
        if (act === 'redraftPrep') {
          if (!confirm('Replace the notes with a fresh draft?')) break
          const goal = p.notes.match(/## Goal\n- (.+)/)?.[1]
          p.notes = draftPrep(c, a.recentCalls, a.market, a.settings.defaultGrade, { topic: p.topic, kb: a.kb, latestReport: a.latestReportBrief() })
          if (goal && !/^\(/.test(goal)) p.notes = p.notes.replace(/## Goal\n- .*/, `## Goal\n- ${goal}`)
        }
        if (act === 'claudePrep') {
          const goal = (p.notes.match(/## Goal\n- (.+)/)?.[1] || '').replace(/^\(.*\)$/, '')
          copySync(prepPacket(c, a.recentCalls, p.notes, a.marketContext(), goal, p.topic))
          window.open(a.settings.claudeProjectUrl || 'https://claude.ai/new', '_blank')
          a.notify('Copied. Paste it in Claude, then paste the answer back here.')
        }
        await a.savePrep(p)
        if (act === 'startPrep') { await a.startCall(c, p); this.tab = 'live'; this.editPrepId = null }
        else if (act !== 'claudePrep') a.notify('Saved')
        this.render()
        break
      }
      case 'delPrep': if (confirm('Delete this prep?')) { await a.deletePrep(this.editPrepId!); this.editPrepId = null; this.render() } break
      case 'newCustomer': {
        const c: Customer = { id: uid(), name: 'New customer', aliases: [], items: [], notes: '', learned: [], updatedAt: Date.now() }
        a.kb.customers.push(c); await a.saveKB(); this.editCustomerId = c.id; this.render()
        break
      }
      case 'editCustomer': this.editCustomerId = id!; this.render(); break
      case 'saveCustomer': this.saveCustomer(); break
      case 'delCustomer': if (confirm('Delete this customer?')) { a.kb.customers = a.kb.customers.filter(c => c.id !== this.editCustomerId); await a.saveKB(); this.editCustomerId = null; this.render() } break
      case 'addDoc': await this.addDoc(); break
      case 'delDoc': if (confirm('Delete?')) { a.kb.docs = a.kb.docs.filter(d => d.id !== id); await a.saveKB(); this.render() } break
      case 'copyDoc': { const d = a.kb.docs.find(x => x.id === id); if (d && await copy(`${d.title}\n\n${d.text}`)) a.notify('Copied'); break }
      case 'export': await this.exportBackup(); break
      case 'refresh': a.notify('Refreshing…'); await a.refreshMarket(); break
      case 'cutCard': {
        const card = priceCard(a.market, a.settings, el.dataset.imps!, el.dataset.grade)
        const box = $('#cutDetail')
        if (card && box) { box.innerHTML = `<div class="card icard"><div class="ititle">${esc(card.title)}</div><pre>${esc(card.phone)}</pre></div>`; box.scrollIntoView({ behavior: 'smooth' }) }
        break
      }
      case 'calibrate': {
        a.notify('Talk normally for 6 seconds…')
        try { const db = await a.calibrateVoice(); a.notify(db != null ? `Voice level saved (${db.toFixed(1)} dB)` : 'Did not hear enough speech — try again'); this.render() }
        catch (err) { a.notify((err as Error).message) }
        break
      }
      case 'saveSettings': await this.saveSettings(); break
    }
  }

  private async onChange(e: Event) {
    const el = e.target as HTMLInputElement | HTMLSelectElement
    const a = this.app
    if (el instanceof HTMLInputElement && el.type === 'file' && el.files?.[0]) {
      const file = el.files[0]
      let text: string
      if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
        try { text = await pdfToText(file, (i, n) => a.notify(`Reading PDF… page ${i}/${n}`)) }
        catch (err) { a.notify((err as Error).message); el.value = ''; return }
        if (!text.trim()) { a.notify('That PDF has no readable text (scanned image?)'); el.value = ''; return }
      } else text = await file.text()
      if (el.dataset.act === 'importCustomers') {
        const n = importCustomersCsv(a.kb, text); await a.saveKB(); a.notify(`Imported — ${n} new customers`)
      } else if (el.dataset.act === 'uploadDoc') {
        const title = ($<HTMLInputElement>('#d_title')?.value || file.name).trim()
        const kind = ($<HTMLSelectElement>('#d_kind')?.value || 'other') as KnowledgeDoc['kind']
        this.pushDoc(title, kind, text); await a.saveKB(); a.notify(`Saved ${file.name}`); this.render()
      } else if (el.dataset.act === 'importBackup') {
        await this.importBackup(text)
      }
      el.value = ''
      return
    }
    if (el.id === 'liveCustomer' && a.session) {
      const c = a.customerById(el.value)
      a.session.call.customerId = c?.id
      a.session.call.customerName = c?.name
      a.session.call.otherLabel = c?.name
      a.engine.customer = c
      if (c) { const card = a.engine.customerCard(c); if (card) a.session.addCard(card) }
      a.emit()
    }
    if (el.dataset.field === 'callCustomer') {
      const call = await a.getCall(el.dataset.id!)
      const c = a.customerById(el.value)
      if (call) { call.customerId = c?.id; call.customerName = c?.name; call.otherLabel = c?.name; await a.updateCall(call) }
    }
    if (el.dataset.field === 'callNotes') {
      const call = await a.getCall(el.dataset.id!)
      if (call) { call.notes = el.value; await a.updateCall(call) }
    }
    if (el.id === 'newsTopic') { this.newsTopic = el.value; this.render() }
    if (el.id === 's_preset') {
      if (el.value === 'off') { ($<HTMLSelectElement>('#s_aiProvider')!).value = 'none'; return }
      const p = AI_PRESETS[Number(el.value)]
      if (!p) return
      $<HTMLSelectElement>('#s_aiProvider')!.value = p.provider
      $<HTMLInputElement>('#s_aiBase')!.value = p.baseUrl
      $<HTMLInputElement>('#s_aiModel')!.value = p.model
    }
  }

  private onInput(e: Event) {
    const el = e.target as HTMLInputElement
    if (el.id === 'callSearch') { this.callSearch = el.value; this.schedule() }
    if (el.id === 'marketQuery') { this.marketQuery = el.value; this.schedule() }
  }

  private async saveCustomer() {
    const a = this.app
    const c = a.kb.customers.find(x => x.id === this.editCustomerId)
    if (!c) return
    const v = (id: string) => ($<HTMLInputElement>(`#${id}`)?.value ?? '').trim()
    c.name = v('c_name') || c.name
    c.aliases = v('c_aliases').split(',').map(x => x.trim()).filter(Boolean)
    c.contact = v('c_contact'); c.segment = v('c_segment'); c.location = v('c_location')
    c.items = v('c_items').split('\n').map(l => l.split('|').map(x => x.trim())).filter(p => p[0])
      .map(([name, volume, price, notes]) => ({ name, volume: volume || undefined, price: price || undefined, notes: notes || undefined }))
    c.notes = ($<HTMLTextAreaElement>('#c_notes')?.value ?? '').trim()
    c.learned = ($<HTMLTextAreaElement>('#c_learned')?.value ?? '').split('\n').map(x => x.trim()).filter(Boolean)
    c.updatedAt = Date.now()
    await a.saveKB()
    a.notify('Saved')
  }

  private pushDoc(title: string, kind: KnowledgeDoc['kind'], text: string) {
    const table = parseDelimited(text) ?? undefined
    const asOf = kind === 'report' ? ($<HTMLInputElement>('#d_asof')?.value || new Date().toISOString().slice(0, 10)) : undefined
    this.app.kb.docs.unshift({ id: uid(), title: title || 'Untitled', kind, asOf, text: text.slice(0, 400_000), addedAt: Date.now(), table: table && table.headers.length > 1 ? table : undefined })
  }

  private async addDoc() {
    const title = ($<HTMLInputElement>('#d_title')?.value || '').trim()
    const kind = ($<HTMLSelectElement>('#d_kind')?.value || 'other') as KnowledgeDoc['kind']
    const text = ($<HTMLTextAreaElement>('#d_text')?.value || '').trim()
    if (!text) { this.app.notify('Paste something first'); return }
    this.pushDoc(title, kind, text)
    await this.app.saveKB()
    this.app.notify('Saved')
    this.render()
  }

  private async saveSettings() {
    const v = (id: string) => ($<HTMLInputElement>(`#${id}`)?.value ?? '').trim()
    const cases: Record<string, number> = {}
    for (const l of v('s_cases').split('\n')) {
      const m = l.match(/^\s*(\w+)\s*[=:]\s*([\d.]+)/)
      if (m) cases[m[1].toUpperCase()] = Number(m[2])
    }
    const patch: Partial<Settings> = {
      deepgramKey: v('s_deepgram'), micSource: v('s_mic') as Settings['micSource'], myName: v('s_name') || 'Alan',
      defaultGrade: v('s_grade') as Settings['defaultGrade'], caseWeights: cases,
      aiProvider: v('s_aiProvider') as Settings['aiProvider'], aiBaseUrl: v('s_aiBase'), aiModel: v('s_aiModel'), aiKey: v('s_aiKey'),
      dataBaseUrl: v('s_data'), claudeProjectUrl: v('s_claude'),
    }
    const dataChanged = patch.dataBaseUrl !== this.app.settings.dataBaseUrl
    await this.app.saveSettings(patch)
    if (dataChanged) await this.app.refreshMarket()
    this.app.notify('Settings saved')
    this.render()
  }

  private async exportBackup() {
    const a = this.app
    const calls = await Promise.all(a.index.map(e => a.getCall(e.id)))
    const blob = JSON.stringify({ app: 'sales-edge', version: 1, exportedAt: new Date().toISOString(), kb: a.kb, calls: calls.filter(Boolean), settings: { ...a.settings, deepgramKey: '', aiKey: '' } })
    const name = `sales-edge-backup-${new Date().toISOString().slice(0, 10)}.json`
    try {
      const file = new File([blob], name, { type: 'application/json' })
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: name }); return }
    } catch { /* fall through */ }
    if (await copy(blob)) a.notify('Backup copied to clipboard (paste into Notes/Files)')
  }

  private async importBackup(text: string) {
    const a = this.app
    try {
      const j = JSON.parse(text)
      if (j.app !== 'sales-edge') throw new Error('Not a Sales Edge backup')
      if (!confirm(`Restore ${j.kb?.customers?.length ?? 0} customers, ${j.kb?.docs?.length ?? 0} docs and ${j.calls?.length ?? 0} calls? This merges with what is here.`)) return
      for (const c of j.kb.customers || []) if (!a.kb.customers.some(x => x.id === c.id)) a.kb.customers.push(c)
      for (const d of j.kb.docs || []) if (!a.kb.docs.some(x => x.id === d.id)) a.kb.docs.push(d)
      await a.saveKB()
      for (const call of j.calls || []) await a.updateCall(call)
      await a.loadRecentCalls()
      a.notify('Backup restored')
    } catch (e) { a.notify(`Import failed: ${(e as Error).message}`) }
  }
}

function copySync(text: string) {
  try { void navigator.clipboard.writeText(text).catch(() => fallbackCopy(text)) } catch { fallbackCopy(text) }
}
function fallbackCopy(text: string): boolean {
  try {
    const ta = document.createElement('textarea')
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta); ta.select()
    const ok = document.execCommand('copy'); ta.remove(); return ok
  } catch { return false }
}

/** iOS share sheet (pick the Claude app, Files, Notes…). Returns false if unavailable. */
async function shareText(name: string, text: string, asFile = false): Promise<boolean> {
  if (!navigator.share) return false
  try {
    if (asFile || text.length > 3000) {
      const file = new File([text], name, { type: name.endsWith('.md') ? 'text/markdown' : 'text/plain' })
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: name }); return true }
    }
    await navigator.share({ title: name, text })
    return true
  } catch (e) {
    return (e as Error)?.name === 'AbortError' // user cancelled = handled
  }
}

async function copy(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true } catch { /* fallback */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta); ta.select()
    const ok = document.execCommand('copy'); ta.remove(); return ok
  } catch { return false }
}
