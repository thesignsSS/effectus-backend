import {
  CUSTOMER_REGISTRATION_FIELDS,
  CustomerRegistrationData,
  emptyCustomerRegistrationData,
} from '../../domain/constants/customer-registration-fields.constants.js';
import {
  CustomerRegistrationExtractionInput,
  CustomerRegistrationExtractor,
} from '../../domain/interfaces/customer-registration-extractor.interface.js';
import { Logger } from '../../domain/interfaces/logger.interface.js';

export interface OpenRouterCustomerRegistrationClientConfig {
  apiKey?: string;
  model: string;
  baseUrl: string;
}

interface OpenRouterChatResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

type OpenRouterContentPart =
  | {
      type: 'text';
      text: string;
    }
  | {
      type: 'image_url';
      image_url: {
        url: string;
      };
    };

type OpenRouterMessageContent =
  | string
  | OpenRouterContentPart[];

export class OpenRouterCustomerRegistrationClient
  implements CustomerRegistrationExtractor
{
  constructor(
    private readonly config: OpenRouterCustomerRegistrationClientConfig,
    private readonly logger: Logger,
  ) {}

  async extract(
    input: CustomerRegistrationExtractionInput,
  ): Promise<CustomerRegistrationData | undefined> {
    if (!this.config.apiKey) {
      this.logger.warn('OpenRouter não configurado; usando extração local');
      return undefined;
    }

    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.model,
        temperature: 0,
        response_format: {
          type: 'json_object',
        },
        messages: [
          {
            role: 'system',
            content: this.buildSystemPrompt(),
          },
          {
            role: 'user',
            content: this.buildUserContent(input),
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `OpenRouter failed with ${response.status}: ${errorBody.slice(0, 500)}`,
      );
    }

    const payload = (await response.json()) as OpenRouterChatResponse;
    const content = payload.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('OpenRouter returned an empty response');
    }

    return this.normalizeOutput(this.parseJson(content));
  }

  private buildSystemPrompt(): string {
    return [
      'Você extrai dados cadastrais de documentos brasileiros para preencher um formulário.',
      'Analise tanto o texto OCR quanto as imagens anexadas.',
      'Identifique o tipo de cada documento: CNH/RG/CPF, certidão de casamento, comprovante de residência, contrato de trabalho/CTPS, holerite/demonstrativo de pagamento e outros.',
      'Use certidão de casamento para nome completo, estado civil, nome do cônjuge se aparecer, naturalidade, nacionalidade e nomes de filiação.',
      'Em certidão de casamento, quando houver quadros CPF à direita de cada nome, capture o CPF que está na mesma linha do nome da pessoa cliente. Não confunda com CPF do cônjuge.',
      'Use contrato de trabalho/CTPS para ocupação, empregador/fonte pagadora, CNPJ, data de admissão, remuneração e município/UF do vínculo.',
      'Use holerite para renda bruta, renda líquida, cargo/ocupação, empregador, CNPJ e data de admissão.',
      'Use comprovante de residência para CEP, logradouro, endereço, número, complemento, bairro, município, UF e mês/ano do comprovante.',
      'Se o documento for RG, o número principal de identidade geralmente aparece no topo, e órgão/UF podem aparecer como SSP/SP ou IIRGD/SSP.SP.',
      'Prefira dados da pessoa cliente, não dados de dependentes, cônjuge, cartório, empregador, banco ou operador.',
      'Não use o nome informado no gatilho como verdade se os documentos indicarem outro nome completo.',
      'Para campos de seleção, use estes valores quando aplicáveis: Estado Civil CASADO (A), SOLTEIRO (A), DIVORCIADO (A), VIÚVO (A); Nacionalidade BRASILEIRA; Característica da Renda COMPROVADA ou SEM RENDA; Tipo de Fonte FÍSICA ou JURÍDICA; Tipo de Ocupação FORMAL.',
      'Responda apenas JSON válido.',
      'Use exatamente as chaves solicitadas.',
      'Se um campo não estiver nos documentos, use string vazia.',
      'Não invente dados.',
      'Normalize datas como DD/MM/AAAA quando possível.',
      'Para CPF, CNPJ, CEP, telefone, PIS/NIS e CNH, retorne somente dígitos.',
      'Para valores monetários, use formato brasileiro com vírgula decimal, sem R$.',
      'Não deixe CPF do Cliente vazio se houver CPF visível em RG, CPF, CNH ou certidão de casamento da pessoa cliente.',
    ].join(' ');
  }

  private buildUserContent(
    input: CustomerRegistrationExtractionInput,
  ): OpenRouterMessageContent {
    const content: OpenRouterContentPart[] = [
      {
        type: 'text',
        text: this.buildUserPrompt(input),
      },
    ];

    for (const document of input.documentTexts) {
      for (const image of document.visionInputs) {
        content.push({
          type: 'text',
          text: `Imagem/página do documento ${document.filename}: ${image.filename}`,
        });
        content.push({
          type: 'image_url',
          image_url: {
            url: image.dataUrl,
          },
        });
      }
    }

    return content;
  }

  private buildUserPrompt(input: CustomerRegistrationExtractionInput): string {
    return [
      'Preencha estes campos com base em todos os textos dos documentos e mensagens:',
      JSON.stringify(CUSTOMER_REGISTRATION_FIELDS),
      '',
      `Cliente informado no gatilho: ${input.clientName}`,
      `Corretor informado no gatilho: ${input.brokerName}`,
      '',
      'Mensagens adicionais:',
      input.additionalMessages.length > 0
        ? input.additionalMessages.join('\n---\n')
        : 'Nenhuma',
      '',
      'Documentos lidos:',
      input.documentTexts
        .map((document, index) =>
          [
            `Documento ${index + 1}`,
            `Arquivo: ${document.filename}`,
            `Nome original: ${document.originalName}`,
            `Imagens anexadas: ${document.visionInputs.length}`,
            'Texto:',
            document.text || '(sem texto OCR útil; use a imagem anexada)',
          ].join('\n'),
        )
        .join('\n\n---\n\n'),
      '',
      'Retorne um objeto JSON único em que cada chave é um dos campos e cada valor é uma string.',
    ].join('\n');
  }

  private parseJson(content: string): Record<string, unknown> {
    const fencedMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    const jsonText = fencedMatch?.[1] ?? content;

    return JSON.parse(jsonText) as Record<string, unknown>;
  }

  private normalizeOutput(output: Record<string, unknown>): CustomerRegistrationData {
    const data = emptyCustomerRegistrationData();

    for (const field of CUSTOMER_REGISTRATION_FIELDS) {
      const value = output[field];
      data[field] =
        typeof value === 'string' || typeof value === 'number'
          ? String(value).trim()
          : '';
    }

    return data;
  }
}
