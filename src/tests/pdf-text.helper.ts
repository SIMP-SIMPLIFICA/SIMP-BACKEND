import { PDFParse } from 'pdf-parse'

/**
 * Extrai o texto de um PDF gerado, para asserções de conteúdo nos testes E2E.
 *
 * POR QUE ISTO EXISTE: os testes comparavam o TAMANHO EM BYTES de dois PDFs para
 * inferir que um tinha mais linhas que o outro. A comparação é intermitente — a
 * compressão de fluxo do PDF faz um documento com mais conteúdo sair alguns
 * bytes MENOR que outro com menos, e a suíte passava a falhar sem que nada
 * tivesse quebrado.
 *
 * Ler o texto responde a pergunta que o teste realmente quer fazer ("este
 * registro aparece no relatório?") em vez de uma aproximação dela.
 */
export async function extractPdfText(bytes: Buffer | Uint8Array): Promise<string> {
  const parser = new PDFParse({ data: Buffer.from(bytes) })
  const result = await parser.getText()
  return result.text
}
