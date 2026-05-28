export interface ExtractedDocumentData {
  cpf?: string;
  rg?: string;
  name?: string;
  birthDate?: string;
  issueDate?: string;
  rawText: string;
}

export interface DocumentDataExtractor {
  extract(text: string): ExtractedDocumentData;
}
