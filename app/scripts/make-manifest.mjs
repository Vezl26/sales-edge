// Writes app.json for `evenhub pack`, whitelisting the hosts the app talks to.
// DATA_ORIGIN is your GitHub Pages origin (set automatically in the workflow).
import { writeFileSync } from 'node:fs'
const pkg = JSON.parse(await import('node:fs').then(fs => fs.readFileSync('package.json', 'utf8')))
const dataOrigin = process.env.DATA_ORIGIN || ''
const whitelist = [
  'https://api.deepgram.com', 'wss://api.deepgram.com',
  'https://generativelanguage.googleapis.com', 'https://api.groq.com', 'https://api.anthropic.com',
  'https://news.google.com', 'https://cdnjs.cloudflare.com',
  ...(dataOrigin ? [dataOrigin] : []),
]
const manifest = {
  package_id: process.env.PACKAGE_ID || 'com.alanibarra.salesedge',
  edition: '202601',
  name: 'Sales Edge',
  version: pkg.version,
  min_app_version: '2.2.7',
  min_sdk_version: '0.0.12',
  tagline: 'Live sales notes, USDA beef prices and talking points on your lens',
  description: 'Transcribes your sales conversations (you vs customer), pops up current USDA boxed beef prices and conversions when a cut is mentioned, shows customer talking points, and writes clean summaries with real follow-ups.',
  author: process.env.APP_AUTHOR || 'Alan Ibarra',
  entrypoint: 'index.html',
  supported_languages: ['en'],
  permissions: [
    { name: 'g2-microphone', desc: 'Transcribe your sales conversations from the glasses microphones.' },
    { name: 'phone-microphone', desc: 'Optional: transcribe from the phone microphone when the glasses are not connected.' },
    { name: 'network', desc: 'Speech-to-text, USDA market data, news, and optional AI summaries.', whitelist },
  ],
}
writeFileSync('app.json', JSON.stringify(manifest, null, 2) + '\n')
console.log('app.json written; whitelist:', whitelist.join(', '))
