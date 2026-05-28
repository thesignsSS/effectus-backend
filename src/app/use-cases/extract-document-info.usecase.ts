import { PDFParse } from 'pdf-parse';
import { FileExtension } from '../domain/constants/file.constants.js';
import { Document } from '../domain/entities/document.entity.js';
import { Logger } from '../domain/interfaces/logger.interface.js';
import { OcrProvider } from '../domain/interfaces/ocr.interface.js';

export interface DocumentTextExtractionResult {
  text: string;
  confidence?: number;
  visionInputs: DocumentVisionInput[];
}

export interface DocumentVisionInput {
  filename: string;
  mimeType: string;
  dataUrl: string;
}

export class ExtractDocumentInfoUseCase {
  private readonly imageExtensions = new Set<string>([
    FileExtension.JPG,
    FileExtension.JPEG,
    FileExtension.PNG,
  ]);

  constructor(
    private readonly ocrProvider: OcrProvider,
    private readonly logger: Logger,
  ) {}

  async execute(input: {
    document: Document;
    filename: string;
    messageId?: string;
    clientName?: string;
    brokerName?: string;
  }): Promise<DocumentTextExtractionResult | undefined> {
    const textOutput = await this.extractText(input.document, input.filename);

    if (!textOutput) {
      return undefined;
    }

    if (!textOutput.text && textOutput.visionInputs.length === 0) {
      this.logger.warn('Leitura do documento não encontrou texto', {
        filename: input.filename,
      });
      return undefined;
    }

    this.logger.info('Leitura do documento concluída', {
      sourceFilename: input.filename,
      confidence: textOutput.confidence,
      textLength: textOutput.text.length,
    });

    return textOutput;
  }

  private async extractText(
    document: Document,
    filename: string,
  ): Promise<DocumentTextExtractionResult | undefined> {
    const extension = document.extension.toLowerCase();

    if (extension === FileExtension.PDF) {
      return this.extractPdfText(document, filename);
    }

    if (!this.imageExtensions.has(extension)) {
      return undefined;
    }

    const ocrOutput = await this.ocrProvider.extractText({
      buffer: document.buffer,
      filename,
      extension: document.extension,
    });

    return {
      ...ocrOutput,
      visionInputs: [
        {
          filename,
          mimeType: this.getImageMimeType(extension),
          dataUrl: this.toDataUrl(document.buffer, this.getImageMimeType(extension)),
        },
      ],
    };
  }

  private async extractPdfText(
    document: Document,
    filename: string,
  ): Promise<DocumentTextExtractionResult> {
    this.logger.info('Leitura de PDF iniciada', {
      filename,
      provider: 'pdf-parse',
    });

    const parser = new PDFParse({
      data: new Uint8Array(document.buffer),
    });

    try {
      const result = await parser.getText();
      const text = this.normalizeExtractedText(result.text);

      if (this.hasUsefulPdfText(text)) {
        return {
          text,
          visionInputs: [],
        };
      }

      return this.extractScannedPdfText(parser, filename);
    } finally {
      await parser.destroy();
    }
  }

  private async extractScannedPdfText(
    parser: PDFParse,
    filename: string,
  ): Promise<DocumentTextExtractionResult> {
    this.logger.info('PDF sem texto selecionável, iniciando OCR das páginas', {
      filename,
    });

    const screenshots = await parser.getScreenshot({
      desiredWidth: 1800,
      imageBuffer: true,
      imageDataUrl: false,
    });
    const pageTexts: string[] = [];
    const confidences: number[] = [];
    const visionInputs: DocumentVisionInput[] = [];

    for (const page of screenshots.pages) {
      const pageBuffer = Buffer.from(page.data);
      const pageFilename = `${filename}_pagina_${page.pageNumber}.png`;

      visionInputs.push({
        filename: pageFilename,
        mimeType: 'image/png',
        dataUrl: this.toDataUrl(pageBuffer, 'image/png'),
      });

      const pageOcr = await this.ocrProvider.extractText({
        buffer: pageBuffer,
        filename: pageFilename,
        extension: FileExtension.PNG,
      });
      const pageText = this.normalizeExtractedText(pageOcr.text);

      if (pageText) {
        pageTexts.push(`--- Página ${page.pageNumber} ---\n${pageText}`);
      }

      if (typeof pageOcr.confidence === 'number') {
        confidences.push(pageOcr.confidence);
      }
    }

    return {
      text: pageTexts.join('\n\n'),
      confidence:
        confidences.length > 0
          ? confidences.reduce((sum, confidence) => sum + confidence, 0) /
            confidences.length
          : undefined,
      visionInputs,
    };
  }

  private hasUsefulPdfText(text: string): boolean {
    const withoutPageMarkers = text
      .replace(/--\s*\d+\s+of\s+\d+\s*--/giu, '')
      .trim();
    const alphaNumericCount = (
      withoutPageMarkers.match(/[\p{L}\p{N}]/gu) ?? []
    ).length;

    return alphaNumericCount >= 40;
  }

  private normalizeExtractedText(text: string): string {
    return text
      .replace(/\r/g, '\n')
      .replace(/\u00ad/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private getImageMimeType(extension: string): string {
    return extension === FileExtension.PNG ? 'image/png' : 'image/jpeg';
  }

  private toDataUrl(buffer: Buffer, mimeType: string): string {
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
  }
}
