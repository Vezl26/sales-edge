// PDF -> text in the browser using Mozilla pdf.js, loaded on demand from cdnjs.
const BASE = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/'

let loading: Promise<any> | null = null
function loadPdfJs(): Promise<any> {
  const w = window as any
  if (w.pdfjsLib) return Promise.resolve(w.pdfjsLib)
  loading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = BASE + 'pdf.min.js'
    s.onload = () => {
      const lib = (window as any).pdfjsLib
      if (!lib) return reject(new Error('PDF reader failed to load'))
      lib.GlobalWorkerOptions.workerSrc = BASE + 'pdf.worker.min.js'
      resolve(lib)
    }
    s.onerror = () => reject(new Error('Could not load the PDF reader (no internet?)'))
    document.head.appendChild(s)
  })
  return loading
}

/** Extract text page by page; keeps line breaks where the PDF has them. */
export async function pdfToText(file: File, onProgress?: (page: number, total: number) => void): Promise<string> {
  const lib = await loadPdfJs()
  const pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  const pages: string[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    onProgress?.(i, pdf.numPages)
    const content = await (await pdf.getPage(i)).getTextContent()
    let line = ''
    const lines: string[] = []
    let lastY: number | null = null
    for (const it of content.items as { str: string; transform: number[]; hasEOL?: boolean }[]) {
      const y = Math.round(it.transform[5])
      if (lastY !== null && Math.abs(y - lastY) > 2 && line) { lines.push(line.trim()); line = '' }
      line += (line && !line.endsWith(' ') ? ' ' : '') + it.str
      if (it.hasEOL) { lines.push(line.trim()); line = '' }
      lastY = y
    }
    if (line.trim()) lines.push(line.trim())
    pages.push(lines.filter(Boolean).join('\n'))
  }
  return pages.join('\n\n')
}
