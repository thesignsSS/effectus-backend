import { Document } from '../entities/document.entity.js';

export interface AutomationProvider {
  execute(document: Document): Promise<void>;
}
