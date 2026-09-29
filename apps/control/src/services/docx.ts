import { zipSync } from 'fflate'

/**
 * Minimal, dependency-free Markdown → .docx writer.
 *
 * It emits a valid OOXML package (Content_Types + relationships + styles +
 * document) so reports produced as Markdown/HTML anywhere in the pipeline can
 * be handed to users as Word files. Chinese is handled by declaring an East
 * Asian font on the default style, which is what makes Word/WPS render CJK
 * without the "????" fallback.
 */
export function markdownToDocx(markdown: string, title: string): Uint8Array {
  const body = renderBody(markdown)
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': bytes(contentTypes()),
    '_rels/.rels': bytes(rootRels()),
    'word/_rels/document.xml.rels': bytes(documentRels()),
    'word/styles.xml': bytes(styles()),
    'word/document.xml': bytes(document(title, body)),
  }
  return zipSync(files, { level: 6 })
}

function renderBody(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''
    index += 1

    // Fenced code block
    if (/^\s*```/.test(line)) {
      const code: string[] = []
      while (index < lines.length && !/^\s*```/.test(lines[index] ?? '')) {
        code.push(lines[index] ?? '')
        index += 1
      }
      index += 1
      for (const codeLine of code) {
        out.push(paragraph(escape(codeLine), { style: 'Code', font: 'Consolas', size: 18 }))
      }
      continue
    }

    // Table
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|[-\s|:]+\|\s*$/.test(lines[index] ?? '')) {
      const header = splitRow(line)
      index += 1 // alignment row
      const rows: string[][] = []
      while (index < lines.length && /^\s*\|.*\|\s*$/.test(lines[index] ?? '')) {
        rows.push(splitRow(lines[index] ?? ''))
        index += 1
      }
      out.push(table(header, rows))
      continue
    }

    if (/^\s*#{1,6}\s+/.test(line)) {
      const level = (line.match(/^\s*(#+)/)?.[1] ?? '#').length
      const text = line.replace(/^\s*#+\s*/, '').trim()
      out.push(paragraph(renderInline(text), { style: level === 1 ? 'Title' : `Heading${Math.min(level - 1, 3)}` }))
      continue
    }

    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) continue

    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const text = line.replace(/^\s*([-*+]|\d+\.)\s+/, '').trim()
      const ordered = /^\s*\d+\./.test(line)
      out.push(paragraph(`${ordered ? '' : '• '}${renderInline(text)}`, { indent: 360 }))
      continue
    }

    if (/^\s*>\s?/.test(line)) {
      out.push(paragraph(renderInline(line.replace(/^\s*>\s?/, '')), { style: 'Quote' }))
      continue
    }

    if (line.trim().length === 0) continue
    out.push(paragraph(renderInline(line.trim())))
  }

  return out.join('')
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

/** Bold (`**x**`) and inline code (`` `x` ``) become runs; everything else is text. */
function renderInline(text: string): string {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter((part) => part.length > 0)
  return parts
    .map((part) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return run(escape(part.slice(2, -2)), { bold: true })
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return run(escape(part.slice(1, -1)), { font: 'Consolas', shade: 'F3F4F6' })
      }
      return run(escape(part))
    })
    .join('')
}

function paragraph(runs: string, options: { style?: string; indent?: number; font?: string; size?: number } = {}): string {
  const properties: string[] = []
  if (options.style) properties.push(`<w:pStyle w:val="${options.style}"/>`)
  if (options.indent) properties.push(`<w:ind w:left="${options.indent}"/>`)
  const paragraphProperties = properties.length > 0 ? `<w:pPr>${properties.join('')}</w:pPr>` : ''
  const body = options.font || options.size
    ? run(extractText(runs), { font: options.font, size: options.size })
    : runs
  return `<w:p>${paragraphProperties}${body}</w:p>`
}

/** `paragraph()` receives pre-rendered runs; plain text keeps them untouched. */
function extractText(runs: string): string {
  return runs.includes('<w:r>') ? runs : escape(runs)
}

function run(text: string, options: { bold?: boolean; font?: string; size?: number; shade?: string } = {}): string {
  const properties: string[] = []
  if (options.bold) properties.push('<w:b/>')
  if (options.font) properties.push(`<w:rFonts w:ascii="${options.font}" w:hAnsi="${options.font}" w:eastAsia="Noto Sans CJK SC"/>`)
  if (options.size) properties.push(`<w:sz w:val="${options.size}"/><w:szCs w:val="${options.size}"/>`)
  if (options.shade) properties.push(`<w:shd w:val="clear" w:fill="${options.shade}"/>`)
  const runProperties = properties.length > 0 ? `<w:rPr>${properties.join('')}</w:rPr>` : ''
  return `<w:r>${runProperties}<w:t xml:space="preserve">${text}</w:t></w:r>`
}

function table(header: string[], rows: string[][]): string {
  const cells = (values: string[], isHeader: boolean) =>
    values
      .map((value) => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${paragraph(isHeader ? run(escape(value), { bold: true }) : renderInline(value))}</w:tc>`)
      .join('')
  const grid = `<w:tblGrid>${header.map(() => '<w:gridCol w:w="2400"/>').join('')}</w:tblGrid>`
  const headerRow = `<w:tr>${cells(header, true)}</w:tr>`
  const bodyRows = rows.map((row) => `<w:tr>${cells(row, false)}</w:tr>`).join('')
  return (
    `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/>` +
    '<w:tblBorders>' +
    '<w:top w:val="single" w:sz="6" w:color="D0D5DD"/><w:left w:val="single" w:sz="6" w:color="D0D5DD"/>' +
    '<w:bottom w:val="single" w:sz="6" w:color="D0D5DD"/><w:right w:val="single" w:sz="6" w:color="D0D5DD"/>' +
    '<w:insideH w:val="single" w:sz="6" w:color="D0D5DD"/><w:insideV w:val="single" w:sz="6" w:color="D0D5DD"/>' +
    '</w:tblBorders></w:tblPr>' +
    grid +
    headerRow +
    bodyRows +
    '</w:tbl>' +
    paragraph('')
  )
}

function document(title: string, body: string): string {
  const header = title ? paragraph(renderInline(title), { style: 'Title' }) : ''
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body>${header}${body}` +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>' +
    '</w:body></w:document>'
  )
}

function styles(): string {
  const heading = (id: string, size: number, bold = true) =>
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${id}"/><w:basedOn w:val="Normal"/>` +
    `<w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr>` +
    `<w:rPr>${bold ? '<w:b/>' : ''}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:docDefaults><w:rPrDefault><w:rPr>' +
    '<w:rFonts w:ascii="Noto Sans CJK SC" w:hAnsi="Noto Sans CJK SC" w:eastAsia="Noto Sans CJK SC" w:cs="Noto Sans CJK SC"/>' +
    '<w:sz w:val="22"/><w:szCs w:val="22"/>' +
    '</w:rPr></w:rPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>' +
    '<w:pPr><w:spacing w:after="120" w:line="320" w:lineRule="auto"/></w:pPr></w:style>' +
    heading('Title', 44) +
    heading('Heading1', 32) +
    heading('Heading2', 26) +
    heading('Heading3', 24) +
    '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/>' +
    '<w:pPr><w:ind w:left="360"/><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="4338CA"/></w:pBdr></w:pPr>' +
    '<w:rPr><w:i/><w:color w:val="475467"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/></w:style>' +
    '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/></w:style>' +
    '</w:styles>'
  )
}

function contentTypes(): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '</Types>'
  )
}

function rootRels(): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>'
  )
}

function documentRels(): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '</Relationships>'
  )
}

function escape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}
