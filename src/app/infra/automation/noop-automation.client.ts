import { Document } from '../../domain/entities/document.entity.js';
import { AutomationProvider } from '../../domain/interfaces/automation.interface.js';

export class NoopAutomationClient implements AutomationProvider {
  async execute(_document: Document): Promise<void> {
    return Promise.resolve();
  }
}
