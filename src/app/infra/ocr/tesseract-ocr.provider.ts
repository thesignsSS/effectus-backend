import { createWorker, PSM } from 'tesseract.js';
import { OcrInput, OcrOutput, OcrProvider } from '../../domain/interfaces/ocr.interface.js';
import { Logger } from '../../domain/interfaces/logger.interface.js';

type OcrPass = {
  name: string;
  pageSegMode: PSM;
  rotateAuto: boolean;
};

type CandidateText = {
  passName: string;
  text: string;
  confidence: number;
  score: number;
};

const OCR_PASSES: OcrPass[] = [
  {
    name: 'layout-automatico',
    pageSegMode: PSM.AUTO,
    rotateAuto: true,
  },
  {
    name: 'bloco-unico',
    pageSegMode: PSM.SINGLE_BLOCK,
    rotateAuto: true,
  },
  {
    name: 'texto-esparso',
    pageSegMode: PSM.SPARSE_TEXT,
    rotateAuto: true,
  },
];

export class TesseractOcrProvider implements OcrProvider {
  constructor(
    private readonly language: string,
    private readonly logger: Logger,
  ) {}

  async extractText(input: OcrInput): Promise<OcrOutput> {
    this.logger.info('OCR iniciado', {
      filename: input.filename,
      extension: input.extension,
      provider: 'tesseract',
      language: this.language,
    });

    const worker = await createWorker(this.language);

    try {
      const candidates: CandidateText[] = [];

      await worker.setParameters({
        preserve_interword_spaces: '1',
        user_defined_dpi: '300',
      });

      for (const ocrPass of OCR_PASSES) {
        await worker.setParameters({
          tessedit_pageseg_mode: ocrPass.pageSegMode,
        });

        const result = await worker.recognize(input.buffer, {
          rotateAuto: ocrPass.rotateAuto,
        });
        const text = this.normalizeRecognizedText(result.data.text);
        const confidence = result.data.confidence ?? 0;
        const score = this.scoreCandidate(text, confidence);

        candidates.push({
          passName: ocrPass.name,
          text,
          confidence,
          score,
        });
      }

      const bestCandidate = candidates
        .filter((candidate) => candidate.text.length > 0)
        .sort((left, right) => right.score - left.score)[0];

      if (!bestCandidate) {
        return {
          text: '',
          confidence: undefined,
        };
      }

      this.logger.info('Melhor leitura OCR selecionada', {
        filename: input.filename,
        pass: bestCandidate.passName,
        confidence: bestCandidate.confidence,
        score: bestCandidate.score,
      });

      return {
        text: bestCandidate.text,
        confidence: bestCandidate.confidence,
      };
    } finally {
      await worker.terminate();
    }
  }

  private normalizeRecognizedText(text: string): string {
    return text
      .replace(/\r/g, '\n')
      .replace(/\u00ad/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !/^[^\p{L}\p{N}]+$/u.test(line))
      .join('\n')
      .trim();
  }

  private scoreCandidate(text: string, confidence: number): number {
    const normalizedText = text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase();
    const wordCount = normalizedText.split(/\s+/).filter(Boolean).length;
    const documentSignalScore = [
      /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/u,
      /\bCPF\b/u,
      /\bRG\b/u,
      /\bNOME\b/u,
      /\bNASCIMENTO\b/u,
      /\bIDENTIDADE\b/u,
      /\bCNH\b/u,
      /\bCARTEIRA\b/u,
      /\bREPUBLICA FEDERATIVA DO BRASIL\b/u,
    ].reduce((score, pattern) => score + (pattern.test(normalizedText) ? 20 : 0), 0);
    const dateSignalScore = (normalizedText.match(/\b\d{2}[/. -]\d{2}[/. -]\d{4}\b/gu) ?? [])
      .length * 10;
    const garbagePenalty = (normalizedText.match(/[|{}~_^`<>]/gu) ?? []).length * 3;

    return confidence + Math.min(wordCount, 120) + documentSignalScore + dateSignalScore - garbagePenalty;
  }
}
