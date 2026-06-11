export interface SaveBrokerClientInput {
  brokerUserId: string;
  brokerName: string;
  clientName: string;
  clientCpf?: string;
  clientEmail?: string;
  clientPhone?: string;
  formData: Record<string, unknown>;
}

export interface BrokerClientStore {
  save(input: SaveBrokerClientInput): Promise<void>;
}
