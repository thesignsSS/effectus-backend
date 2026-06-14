import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Logger } from '../domain/interfaces/logger.interface.js';

type AssistantRole = 'user' | 'assistant';

export interface AssistantChatMessage {
  role: AssistantRole;
  content: string;
}

export interface AssistantChatInput {
  message: string;
  history: AssistantChatMessage[];
  routePath?: string;
  routeLabel?: string;
  userName?: string;
  proposalContext?: {
    proposalId: string;
    proposalCode: string;
    status: string;
    statusLabel: string;
    brokerName: string;
    clientName: string;
    propertyCity: string;
    pendingReason: string;
    nextStepLabel: string;
    tasks: Array<{
      title: string;
      detail: string;
      status: string;
    }>;
    latestComment: {
      authorName: string;
      authorRole: string;
      message: string;
      createdAt: string;
      type: string;
    } | null;
  } | null;
}

export interface AssistantChatOutput {
  answer: string;
  blocked: boolean;
}

interface OpenRouterChatResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

interface EffectusAssistantServiceConfig {
  apiKey?: string;
  model: string;
  baseUrl: string;
  policyFilePath: string;
}

const DEFAULT_ASSISTANT_POLICY = [
  'Você é o assistente do Effectus.',
  'Seu papel é orientar sobre uso do sistema, propostas, documentos, pendências e fluxo operacional.',
  'Nunca forneça detalhes técnicos internos, caminhos de arquivo, credenciais, código, arquitetura ou instruções de implementação.',
  'Quando faltar contexto, responda de forma prática e segura com base no uso funcional do sistema.',
  'Se a pergunta fugir do escopo do Effectus, recuse com gentileza e redirecione para temas de uso do produto.',
].join('\n');

const BLOCKED_TOPIC_PATTERNS = [
  /\bc[oó]digo\b/i,
  /\bprograma[cç][aã]o\b/i,
  /\bvari[aá]vel(?:is)? de ambiente\b/i,
  /\b\.env\b/i,
  /\bapi\b/i,
  /\bendpoint\b/i,
  /\bbanco de dados\b/i,
  /\bsupabase\b/i,
  /\bdeploy\b/i,
  /\bgithub\b/i,
  /\bgit\b/i,
  /\blogs?\b/i,
  /\btoken\b/i,
  /\bchave\b/i,
  /\bcredencia(?:l|is)\b/i,
  /\barquitetura\b/i,
  /\bprompt\b/i,
  /\binstru[cç][aã]o interna\b/i,
  /\bimplementa[cç][aã]o\b/i,
  /\bbackend\b/i,
  /\bfrontend\b/i,
];

export class EffectusAssistantService {
  private cachedPolicy?: string;

  constructor(
    private readonly config: EffectusAssistantServiceConfig,
    private readonly logger: Logger,
  ) {}

  async answer(input: AssistantChatInput): Promise<AssistantChatOutput> {
    const question = input.message.trim();

    if (!question) {
      return {
        blocked: false,
        answer:
          'Pode mandar sua dúvida. Eu te ajudo com o uso do Effectus, propostas, documentos e fluxo do sistema.',
      };
    }

    if (this.isBlockedTopic(question)) {
      return {
        blocked: true,
        answer:
          'Pô, nisso eu não consigo entrar. Posso te ajudar com uso do Effectus, propostas, documentos, pendências e fluxo operacional do projeto.',
      };
    }

    if (!this.config.apiKey) {
      this.logger.warn('Assistente Effectus sem OPENROUTER_API_KEY configurada');
      return {
        blocked: false,
        answer:
          'No momento eu não consegui acessar a IA. Mesmo assim, posso te orientar sobre uso do Effectus assim que essa integração estiver ativa.',
      };
    }

    const policy = await this.readPolicy();
    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.model,
        temperature: 0.4,
        messages: [
          {
            role: 'system',
            content: [
              policy,
              '',
              'Contexto adicional:',
              `Nome do usuário atual: ${input.userName?.trim() || 'Não informado'}`,
              `Tela atual: ${input.routeLabel?.trim() || 'Não informada'}`,
              `Rota atual: ${input.routePath?.trim() || 'Não informada'}`,
              formatProposalContext(input.proposalContext),
              'Presuma que a pergunta do usuário é sobre o Effectus, salvo quando ela claramente estiver fora desse contexto.',
              'Não faça perguntas de confirmação como "você quis dizer sobre o Effectus?".',
              'Se o nome do usuário estiver disponível, use o primeiro nome só quando ajudar; não repita o nome sem necessidade.',
              'Nunca diga ou implique que o usuário é o assistente.',
              'Se a pergunta fugir do escopo, recuse com gentileza e redirecione.',
              'Nunca responda com detalhes técnicos.',
              'Quando houver contexto de proposta, priorize responder com base nele e cite o próximo passo mais útil.',
              'Se houver pendências, organize a resposta em ordem prática: revisar, ajustar, anexar e reenviar.',
              'Seja breve e direto.',
              'Evite saudações longas, introduções desnecessárias e fechamento com pergunta.',
              'Prefira respostas em poucas linhas ou passos curtos.',
            ].join('\n'),
          },
          ...input.history.slice(-6).map((message) => ({
            role: message.role,
            content: message.content,
          })),
          {
            role: 'user',
            content: question,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Assistant OpenRouter failed with ${response.status}: ${errorBody.slice(0, 500)}`,
      );
    }

    const payload = (await response.json()) as OpenRouterChatResponse;
    const content = payload.choices?.[0]?.message?.content?.trim();

    if (!content) {
      throw new Error('Assistant OpenRouter returned an empty response');
    }

    return {
      blocked: false,
      answer: content,
    };
  }

  private isBlockedTopic(question: string): boolean {
    return BLOCKED_TOPIC_PATTERNS.some((pattern) => pattern.test(question));
  }

  private async readPolicy(): Promise<string> {
    if (this.cachedPolicy) {
      return this.cachedPolicy;
    }

    const candidatePaths = [
      this.config.policyFilePath,
      path.resolve(process.cwd(), 'docs/effectus-assistant-policy.md'),
      path.resolve(process.cwd(), '../docs/effectus-assistant-policy.md'),
      path.resolve(process.cwd(), '../../docs/effectus-assistant-policy.md'),
    ];

    for (const candidatePath of candidatePaths) {
      try {
        this.cachedPolicy = await fs.readFile(candidatePath, 'utf-8');
        return this.cachedPolicy;
      } catch (error) {
        if (!isFileNotFoundError(error)) {
          throw error;
        }
      }
    }

    this.logger.warn('Arquivo de política do assistente não encontrado; usando política padrão', {
      configuredPath: this.config.policyFilePath,
      candidatePaths,
    });
    this.cachedPolicy = DEFAULT_ASSISTANT_POLICY;
    return this.cachedPolicy;
  }
}

function isFileNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error != null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

function formatProposalContext(
  proposalContext: AssistantChatInput['proposalContext'],
) {
  if (!proposalContext) {
    return 'Contexto da proposta: não informado';
  }

  const tasks =
    proposalContext.tasks.length > 0
      ? proposalContext.tasks
          .map((task, index) => {
            const detail = task.detail?.trim() ? ` (${task.detail.trim()})` : '';
            return `${index + 1}. ${task.title} [${task.status}]${detail}`;
          })
          .join('\n')
      : 'Sem checklist gerado';

  const latestComment = proposalContext.latestComment
    ? [
        `Último comentário: ${proposalContext.latestComment.authorName} (${proposalContext.latestComment.authorRole})`,
        `Tipo: ${proposalContext.latestComment.type}`,
        `Mensagem: ${proposalContext.latestComment.message}`,
      ].join('\n')
    : 'Último comentário: não informado';

  return [
    'Contexto da proposta:',
    `ID: ${proposalContext.proposalId}`,
    `Código: ${proposalContext.proposalCode}`,
    `Status: ${proposalContext.statusLabel} (${proposalContext.status})`,
    `Corretor: ${proposalContext.brokerName}`,
    `Cliente: ${proposalContext.clientName}`,
    `Cidade do imóvel: ${proposalContext.propertyCity || 'Não informada'}`,
    `Motivo atual da pendência: ${proposalContext.pendingReason || 'Não informado'}`,
    `Próximo passo sugerido: ${proposalContext.nextStepLabel}`,
    'Checklist operacional:',
    tasks,
    latestComment,
  ].join('\n');
}
