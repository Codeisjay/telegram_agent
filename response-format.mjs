function cleanCell(value) {
  return value
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim()
}

function tableToTelegramText(lines, headers) {
  const rows = []
  for (const line of lines) {
    const cells = line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(cleanCell)
    if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) continue
    if (cells.length !== headers.length) {
      rows.push(line.replace(/\|/g, ' — ').trim())
      continue
    }
    const values = Object.fromEntries(headers.map((header, index) => [header, cells[index]]))
    const headlineKey = headers.find((header) => /headline|title|story|topic/i.test(header))
    const summaryKey = headers.find((header) => /summary|description|details/i.test(header))
    const categoryKey = headers.find((header) => /category|section|area/i.test(header))
    const sourceKey = headers.find((header) => /source|reference/i.test(header))
    const headline = headlineKey ? values[headlineKey] : ''
    const summary = summaryKey ? values[summaryKey] : ''
    const category = categoryKey ? values[categoryKey] : ''
    const source = sourceKey ? values[sourceKey] : ''

    if (headline || summary) {
      const prefix = [category, headline].filter(Boolean).join(' — ')
      rows.push(`• ${prefix}${summary ? `\n  ${summary}` : ''}${source ? `\n  Source: ${source}` : ''}`)
    } else {
      rows.push(`• ${headers.map((header, index) => `${header}: ${cells[index]}`).filter((cell) => !cell.endsWith(': ')).join(' | ')}`)
    }
  }
  return rows.join('\n')
}

function convertMarkdownTables(text) {
  const lines = text.split(/\r?\n/)
  const output = []
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    const next = lines[index + 1]
    if (line.includes('|') && next?.includes('|')) {
      const headers = line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(cleanCell)
      const rows = [line]
      let end = index + 1
      while (end < lines.length && lines[end].includes('|')) rows.push(lines[end++])
      output.push(tableToTelegramText(rows, headers))
      index = end - 1
    } else {
      output.push(line)
    }
  }
  return output.join('\n')
}

export function formatTelegramAnswer(answer, sources = []) {
  const withoutModelSources = answer.replace(
    /^\s*(?:#{1,6}\s*)?(?:\*\*)?(?:sources|references|citations)(?:\*\*)?\s*:?\s*$[\s\S]*/im,
    '',
  )
  const plainText = convertMarkdownTables(withoutModelSources)
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const sourceLines = sources
    .filter((source) => source.url && /^https?:\/\//i.test(source.url))
    .map((source, index) => `[${source.index || index + 1}] ${source.title || source.url} — ${source.url}`)

  if (!plainText && !sourceLines.length) return 'I could not find enough reliable source material to answer that. Please try a more specific search.'
  return [plainText, sourceLines.length ? `Sources:\n${sourceLines.join('\n')}` : ''].filter(Boolean).join('\n\n')
}
