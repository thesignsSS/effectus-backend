import { LeadAdAudience, MetaAuthorizedAccount, MetaLeadField } from './meta-ads-client.interface.js';

export const LEAD_STATUS_OPTIONS = ['new', 'contacted', 'qualified', 'discarded'] as const;
export type LeadStatus = (typeof LEAD_STATUS_OPTIONS)[number];

export type LeadAdCampaignStatus = 'creating' | 'active' | 'paused' | 'completed' | 'failed';

/** Conexão com tokens em texto puro. Só existe em memória, nunca sai da API. */
export type MetaConnection = MetaAuthorizedAccount & {
  id: string;
  companyId: string;
  connectedByUserId: string;
  connectedAt: string;
};

export type LeadAdCampaign = {
  id: string;
  name: string;
  instagramMediaId: string;
  instagramMediaPermalink: string | null;
  instagramMediaThumbnailUrl: string | null;
  instagramMediaCaption: string | null;
  budgetCents: number;
  budgetCurrency: string;
  durationDays: number;
  audience: LeadAdAudience;
  status: LeadAdCampaignStatus;
  failureReason: string | null;
  metaAdId: string | null;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  leadCount: number;
};

export type Lead = {
  id: string;
  campaignId: string | null;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  fields: MetaLeadField[];
  status: LeadStatus;
  receivedAt: string;
};

export type CreateLeadAdCampaignRecord = {
  companyId: string;
  createdByUserId: string;
  metaConnectionId: string;
  name: string;
  instagramMediaId: string;
  instagramMediaPermalink: string | null;
  instagramMediaThumbnailUrl: string | null;
  instagramMediaCaption: string | null;
  budgetCents: number;
  durationDays: number;
  audience: LeadAdAudience;
  startsAt: string;
  endsAt: string;
};

export type SaveIncomingLeadRecord = {
  companyId: string;
  campaignId: string | null;
  metaLeadgenId: string;
  metaFormId: string | null;
  metaAdId: string | null;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  fields: MetaLeadField[];
  receivedAt: string;
};

/**
 * Persistência da captação de leads. Não faz checagem de permissão: quem chama
 * (o serviço) já resolveu o `companyId` do dono da empresa. Todas as leituras
 * filtram por `companyId`, porque a service role ignora RLS.
 */
export interface LeadAdsStore {
  /** Empresa do usuário, exigindo que ele seja o dono dela. Lança "Sem permissão" se não for. */
  resolveOwnerCompanyId(userId: string): Promise<string>;

  saveConnection(input: {
    companyId: string;
    connectedByUserId: string;
    account: MetaAuthorizedAccount;
  }): Promise<void>;
  getConnection(companyId: string): Promise<MetaConnection | null>;
  getConnectionByPageId(pageId: string): Promise<MetaConnection | null>;
  revokeConnection(companyId: string): Promise<void>;

  createCampaign(input: CreateLeadAdCampaignRecord): Promise<LeadAdCampaign>;
  markCampaignLaunched(input: {
    campaignId: string;
    metaCampaignId: string;
    metaAdSetId: string;
    metaCreativeId: string;
    metaAdId: string;
    metaLeadFormId: string;
  }): Promise<void>;
  markCampaignFailed(campaignId: string, reason: string): Promise<void>;
  listCampaigns(companyId: string): Promise<LeadAdCampaign[]>;
  getCampaign(companyId: string, campaignId: string): Promise<LeadAdCampaign | null>;
  findCampaignIdByMetaAdId(companyId: string, metaAdId: string): Promise<string | null>;

  saveIncomingLead(input: SaveIncomingLeadRecord): Promise<void>;
  listLeads(companyId: string, filter: { campaignId?: string }): Promise<Lead[]>;
  updateLeadStatus(companyId: string, leadId: string, status: LeadStatus): Promise<void>;
}
