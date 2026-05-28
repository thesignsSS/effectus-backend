import { CustomerRegistrationData } from '../constants/customer-registration-fields.constants.js';

export interface CustomerRegistrationExtractionInput {
  clientName: string;
  brokerName: string;
  documentTexts: Array<{
    filename: string;
    originalName: string;
    text: string;
    visionInputs: Array<{
      filename: string;
      mimeType: string;
      dataUrl: string;
    }>;
  }>;
  additionalMessages: string[];
}

export interface CustomerRegistrationExtractor {
  extract(
    input: CustomerRegistrationExtractionInput,
  ): Promise<CustomerRegistrationData | undefined>;
}
