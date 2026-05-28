export interface OcrInput {
  buffer: Buffer;
  filename: string;
  extension: string;
}

export interface OcrOutput {
  text: string;
  confidence?: number;
}

export interface OcrProvider {
  extractText(input: OcrInput): Promise<OcrOutput>;
}
