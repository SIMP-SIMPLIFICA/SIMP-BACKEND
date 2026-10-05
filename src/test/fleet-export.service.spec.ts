import { PDFDocument } from 'pdf-lib'
import { describe, expect, test, vi } from 'vitest'
import { extractPdfText } from '../tests/pdf-text.helper.js'

/**
 * Exportações do Frotas — partes puras: alerta de validade da CNH e as
 * extensões do motor de PDF que elas usam (paisagem, destaque de linha,
 * responsável no relatório por seções). Nada do pdf-lib é mockado.
 */

vi.mock('@/config/config.js', async importOriginal => {
  const original = await importOriginal<typeof import('@/config/config.js')>()
  return { ...original, config: { ...original.config, urls: { ...original.config.urls, frontend: 'https://simp.prefeitura.gov.br' } } }
})

const { cnhExpiryAlert } = await import('../services/fleet-export.service.js')
const { createSectionedReportPdf, createTabularReportPdf } = await import('../services/document-pdf.service.js')

const BASE = {
  title: 'RELAÇÃO DE TESTE',
  organizationName: 'Prefeitura Municipal de Exemplo',
  publicId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
}

describe('cnhExpiryAlert', () => {
  const today = '2026-10-04'

  test('vencida antes de hoje', () => {
    expect(cnhExpiryAlert('2026-10-03', today)).toMatchObject({ level: 'alert', label: 'VENCIDA', daysLeft: -1 })
  })

  test('vence hoje e nos próximos 30 dias → atenção', () => {
    expect(cnhExpiryAlert('2026-10-04', today)).toMatchObject({ level: 'warning', label: 'VENCE HOJE' })
    expect(cnhExpiryAlert('2026-10-05', today)).toMatchObject({ level: 'warning', label: 'VENCE EM 1 DIA' })
    expect(cnhExpiryAlert('2026-11-03', today)).toMatchObject({ level: 'warning', label: 'VENCE EM 30 DIAS' })
  })

  test('acima de 30 dias está em dia', () => {
    expect(cnhExpiryAlert('2026-11-04', today)).toMatchObject({ level: null, daysLeft: 31 })
  })

  test('virada de ano e horário de verão não deslocam a contagem', () => {
    expect(cnhExpiryAlert('2027-01-01', '2026-12-31').daysLeft).toBe(1)
  })
})

describe('motor de PDF — extensões do Frotas', () => {
  test('relatório tabular em paisagem tem páginas deitadas; o padrão continua retrato', async () => {
    const input = { ...BASE, columns: [{ header: 'Placa', width: 80 }], rows: [['ABC1D23']] }

    const landscape = await PDFDocument.load((await createTabularReportPdf({ ...input, orientation: 'landscape' })).bytes)
    const { width, height } = landscape.getPage(0).getSize()
    expect(width).toBeGreaterThan(height)

    const portrait = await PDFDocument.load((await createTabularReportPdf(input)).bytes)
    const size = portrait.getPage(0).getSize()
    expect(size.height).toBeGreaterThan(size.width)
  })

  test('destaque de linha não derruba a geração e o texto da linha continua lá', async () => {
    const { bytes } = await createTabularReportPdf({
      ...BASE,
      orientation: 'landscape',
      columns: [
        { header: 'Nome', width: 200 },
        { header: 'Alerta', width: 100 },
      ],
      rows: [
        ['Carlos', 'VENCIDA'],
        ['Beatriz', 'VENCE EM 10 DIAS'],
        ['Ana', '—'],
      ],
      rowHighlights: ['alert', 'warning', null],
    })
    const text = await extractPdfText(bytes)
    expect(text).toContain('VENCIDA')
    expect(text).toContain('VENCE EM 10 DIAS')
  })

  test('resumo longo quebra em linhas em vez de sair da página', async () => {
    const value = Array.from({ length: 40 }, (_, i) => `Secretaria ${i + 1}: ${i}`).join(' · ')
    const { bytes } = await createTabularReportPdf({
      ...BASE,
      columns: [{ header: 'Placa', width: 80 }],
      rows: [['ABC1D23']],
      summary: [{ label: 'Por departamento', value }],
    })
    const text = await extractPdfText(bytes)
    expect(text).toContain('Secretaria 1:')
    expect(text).toContain('Secretaria 40:')
  })

  test('relatório por seções imprime o responsável (nome completo e cargo) ao final', async () => {
    const { bytes } = await createSectionedReportPdf({
      ...BASE,
      exporterName: 'M*** S***',
      sections: [{ heading: 'Identificação', fields: [{ label: 'Placa', value: 'ABC1D23' }] }],
      signatures: [{ name: 'Maria da Silva', role: 'Gestora de Frota' }],
    })
    const text = await extractPdfText(bytes)
    expect(text).toContain('Maria da Silva')
    expect(text).toContain('Gestora de Frota')
  })
})
