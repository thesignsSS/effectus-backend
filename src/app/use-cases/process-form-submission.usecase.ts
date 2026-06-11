import { BrokerClientStore } from '../domain/interfaces/broker-client-store.interface.js';
import {
  ProposalDocumentInput,
  ProposalStatusInfo,
  ProposalStore,
} from '../domain/interfaces/proposal-store.interface.js';
import { FileExtension } from '../domain/constants/file.constants.js';
import { Logger } from '../domain/interfaces/logger.interface.js';
import { OneDriveService } from '../services/onedrive.service.js';
import { WhatsAppService } from '../services/whatsapp.service.js';
import {
  generateDocumentFileName,
  getContentTypeByFilename,
  getFileExtension,
  isValidExtension,
} from '../utils/file-validator.js';

export interface FormSubmissionDocument {
  filename: string;
  contentBase64: string;
}

export interface FormSubmissionInput {
  brokerUserId?: string;
  brokerName: string;
  brokerPhone?: string;
  clientName: string;
  formData: Record<string, unknown>;
  documents: FormSubmissionDocument[];
}

export interface FormSubmissionResult {
  proposalCode?: string;
  proposalId?: string;
  proposalStatus?: string;
  proposalStatusLabel?: string;
  savedClient: boolean;
  uploadedLocations: string[];
}

export class ProcessFormSubmissionUseCase {
  constructor(
    private readonly storageService: OneDriveService,
    private readonly brokerClientStore: BrokerClientStore,
    private readonly proposalStore: ProposalStore,
    private readonly whatsAppService: WhatsAppService,
    private readonly logger: Logger,
  ) {}

  async execute(input: FormSubmissionInput): Promise<FormSubmissionResult> {
    const createdAt = new Date();
    const uploadOptions = {
      brokerName: input.brokerName,
      clientName: input.clientName,
    };
    const uploadedLocations: string[] = [];
    const proposalDocuments: ProposalDocumentInput[] = [];

    const report = this.buildFormReport(input, createdAt);
    const reportFilename = generateDocumentFileName({
      createdAt,
      sender: 'endpoint',
      originalName: `dados_formulario_${input.clientName}.${FileExtension.TXT}`,
      clientName: input.clientName,
      brokerName: input.brokerName,
    });

    const reportBuffer = Buffer.from(report, 'utf-8');
    const reportLocation = await this.storageService.upload(
      reportBuffer,
      reportFilename,
      uploadOptions,
    );
    uploadedLocations.push(reportLocation);
    proposalDocuments.push({
      filename: reportFilename,
      originalFilename: `dados_formulario_${input.clientName}.${FileExtension.TXT}`,
      storageLocation: reportLocation,
      contentType: getContentTypeByFilename(reportFilename),
      sizeBytes: reportBuffer.length,
      uploadedAt: createdAt.toISOString(),
    });

    for (const [index, document] of input.documents.entries()) {
      const extension = getFileExtension(document.filename);

      if (!isValidExtension(extension)) {
        throw new Error(`Extensão inválida no documento: ${document.filename}`);
      }

      const buffer = Buffer.from(document.contentBase64, 'base64');

      if (!buffer.length || buffer.toString('base64') !== normalizeBase64(document.contentBase64)) {
        throw new Error(`Base64 inválido no documento: ${document.filename}`);
      }

      const filename = generateDocumentFileName({
        createdAt,
        sender: 'endpoint',
        originalName: document.filename,
        messageId: `api-${index + 1}`,
        clientName: input.clientName,
        brokerName: input.brokerName,
      });

      const location = await this.storageService.upload(buffer, filename, uploadOptions);
      uploadedLocations.push(location);
      proposalDocuments.push({
        filename,
        originalFilename: document.filename,
        storageLocation: location,
        contentType: getContentTypeByFilename(filename),
        sizeBytes: buffer.length,
        uploadedAt: createdAt.toISOString(),
      });
    }

    const savedClient = await this.saveBrokerClientIfPossible(input);
    const savedProposal = await this.saveProposalIfPossible(input, proposalDocuments);

    try {
      await this.whatsAppService.sendTextToConfiguredChat(
        [
          'Nova proposta recebida.',
          savedProposal?.proposalCode
            ? `Proposta: ${savedProposal.proposalCode}`
            : undefined,
          `Corretor: ${input.brokerName}`,
          `Cliente: ${input.clientName}`,
          `Documentos enviados: ${input.documents.length}`,
          `Arquivos salvos: ${uploadedLocations.length}`,
        ].filter((line): line is string => Boolean(line)).join('\n'),
      );
    } catch (error) {
      this.logger.warn('Aviso de submissão não enviado pelo WhatsApp', {
        brokerName: input.brokerName,
        clientName: input.clientName,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    this.logger.info('Submissão do endpoint processada com sucesso', {
      brokerName: input.brokerName,
      clientName: input.clientName,
      filesUploaded: uploadedLocations.length,
      savedClient,
      proposalId: savedProposal?.id,
      proposalCode: savedProposal?.proposalCode,
    });

    return {
      proposalCode: savedProposal?.proposalCode,
      proposalId: savedProposal?.id,
      proposalStatus: savedProposal?.status,
      proposalStatusLabel: savedProposal?.statusLabel,
      savedClient,
      uploadedLocations,
    };
  }

  private buildFormReport(input: FormSubmissionInput, createdAt: Date): string {
    const lines = [
      'Dados do formulário',
      `Recebido em: ${createdAt.toISOString()}`,
      `Corretor: ${input.brokerName}`,
      input.brokerPhone ? `WhatsApp do corretor: ${input.brokerPhone}` : undefined,
      `Cliente: ${input.clientName}`,
      '',
      ...Object.entries(input.formData).map(
        ([key, value]) => `${key}: ${formatValue(value)}`,
      ),
      '',
    ];

    return lines.join('\n');
  }

  private async saveBrokerClientIfPossible(
    input: FormSubmissionInput,
  ): Promise<boolean> {
    if (!input.brokerUserId) {
      this.logger.warn('Cadastro do cliente nao foi persistido: brokerUserId ausente', {
        brokerName: input.brokerName,
        clientName: input.clientName,
      });
      return false;
    }

    await this.brokerClientStore.save({
      brokerUserId: input.brokerUserId,
      brokerName: input.brokerName,
      clientName: input.clientName,
      clientCpf: findFirstString(input.formData, [
        'CPF do Cliente',
        'cpf',
        'cpfCliente',
      ]),
      clientEmail: findFirstString(input.formData, [
        'E-mail do Cliente',
        'E-mail',
        'email',
        'emailCliente',
      ]),
      clientPhone: findFirstString(input.formData, [
        'Telefone do Cliente',
        'Telefone Celular Número',
        'telefone',
        'telefoneCliente',
      ]),
      formData: input.formData,
    });

    return true;
  }

  private async saveProposalIfPossible(
    input: FormSubmissionInput,
    documents: Array<{
      filename: string;
      originalFilename: string;
      storageLocation: string;
      contentType: string;
      sizeBytes: number;
      uploadedAt: string;
    }>,
  ): Promise<({ id: string; proposalCode: string } & ProposalStatusInfo) | undefined> {
    if (!input.brokerUserId) {
      this.logger.warn('Proposta nao foi persistida: brokerUserId ausente', {
        brokerName: input.brokerName,
        clientName: input.clientName,
      });
      return undefined;
    }

    return this.proposalStore.create({
      brokerUserId: input.brokerUserId,
      brokerName: input.brokerName,
      brokerPhone: input.brokerPhone ?? findFirstString(input.formData, [
        'WhatsApp do Corretor',
        'WPP do Corretor',
        'Telefone do Corretor',
        'brokerPhone',
        'corretorWpp',
      ]),
      clientName: input.clientName,
      clientCpf: findFirstString(input.formData, [
        'CPF do Cliente',
        'cpf',
        'cpfCliente',
      ]),
      clientEmail: findFirstString(input.formData, [
        'E-mail do Cliente',
        'E-mail',
        'email',
        'emailCliente',
      ]),
      clientPhone: findFirstString(input.formData, [
        'Telefone do Cliente',
        'Telefone Celular Número',
        'telefone',
        'telefoneCliente',
      ]),
      propertyType: findFirstString(input.formData, [
        'Tipo do Imóvel',
        'Tipo de Imóvel',
        'propertyType',
      ]),
      propertyCity: findFirstString(input.formData, [
        'Município do Imóvel',
        'Município',
        'propertyCity',
      ]),
      propertyState: findFirstString(input.formData, [
        'UF do Imóvel',
        'UF do Endereço',
        'propertyState',
      ]),
      additionalInfo: findFirstString(input.formData, [
        'Informações Adicionais',
        'additionalInfo',
      ]),
      formData: input.formData,
      documents,
    });
  }
}

function normalizeBase64(value: string): string {
  return value.replace(/\s+/g, '');
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return JSON.stringify(value);
}

function findFirstString(
  formData: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = formData[key];

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}
