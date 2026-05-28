import { OcrInput, OcrOutput, OcrProvider } from '../../domain/interfaces/ocr.interface.js';

export class NoopOcrProvider implements OcrProvider {
  async extractText(_input: OcrInput): Promise<OcrOutput> {
    return {
      text: '',
    };
  }
}
