import { describe, expect, it } from 'vitest'
import {
  UPLOAD_POLICIES,
  UnsupportedFileTypeError,
  assertAllowedFile,
  detectFileType,
  looksLikePlainText,
} from '@/services/file-validation.service.js'

// ─── Fixtures: cabeçalhos binários reais ──────────────────────────────────────

const pad = (head: number[], size = 64) =>
  Buffer.concat([Buffer.from(head), Buffer.alloc(Math.max(0, size - head.length))])

const PDF = pad([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]) // %PDF-1.7
const PNG = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG = pad([0xff, 0xd8, 0xff, 0xe0])
const GIF = pad([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
const WEBP = Buffer.concat([
  Buffer.from([0x52, 0x49, 0x46, 0x46]), // RIFF
  Buffer.from([0x00, 0x00, 0x00, 0x00]), // tamanho
  Buffer.from([0x57, 0x45, 0x42, 0x50]), // WEBP
  Buffer.alloc(48),
])
const EXE = pad([0x4d, 0x5a, 0x90, 0x00]) // MZ — PE executável
const ELF = pad([0x7f, 0x45, 0x4c, 0x46])
const OLE = pad([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])

const docx = () =>
  Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from('...[Content_Types].xml...word/document.xml...', 'ascii'),
  ])

const xlsx = () =>
  Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from('...[Content_Types].xml...xl/workbook.xml...', 'ascii'),
  ])

describe('detectFileType', () => {
  it.each([
    [PDF, 'application/pdf'],
    [PNG, 'image/png'],
    [JPEG, 'image/jpeg'],
    [GIF, 'image/gif'],
    [WEBP, 'image/webp'],
    [OLE, 'application/x-ole-storage'],
  ])('identifica o formato pelos bytes', (buffer, expected) => {
    expect(detectFileType(buffer)?.mime).toBe(expected)
  })

  it('distingue docx de xlsx, que compartilham a assinatura PK', () => {
    expect(detectFileType(docx())?.mime).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
    expect(detectFileType(xlsx())?.mime).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
  })

  it('devolve null para conteúdo sem assinatura conhecida', () => {
    expect(detectFileType(Buffer.from('apenas texto', 'utf8'))).toBeNull()
  })

  it('devolve null para buffer vazio', () => {
    expect(detectFileType(Buffer.alloc(0))).toBeNull()
  })
})

describe('assertAllowedFile — o cenário do épico', () => {
  it('RECUSA um .exe renomeado para .pdf e declarado como application/pdf', () => {
    try {
      assertAllowedFile(EXE, {
        policy: UPLOAD_POLICIES.PDF_ONLY,
        declaredMime: 'application/pdf',
        fileName: 'contrato.pdf',
      })
      throw new Error('deveria ter recusado')
    } catch (err) {
      expect(err).toBeInstanceOf(UnsupportedFileTypeError)
      expect((err as UnsupportedFileTypeError).statusCode).toBe(415)
      expect((err as UnsupportedFileTypeError).reason).toBe('conteudo-executavel')
    }
  })

  it('recusa ELF disfarçado de imagem', () => {
    expect(() =>
      assertAllowedFile(ELF, {
        policy: UPLOAD_POLICIES.IMAGES_ONLY,
        declaredMime: 'image/png',
        fileName: 'logo.png',
      }),
    ).toThrow(UnsupportedFileTypeError)
  })

  it.each([
    ['<?php system($_GET[1]); ?>', 'shell.php.pdf'],
    ['#!/bin/sh\nrm -rf /', 'script.pdf'],
    ['<svg onload="alert(1)"></svg>', 'logo.svg'],
    ['<html><script>alert(1)</script></html>', 'pagina.png'],
  ])('recusa payload ativo: %s', (payload, fileName) => {
    expect(() =>
      assertAllowedFile(Buffer.from(payload, 'utf8'), {
        policy: UPLOAD_POLICIES.GENERAL_ATTACHMENT,
        fileName,
      }),
    ).toThrow(UnsupportedFileTypeError)
  })

  it('aceita um PDF genuíno na política PDF_ONLY', () => {
    const result = assertAllowedFile(PDF, {
      policy: UPLOAD_POLICIES.PDF_ONLY,
      declaredMime: 'application/pdf',
      fileName: 'ata.pdf',
    })
    expect(result.mime).toBe('application/pdf')
  })

  it('recusa um PNG genuíno na política PDF_ONLY', () => {
    try {
      assertAllowedFile(PNG, {
        policy: UPLOAD_POLICIES.PDF_ONLY,
        declaredMime: 'image/png',
        fileName: 'foto.png',
      })
      throw new Error('deveria ter recusado')
    } catch (err) {
      expect((err as UnsupportedFileTypeError).reason).toBe('tipo-nao-permitido')
    }
  })

  it('detecta divergência quando o tipo real é permitido mas não é o declarado', () => {
    try {
      assertAllowedFile(PNG, {
        policy: UPLOAD_POLICIES.GENERAL_ATTACHMENT,
        declaredMime: 'application/pdf',
        fileName: 'documento.pdf',
      })
      throw new Error('deveria ter recusado')
    } catch (err) {
      expect((err as UnsupportedFileTypeError).reason).toBe('divergencia-mime')
    }
  })

  it('recusa arquivo vazio', () => {
    try {
      assertAllowedFile(Buffer.alloc(0), { policy: UPLOAD_POLICIES.PDF_ONLY })
      throw new Error('deveria ter recusado')
    } catch (err) {
      expect((err as UnsupportedFileTypeError).reason).toBe('arquivo-vazio')
    }
  })

  it('aceita texto puro só onde a política permite', () => {
    const txt = Buffer.from('nome;valor\nteste;10\n', 'utf8')

    expect(assertAllowedFile(txt, { policy: UPLOAD_POLICIES.GENERAL_ATTACHMENT }).mime)
      .toBe('text/plain')

    expect(() => assertAllowedFile(txt, { policy: UPLOAD_POLICIES.PDF_ONLY }))
      .toThrow(UnsupportedFileTypeError)
  })

  it('tolera apelidos legítimos de MIME (image/jpg para JPEG)', () => {
    expect(
      assertAllowedFile(JPEG, {
        policy: UPLOAD_POLICIES.IMAGES_ONLY,
        declaredMime: 'image/jpg',
        fileName: 'foto.jpg',
      }).mime,
    ).toBe('image/jpeg')
  })

  it('aceita application/octet-stream, que navegadores mandam para extensão desconhecida', () => {
    expect(
      assertAllowedFile(PDF, {
        policy: UPLOAD_POLICIES.PDF_ONLY,
        declaredMime: 'application/octet-stream',
      }).mime,
    ).toBe('application/pdf')
  })

  it('aceita docx na política de anexo geral', () => {
    expect(assertAllowedFile(docx(), { policy: UPLOAD_POLICIES.GENERAL_ATTACHMENT }).mime)
      .toContain('wordprocessingml')
  })
})

describe('looksLikePlainText', () => {
  it('aceita texto UTF-8 comum', () => {
    expect(looksLikePlainText(Buffer.from('Ofício nº 12/2026\r\nAssunto: teste', 'utf8'))).toBe(true)
  })

  it('recusa buffer com byte nulo (binário disfarçado)', () => {
    expect(looksLikePlainText(Buffer.from([0x61, 0x00, 0x62]))).toBe(false)
  })

  it('recusa caracteres de controle', () => {
    expect(looksLikePlainText(Buffer.from([0x61, 0x07, 0x62]))).toBe(false)
  })
})
