import {
  DocumentDataExtractor,
  ExtractedDocumentData,
} from '../domain/interfaces/document-data-extractor.interface.js';

export class BrazilianDocumentDataExtractor implements DocumentDataExtractor {
  extract(text: string): ExtractedDocumentData {
    const normalizedText = this.normalizeText(text);

    return {
      cpf: this.findCpf(normalizedText),
      rg: this.findRg(normalizedText),
      name: this.findName(normalizedText),
      birthDate: this.findDateAfterLabel(normalizedText, [
        'DATA DE NASCIMENTO',
        'NASCIMENTO',
        'NASC',
      ]),
      issueDate: this.findDateAfterLabel(normalizedText, [
        'DATA DE EXPEDICAO',
        'EXPEDICAO',
        'EMISSAO',
      ]),
      rawText: text,
    };
  }

  private normalizeText(text: string): string {
    return text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\S\r\n]+/g, ' ')
      .toUpperCase();
  }

  private findCpf(text: string): string | undefined {
    const match = text.match(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/);

    if (!match) {
      return undefined;
    }

    const digits = match[0].replace(/\D/g, '');

    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  }

  private findRg(text: string): string | undefined {
    const labelMatch = text.match(/\b(?:RG|REGISTRO GERAL|IDENTIDADE)\D{0,20}([0-9X.-]{5,16})\b/);

    if (labelMatch?.[1]) {
      return labelMatch[1].replace(/\s+/g, '');
    }

    return undefined;
  }

  private findName(text: string): string | undefined {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const labelIndex = lines.findIndex((line) =>
      /^(NOME|NOME CIVIL|NOME COMPLETO)\b/.test(line),
    );

    if (labelIndex >= 0) {
      const sameLine = lines[labelIndex].replace(/^(NOME|NOME CIVIL|NOME COMPLETO)\W*/u, '').trim();

      if (this.looksLikePersonName(sameLine)) {
        return this.toTitleCase(sameLine);
      }

      const nextLine = lines[labelIndex + 1];

      if (this.looksLikePersonName(nextLine)) {
        return this.toTitleCase(nextLine);
      }
    }

    return undefined;
  }

  private findDateAfterLabel(text: string, labels: string[]): string | undefined {
    for (const label of labels) {
      const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = text.match(
        new RegExp(`${escapedLabel}\\D{0,30}(\\d{2}[\\/.-]\\d{2}[\\/.-]\\d{4})`, 'u'),
      );

      if (match?.[1]) {
        return match[1].replace(/[.-]/g, '/');
      }
    }

    return undefined;
  }

  private looksLikePersonName(value?: string): value is string {
    return Boolean(
      value &&
        value.length >= 6 &&
        /^[A-Z\s']+$/.test(value) &&
        value.split(/\s+/).length >= 2 &&
        !/\b(CPF|RG|DATA|VALIDADE|NASCIMENTO|DOC|IDENTIDADE)\b/.test(value),
    );
  }

  private toTitleCase(value: string): string {
    return value
      .toLowerCase()
      .replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
  }
}
