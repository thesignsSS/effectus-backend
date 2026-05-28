import { FileExtension } from '../domain/constants/file.constants.js';
import {
  CUSTOMER_REGISTRATION_FIELDS,
  CustomerRegistrationData,
  emptyCustomerRegistrationData,
} from '../domain/constants/customer-registration-fields.constants.js';
import { Document } from '../domain/entities/document.entity.js';
import { CustomerRegistrationExtractor } from '../domain/interfaces/customer-registration-extractor.interface.js';
import { DashboardPresenter } from '../domain/interfaces/dashboard.interface.js';
import { DocumentDataExtractor } from '../domain/interfaces/document-data-extractor.interface.js';
import { Logger } from '../domain/interfaces/logger.interface.js';
import { FileService } from '../services/file.service.js';
import {
  RemittanceDocumentReading,
  RemittanceSession,
} from '../services/remittance-session.service.js';
import { OneDriveService } from '../services/onedrive.service.js';
import { generateDocumentFileName } from '../utils/file-validator.js';

export class GenerateCustomerRegistrationReportUseCase {
  constructor(
    private readonly fileService: FileService,
    private readonly storageService: OneDriveService,
    private readonly documentDataExtractor: DocumentDataExtractor,
    private readonly logger: Logger,
    private readonly customerRegistrationExtractor?: CustomerRegistrationExtractor,
    private readonly dashboardPresenter?: DashboardPresenter,
  ) {}

  async execute(session: RemittanceSession): Promise<string> {
    const localData = this.extractLocally(session);
    const openRouterData = await this.extractWithOpenRouter(session);
    const extractionEngine = openRouterData ? 'OpenRouter + Local' : 'Local';
    const data = this.normalizeData(
      openRouterData ? this.mergeData(openRouterData, localData) : localData,
    );
    const report = this.buildReport(session, data, extractionEngine);
    const originalName = `cadastro_cliente_${session.clientName}.${FileExtension.TXT}`;
    const buffer = Buffer.from(report, 'utf-8');
    const document = new Document(
      originalName,
      FileExtension.TXT,
      buffer,
      session.chatId,
      new Date(),
    );
    const filename = generateDocumentFileName({
      createdAt: document.createdAt,
      sender: document.sender,
      originalName,
      clientName: session.clientName,
      brokerName: session.brokerName,
    });
    const tempPath = await this.fileService.saveTemporarily(document, filename);

    this.logger.info('Relatório cadastral salvo temporariamente', {
      filename,
      tempPath,
      documentsRead: session.documentReadings.length,
    });

    const location = await this.storageService.upload(buffer, filename, {
      clientName: session.clientName,
      brokerName: session.brokerName,
    });

    this.logger.info('Relatório cadastral enviado ao storage', {
      filename,
      location,
    });

    this.dashboardPresenter?.addDocument({
      id: location,
      originalName,
      filename,
      extension: FileExtension.TXT,
      sender: document.sender,
      location,
      receivedAt: document.createdAt.toISOString(),
    });

    return location;
  }

  private mergeData(
    primary: CustomerRegistrationData,
    fallback: CustomerRegistrationData,
  ): CustomerRegistrationData {
    const merged = emptyCustomerRegistrationData();

    for (const field of CUSTOMER_REGISTRATION_FIELDS) {
      merged[field] = primary[field] || fallback[field] || '';
    }

    return merged;
  }

  private normalizeData(data: CustomerRegistrationData): CustomerRegistrationData {
    const normalized = { ...data };

    for (const field of [
      'CPF do Cliente',
      'PIS/NIS',
      'Número da Carteira Nacional de Habilitação',
      'CEP',
      'Telefone Celular DDD',
      'Telefone Celular Número',
      'CPF/CNPJ da Fonte Pagadora',
    ] as const) {
      normalized[field] = onlyDigits(normalized[field]);
    }

    for (const field of [
      'Nome do Cliente Completo',
      'Nome do Cliente Reduzido',
      'Naturalidade UF',
      'Naturalidade Município',
      'Nome do Pai',
      'Nome da Mãe',
      'Grau de Instrução',
      'Tipo de Documento de Identificação',
      'Órgão Emissor',
      'UF do Documento',
      'Estado Civil',
      'Tipo de Ocupação',
      'Ocupação',
      'Tipo de Logradouro',
      'Endereço',
      'Complemento',
      'Bairro',
      'UF do Endereço',
      'Município',
      'Tipo de Imóvel',
      'Ocupação do Imóvel',
      'Característica da Renda',
      'Tipo de Fonte',
      'Nome da Fonte Pagadora',
      'Ocupação da Renda Formal',
      'Agência de Relacionamento UF',
      'Agência de Relacionamento Município',
      'Código e Nome da Agência',
    ] as const) {
      normalized[field] = normalized[field].toUpperCase();
    }

    normalized['Nacionalidade'] = this.normalizeNationality(
      normalized['Nacionalidade'],
    );
    normalized['Estado Civil'] = this.normalizeMaritalStatus(
      normalized['Estado Civil'],
    );
    normalized['Tipo de Documento de Identificação'] =
      this.normalizeDocumentType(normalized['Tipo de Documento de Identificação']);
    normalized['Característica da Renda'] = this.normalizeIncomeCharacteristic(
      normalized['Característica da Renda'],
    );
    normalized['Tipo de Fonte'] = this.normalizeIncomeSourceType(
      normalized['Tipo de Fonte'],
    );

    if (!normalized['Nome do Cliente Reduzido']) {
      normalized['Nome do Cliente Reduzido'] = this.buildReducedName(
        normalized['Nome do Cliente Completo'],
      );
    }

    if (!normalized['Tipo de Ocupação'] && normalized['Ocupação']) {
      normalized['Tipo de Ocupação'] = 'FORMAL';
    }

    return normalized;
  }

  private async extractWithOpenRouter(
    session: RemittanceSession,
  ): Promise<CustomerRegistrationData | undefined> {
    try {
      return await this.customerRegistrationExtractor?.extract({
        clientName: session.clientName,
        brokerName: session.brokerName,
        documentTexts: session.documentReadings.map((reading) => ({
          filename: reading.filename,
          originalName: reading.originalName,
          text: reading.text,
          visionInputs: reading.visionInputs,
        })),
        additionalMessages: session.additionalMessages,
      });
    } catch (error) {
      this.logger.error('Falha ao extrair cadastro com OpenRouter', {
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  private extractLocally(session: RemittanceSession): CustomerRegistrationData {
    const text = this.joinTexts(session.documentReadings, session.additionalMessages);
    const extractedData = this.documentDataExtractor.extract(text);
    const data = emptyCustomerRegistrationData();

    data['CPF do Cliente'] = onlyDigits(extractedData.cpf);
    data['Nome do Cliente Completo'] =
      this.findCustomerName(text) ?? extractedData.name ?? session.clientName;
    data['Nome do Cliente Reduzido'] = this.buildReducedName(
      data['Nome do Cliente Completo'],
    );
    data['Data de Nascimento'] = extractedData.birthDate ?? '';
    data['Data de Emissão'] = extractedData.issueDate ?? '';
    data['Sexo'] = this.findGender(text);
    data['Nacionalidade'] = this.findNationality(text);
    data['Naturalidade UF'] = this.findNaturalidade(text).uf;
    data['Naturalidade Município'] = this.findNaturalidade(text).municipio;
    data['Nome do Pai'] = this.findParents(text).father;
    data['Nome da Mãe'] = this.findParents(text).mother;
    data['Tipo de Documento de Identificação'] = this.findDocumentType(text);
    data['Número da Carteira Nacional de Habilitação'] = this.findCnh(text);
    data['Órgão Emissor'] = this.findIssuingAgency(text);
    data['UF do Documento'] = this.findDocumentUf(text);
    data['Estado Civil'] = this.findMaritalStatus(text);
    data['CEP'] = this.findCep(text);
    data['E-mail'] = this.findEmail(text);
    data['PIS/NIS'] = this.findPisNis(text);
    data['Telefone Celular DDD'] = this.findPhone(text).ddd;
    data['Telefone Celular Número'] = this.findPhone(text).number;
    data['Característica da Renda'] = this.findIncomeCharacteristic(text);
    data['Tipo de Fonte'] = this.findIncomeSourceType(text);
    data['CPF/CNPJ da Fonte Pagadora'] = this.findEmployerCnpj(text);
    data['Nome da Fonte Pagadora'] = this.findEmployerName(text);
    data['Ocupação da Renda Formal'] = this.findOccupation(text);
    data['Ocupação'] = data['Ocupação da Renda Formal'];
    data['Tipo de Ocupação'] = data['Ocupação'] ? 'FORMAL' : '';
    data['Data de Admissão'] = this.findAdmissionDate(text);
    data['Renda Bruta'] = this.findGrossIncome(text);
    data['Renda Líquida'] = this.findNetIncome(text);

    return data;
  }

  private buildReport(
    session: RemittanceSession,
    data: CustomerRegistrationData,
    extractionEngine: string,
  ): string {
    return [
      'Cadastro de Cliente',
      '',
      `Cliente da remessa: ${session.clientName}`,
      `Corretor da remessa: ${session.brokerName}`,
      `Remessa iniciada em: ${session.startedAt}`,
      `Documentos lidos: ${session.documentReadings.length}`,
      `Motor de extração: ${extractionEngine}`,
      '',
      'Campos do formulário:',
      ...CUSTOMER_REGISTRATION_FIELDS.map((field) => `${field}: ${data[field]}`),
      '',
      'Mensagens adicionais:',
      session.additionalMessages.length > 0
        ? session.additionalMessages.join('\n---\n')
        : 'Nenhuma',
      '',
      'Textos lidos dos documentos:',
      this.buildSourceTexts(session.documentReadings),
      '',
    ].join('\n');
  }

  private buildSourceTexts(readings: RemittanceDocumentReading[]): string {
    if (readings.length === 0) {
      return 'Nenhum documento lido.';
    }

    return readings
      .map((reading, index) =>
        [
          `Documento ${index + 1}: ${reading.filename}`,
          `Nome original: ${reading.originalName}`,
          `Extensão: ${reading.extension}`,
          `Recebido em: ${reading.receivedAt}`,
          `Confiança da leitura: ${reading.confidence ?? 'n/a'}`,
          `Imagens enviadas para IA: ${reading.visionInputs.length}`,
          '',
          reading.text,
        ].join('\n'),
      )
      .join('\n\n---\n\n');
  }

  private joinTexts(
    readings: RemittanceDocumentReading[],
    additionalMessages: string[],
  ): string {
    return [
      ...readings.map((reading) => reading.text),
      ...additionalMessages,
    ].join('\n\n');
  }

  private buildReducedName(name: string): string {
    const parts = name.split(/\s+/).filter(Boolean);

    if (parts.length <= 2) {
      return name;
    }

    const middleInitials = parts
      .slice(1, -1)
      .map((part) => part[0])
      .join(' ');

    return `${parts[0]} ${middleInitials} ${parts[parts.length - 1]}`.trim();
  }

  private normalizeNationality(value: string): string {
    const normalized = this.normalizeForExtraction(value);

    if (/\bBRASILEIR[AO]\b/.test(normalized)) {
      return 'BRASILEIRA';
    }

    return value.toUpperCase();
  }

  private normalizeMaritalStatus(value: string): string {
    const normalized = this.normalizeForExtraction(value);

    if (/\bCASAD[AO]\b|\bCASAMENTO\b/.test(normalized)) {
      return 'CASADO (A)';
    }

    if (/\bSOLTEIR[AO]\b/.test(normalized)) {
      return 'SOLTEIRO (A)';
    }

    if (/\bDIVORCIAD[AO]\b/.test(normalized)) {
      return 'DIVORCIADO (A)';
    }

    if (/\bVIUV[AO]\b/.test(normalized)) {
      return 'VIÚVO (A)';
    }

    return value.toUpperCase();
  }

  private normalizeDocumentType(value: string): string {
    const normalized = this.normalizeForExtraction(value);

    if (/\bCNH\b|HABILITACAO/.test(normalized)) {
      return 'CNH - CARTEIRA NACIONAL DE HABILITAÇÃO';
    }

    if (/\bRG\b|REGISTRO GERAL|IDENTIDADE/.test(normalized)) {
      return 'RG - REGISTRO GERAL';
    }

    return value.toUpperCase();
  }

  private normalizeIncomeCharacteristic(value: string): string {
    const normalized = this.normalizeForExtraction(value);

    if (/\bFORMAL\b|COMPROVAD[AO]/.test(normalized)) {
      return 'COMPROVADA';
    }

    if (/SEM RENDA/.test(normalized)) {
      return 'SEM RENDA';
    }

    return value.toUpperCase();
  }

  private normalizeIncomeSourceType(value: string): string {
    const normalized = this.normalizeForExtraction(value);

    if (/\bJURIDIC[AO]\b|\bEMPREGADOR\b|\bCNPJ\b/.test(normalized)) {
      return 'JURÍDICA';
    }

    if (/\bFISIC[AO]\b|\bCPF\b/.test(normalized)) {
      return 'FÍSICA';
    }

    return value.toUpperCase();
  }

  private findCep(text: string): string {
    return text.match(/\b\d{5}-?\d{3}\b/)?.[0]?.replace(/\D/g, '') ?? '';
  }

  private findCustomerName(text: string): string | undefined {
    const patterns = [
      /\b\d{3,6}\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇ]+(?:\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ]+){2,})\s+\d{2}\/\d{2}\/\d{4}/u,
      /VALIDA EM TODO O TERRITÓRIO\s+NACIONAL[\s\S]{0,80}?\d{2}\/\d{2}\/\d{4}\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇ]+(?:\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ]+){2,})/u,
      /NOME\s+CADASTRO[\s\S]{0,120}?([A-ZÁÉÍÓÚÂÊÔÃÕÇ]+(?:\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ]+){2,})\s+\d{2}\/\d{2}\/\d{4}/u,
    ];

    for (const pattern of patterns) {
      const match = this.normalizeForExtraction(text).match(pattern);

      if (match?.[1]) {
        return this.toTitleCase(match[1]);
      }
    }

    return undefined;
  }

  private findGender(text: string): string {
    const normalized = this.normalizeForExtraction(text);

    if (/\bFEMININO\b/.test(normalized)) {
      return 'FEMININO';
    }

    if (/\bMASCULINO\b/.test(normalized)) {
      return 'MASCULINO';
    }

    return '';
  }

  private findNationality(text: string): string {
    const normalized = this.normalizeForExtraction(text);

    if (/\bBRASILEIR[AO]\b/.test(normalized)) {
      return 'BRASILEIRA';
    }

    return '';
  }

  private findNaturalidade(text: string): { municipio: string; uf: string } {
    const normalized = this.normalizeForExtraction(text);
    const match = normalized.match(
      /\b(?:NATURALIDADE|EM)\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇ ]+?)\s*[-,]\s*([A-Z]{2})\b/u,
    );

    return {
      municipio: match?.[1] ? this.toTitleCase(match[1]) : '',
      uf: match?.[2] ?? '',
    };
  }

  private findParents(text: string): { father: string; mother: string } {
    const normalized = this.normalizeForExtraction(text);
    const rgMatch = normalized.match(
      /(?:\d{2}\/\d{2}\/\d{4}\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ ]+)\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇ]+(?:\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ]+){2,})\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇ]+(?:\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ]+){2,})\s+DE NASCIMENTO/u,
    );

    if (rgMatch) {
      return {
        father: this.toTitleCase(rgMatch[1]),
        mother: this.toTitleCase(rgMatch[2]),
      };
    }

    const father =
      normalized.match(/\bFILH[AO]\s+DE\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇ ]+?)\s+E\s+DE\s+/u)?.[1] ??
      '';
    const mother =
      normalized.match(/\bE\s+DE\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇ ]+?)(?:\.|\n|$)/u)?.[1] ??
      '';

    return {
      father: father ? this.toTitleCase(father) : '',
      mother: mother ? this.toTitleCase(mother) : '',
    };
  }

  private findDocumentType(text: string): string {
    const normalized = this.normalizeForExtraction(text);

    if (/\bCARTEIRA NACIONAL DE HABILITACAO\b|\bCNH\b/.test(normalized)) {
      return 'CNH - CARTEIRA NACIONAL DE HABILITAÇÃO';
    }

    if (/\bREGISTRO GERAL\b|\bIDENTIDADE\b|VALIDA EM TODO O TERRITORIO NACIONAL/.test(normalized)) {
      return 'RG - REGISTRO GERAL';
    }

    return '';
  }

  private findIssuingAgency(text: string): string {
    const normalized = this.normalizeForExtraction(text);

    if (/\bSSP[.-]?[A-Z]{2}\b|\bSSP\b/.test(normalized)) {
      return 'SSP';
    }

    if (/\bDETRAN\b|CARTEIRA NACIONAL DE HABILITACAO/.test(normalized)) {
      return 'ÓRGÃO DE TRÂNSITO';
    }

    return '';
  }

  private findDocumentUf(text: string): string {
    return this.normalizeForExtraction(text).match(/\b(?:SSP[.-]?|IRGD,SSP\.?)([A-Z]{2})\b/u)?.[1] ?? '';
  }

  private findMaritalStatus(text: string): string {
    const normalized = this.normalizeForExtraction(text);

    if (/\bCERTIDAO DE CASAMENTO\b|\bCASAMENTO\b/.test(normalized)) {
      return 'CASADO (A)';
    }

    return '';
  }

  private findEmail(text: string): string {
    return text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu)?.[0] ?? '';
  }

  private findPisNis(text: string): string {
    return text.match(/\b(?:PIS|NIS)\D{0,20}(\d{10,11})\b/iu)?.[1] ?? '';
  }

  private findCnh(text: string): string {
    return (
      text.match(/\b(?:CNH|HABILITAÇÃO|HABILITACAO)\D{0,40}(\d{9,11})\b/iu)?.[1] ??
      ''
    );
  }

  private findPhone(text: string): { ddd: string; number: string } {
    const match = text.match(/\b(?:\(?(\d{2})\)?\s*)?(9\d{4})[-\s]?(\d{4})\b/u);

    return {
      ddd: match?.[1] ?? '',
      number: match ? `${match[2]}${match[3]}` : '',
    };
  }

  private findIncomeCharacteristic(text: string): string {
    return this.findAdmissionDate(text) || this.findEmployerCnpj(text) ? 'COMPROVADA' : '';
  }

  private findIncomeSourceType(text: string): string {
    return this.findEmployerCnpj(text) ? 'JURÍDICA' : '';
  }

  private findEmployerCnpj(text: string): string {
    const normalized = this.normalizeForExtraction(text);
    const match = normalized.match(/\bCNPJ(?:\/MF)?\D{0,20}(\d{2}[.:]?\d{3}[.:]?\d{3}\/?\d{4}-?\d{2})\b/u);

    return match?.[1]?.replace(/\D/g, '') ?? '';
  }

  private findEmployerName(text: string): string {
    const normalized = this.normalizeForExtraction(text);
    const candidates = [
      normalized.match(/\bEMPREGAD[OA]R?:?\s*([A-ZÁÉÍÓÚÂÊÔÃÕÇ0-9 .&-]+?LTDA)\b/u)?.[1],
      normalized.match(/\bEMPRESA\s+\d+\s*-\s*([A-ZÁÉÍÓÚÂÊÔÃÕÇ0-9 .&-]+?LTDA)\b/u)?.[1],
      normalized.match(/\b([A-ZÁÉÍÓÚÂÊÔÃÕÇ0-9 .&-]+?LTDA)\b/u)?.[1],
    ].filter(Boolean);

    return candidates[0] ? this.toTitleCase(candidates[0]) : '';
  }

  private findOccupation(text: string): string {
    const normalized = this.normalizeForExtraction(text);
    const match = normalized.match(/\b(?:CARGO|ARGO)\s*:?\s*([A-ZÁÉÍÓÚÂÊÔÃÕÇ ()/-]+?)(?:\n|CBO|C\.B\.O|DATA|$)/u);

    return match?.[1] ? this.toTitleCase(match[1].trim()) : '';
  }

  private findAdmissionDate(text: string): string {
    return (
      this.normalizeForExtraction(text).match(/\bDATA\s+ADMISSAO\D{0,30}(\d{2}\/\d{2}\/\d{4})\b/u)?.[1] ??
      this.normalizeForExtraction(text).match(/\bADMISSAO\D{0,30}(\d{2}\/\d{2}\/\d{4})\b/u)?.[1] ??
      ''
    );
  }

  private findGrossIncome(text: string): string {
    const normalized = this.normalizeForExtraction(text);

    return (
      normalized.match(/\bTOTAL DE VENCIMENTOS\s+(\d{1,3}(?:\.\d{3})*,\d{2})\b/u)?.[1] ??
      normalized.match(/\bREMUNERAC[AÃ]O\D{0,20}(\d{1,3}(?:\.\d{3})*,\d{2})\b/u)?.[1] ??
      ''
    );
  }

  private findNetIncome(text: string): string {
    return (
      this.normalizeForExtraction(text).match(/\bVALOR LIQUIDO\s+(\d{1,3}(?:\.\d{3})*,\d{2})\b/u)?.[1] ??
      ''
    );
  }

  private normalizeForExtraction(text: string): string {
    return text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[ \t]+/g, ' ');
  }

  private toTitleCase(value: string): string {
    return value
      .toLowerCase()
      .replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
  }
}

function onlyDigits(value?: string): string {
  return value?.replace(/\D/g, '') ?? '';
}
