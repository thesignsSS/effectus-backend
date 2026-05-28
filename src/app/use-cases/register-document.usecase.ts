import { Document } from '../domain/entities/document.entity.js';
import { AutomationProvider } from '../domain/interfaces/automation.interface.js';
import { Logger } from '../domain/interfaces/logger.interface.js';

export class RegisterDocumentUseCase {
  constructor(
    private readonly automationProvider: AutomationProvider,
    private readonly logger: Logger,
  ) {}

  async execute(document: Document): Promise<void> {
    this.logger.info('Registro de documento solicitado', {
      name: document.name,
      sender: document.sender,
    });

    await this.automationProvider.execute(document);
  }
}
