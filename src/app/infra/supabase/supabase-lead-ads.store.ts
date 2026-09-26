import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  CreateLeadAdCampaignRecord,
  Lead,
  LeadAdCampaign,
  LeadAdCampaignStatus,
  LeadAdsStore,
  LeadStatus,
  MetaConnection,
  SaveIncomingLeadRecord,
} from '../../domain/interfaces/lead-ads-store.interface.js';
import {
  LeadAdAudience,
  MetaAuthorizedAccount,
  MetaLeadField,
} from '../../domain/interfaces/meta-ads-client.interface.js';
import { TokenCipher } from '../../utils/token-cipher.js';
import { resolveCompanyIdForOwner } from './company-scope.js';

export interface SupabaseLeadAdsStoreConfig {
  url?: string;
  serviceRoleKey?: string;
}

type ConnectionRow = {
  id: string;
  company_id: string;
  connected_by_user_id: string;
  meta_user_id: string;
  page_id: string;
  page_name: string | null;
  instagram_business_id: string;
  instagram_username: string | null;
  ad_account_id: string;
  user_access_token_encrypted: string;
  page_access_token_encrypted: string;
  token_expires_at: string | null;
  connected_at: string;
};

type CampaignRow = {
  id: string;
  name: string;
  instagram_media_id: string;
  instagram_media_permalink: string | null;
  instagram_media_thumbnail_url: string | null;
  instagram_media_caption: string | null;
  budget_cents: number;
  budget_currency: string;
  duration_days: number;
  audience: LeadAdAudience;
  status: LeadAdCampaignStatus;
  failure_reason: string | null;
  meta_ad_id: string | null;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  leads?: Array<{ count: number }>;
};

type LeadRow = {
  id: string;
  campaign_id: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  raw_fields: MetaLeadField[] | null;
  status: LeadStatus;
  received_at: string;
};

const CONNECTION_COLUMNS =
  'id, company_id, connected_by_user_id, meta_user_id, page_id, page_name, instagram_business_id, instagram_username, ad_account_id, user_access_token_encrypted, page_access_token_encrypted, token_expires_at, connected_at';

const CAMPAIGN_COLUMNS =
  'id, name, instagram_media_id, instagram_media_permalink, instagram_media_thumbnail_url, instagram_media_caption, budget_cents, budget_currency, duration_days, audience, status, failure_reason, meta_ad_id, starts_at, ends_at, created_at, leads(count)';

const LEAD_COLUMNS =
  'id, campaign_id, full_name, email, phone, raw_fields, status, received_at';

export class SupabaseLeadAdsStore implements LeadAdsStore {
  private readonly client: SupabaseClient;

  constructor(
    config: SupabaseLeadAdsStoreConfig,
    private readonly tokenCipher: TokenCipher,
  ) {
    if (!config.url || !config.serviceRoleKey) {
      throw new Error(
        'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for lead ads',
      );
    }

    this.client = createClient(config.url, config.serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  resolveOwnerCompanyId(userId: string): Promise<string> {
    return resolveCompanyIdForOwner(this.client, userId);
  }

  async saveConnection(input: {
    companyId: string;
    connectedByUserId: string;
    account: MetaAuthorizedAccount;
  }): Promise<void> {
    const { account } = input;
    const { error } = await this.client.from('meta_connections').upsert(
      {
        company_id: input.companyId,
        connected_by_user_id: input.connectedByUserId,
        meta_user_id: account.metaUserId,
        page_id: account.pageId,
        page_name: account.pageName,
        instagram_business_id: account.instagramBusinessId,
        instagram_username: account.instagramUsername,
        ad_account_id: account.adAccountId,
        user_access_token_encrypted: this.tokenCipher.encrypt(account.userAccessToken),
        page_access_token_encrypted: this.tokenCipher.encrypt(account.pageAccessToken),
        token_expires_at: account.userTokenExpiresAt,
        status: 'connected',
        connected_at: new Date().toISOString(),
      },
      { onConflict: 'company_id' },
    );

    if (error) {
      throw new Error(`Falha ao salvar conexão com a Meta: ${error.message}`);
    }
  }

  async getConnection(companyId: string): Promise<MetaConnection | null> {
    const { data, error } = await this.client
      .from('meta_connections')
      .select(CONNECTION_COLUMNS)
      .eq('company_id', companyId)
      .eq('status', 'connected')
      .maybeSingle();

    if (error) {
      throw new Error(`Falha ao ler conexão com a Meta: ${error.message}`);
    }

    return data ? this.toConnection(data as ConnectionRow) : null;
  }

  async getConnectionByPageId(pageId: string): Promise<MetaConnection | null> {
    const { data, error } = await this.client
      .from('meta_connections')
      .select(CONNECTION_COLUMNS)
      .eq('page_id', pageId)
      .eq('status', 'connected')
      .order('connected_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Falha ao ler conexão com a Meta: ${error.message}`);
    }

    return data ? this.toConnection(data as ConnectionRow) : null;
  }

  async revokeConnection(companyId: string): Promise<void> {
    const { error } = await this.client
      .from('meta_connections')
      .update({ status: 'revoked' })
      .eq('company_id', companyId);

    if (error) {
      throw new Error(`Falha ao desconectar a Meta: ${error.message}`);
    }
  }

  async createCampaign(input: CreateLeadAdCampaignRecord): Promise<LeadAdCampaign> {
    const { data, error } = await this.client
      .from('lead_ad_campaigns')
      .insert({
        company_id: input.companyId,
        created_by_user_id: input.createdByUserId,
        meta_connection_id: input.metaConnectionId,
        name: input.name,
        instagram_media_id: input.instagramMediaId,
        instagram_media_permalink: input.instagramMediaPermalink,
        instagram_media_thumbnail_url: input.instagramMediaThumbnailUrl,
        instagram_media_caption: input.instagramMediaCaption,
        budget_cents: input.budgetCents,
        duration_days: input.durationDays,
        audience: input.audience,
        starts_at: input.startsAt,
        ends_at: input.endsAt,
        status: 'creating',
      })
      .select(CAMPAIGN_COLUMNS)
      .single();

    if (error || !data) {
      throw new Error(`Falha ao registrar campanha: ${error?.message ?? 'sem retorno'}`);
    }

    return this.toCampaign(data as CampaignRow);
  }

  async markCampaignLaunched(input: {
    campaignId: string;
    metaCampaignId: string;
    metaAdSetId: string;
    metaCreativeId: string;
    metaAdId: string;
    metaLeadFormId: string;
  }): Promise<void> {
    const { error } = await this.client
      .from('lead_ad_campaigns')
      .update({
        status: 'active',
        failure_reason: null,
        meta_campaign_id: input.metaCampaignId,
        meta_adset_id: input.metaAdSetId,
        meta_creative_id: input.metaCreativeId,
        meta_ad_id: input.metaAdId,
        meta_lead_form_id: input.metaLeadFormId,
      })
      .eq('id', input.campaignId);

    if (error) {
      throw new Error(`Falha ao atualizar campanha: ${error.message}`);
    }
  }

  async markCampaignFailed(campaignId: string, reason: string): Promise<void> {
    const { error } = await this.client
      .from('lead_ad_campaigns')
      .update({ status: 'failed', failure_reason: reason.slice(0, 2000) })
      .eq('id', campaignId);

    if (error) {
      throw new Error(`Falha ao atualizar campanha: ${error.message}`);
    }
  }

  async listCampaigns(companyId: string): Promise<LeadAdCampaign[]> {
    const { data, error } = await this.client
      .from('lead_ad_campaigns')
      .select(CAMPAIGN_COLUMNS)
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Falha ao listar campanhas: ${error.message}`);
    }

    return ((data as CampaignRow[] | null) ?? []).map((row) => this.toCampaign(row));
  }

  async getCampaign(companyId: string, campaignId: string): Promise<LeadAdCampaign | null> {
    const { data, error } = await this.client
      .from('lead_ad_campaigns')
      .select(CAMPAIGN_COLUMNS)
      .eq('company_id', companyId)
      .eq('id', campaignId)
      .maybeSingle();

    if (error) {
      throw new Error(`Falha ao ler campanha: ${error.message}`);
    }

    return data ? this.toCampaign(data as CampaignRow) : null;
  }

  async findCampaignIdByMetaAdId(companyId: string, metaAdId: string): Promise<string | null> {
    const { data, error } = await this.client
      .from('lead_ad_campaigns')
      .select('id')
      .eq('company_id', companyId)
      .eq('meta_ad_id', metaAdId)
      .maybeSingle();

    if (error) {
      throw new Error(`Falha ao localizar campanha do anúncio: ${error.message}`);
    }

    return (data?.id as string | undefined) ?? null;
  }

  async saveIncomingLead(input: SaveIncomingLeadRecord): Promise<void> {
    const { error } = await this.client.from('leads').upsert(
      {
        company_id: input.companyId,
        campaign_id: input.campaignId,
        meta_leadgen_id: input.metaLeadgenId,
        meta_form_id: input.metaFormId,
        meta_ad_id: input.metaAdId,
        full_name: input.fullName,
        email: input.email,
        phone: input.phone,
        raw_fields: input.fields,
        received_at: input.receivedAt,
      },
      // Reentrega do webhook não pode sobrescrever o status que o corretor já deu.
      { onConflict: 'meta_leadgen_id', ignoreDuplicates: true },
    );

    if (error) {
      throw new Error(`Falha ao salvar lead: ${error.message}`);
    }
  }

  async listLeads(companyId: string, filter: { campaignId?: string }): Promise<Lead[]> {
    let query = this.client
      .from('leads')
      .select(LEAD_COLUMNS)
      .eq('company_id', companyId)
      .order('received_at', { ascending: false })
      .limit(500);

    if (filter.campaignId) {
      query = query.eq('campaign_id', filter.campaignId);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Falha ao listar leads: ${error.message}`);
    }

    return ((data as LeadRow[] | null) ?? []).map((row) => ({
      id: row.id,
      campaignId: row.campaign_id,
      fullName: row.full_name,
      email: row.email,
      phone: row.phone,
      fields: row.raw_fields ?? [],
      status: row.status,
      receivedAt: row.received_at,
    }));
  }

  async updateLeadStatus(companyId: string, leadId: string, status: LeadStatus): Promise<void> {
    const { data, error } = await this.client
      .from('leads')
      .update({ status })
      .eq('company_id', companyId)
      .eq('id', leadId)
      .select('id');

    if (error) {
      throw new Error(`Falha ao atualizar lead: ${error.message}`);
    }

    if (!data?.length) {
      throw new Error('Lead não encontrado');
    }
  }

  private toConnection(row: ConnectionRow): MetaConnection {
    return {
      id: row.id,
      companyId: row.company_id,
      connectedByUserId: row.connected_by_user_id,
      connectedAt: row.connected_at,
      metaUserId: row.meta_user_id,
      pageId: row.page_id,
      pageName: row.page_name,
      instagramBusinessId: row.instagram_business_id,
      instagramUsername: row.instagram_username,
      adAccountId: row.ad_account_id,
      userAccessToken: this.tokenCipher.decrypt(row.user_access_token_encrypted),
      pageAccessToken: this.tokenCipher.decrypt(row.page_access_token_encrypted),
      userTokenExpiresAt: row.token_expires_at,
    };
  }

  private toCampaign(row: CampaignRow): LeadAdCampaign {
    return {
      id: row.id,
      name: row.name,
      instagramMediaId: row.instagram_media_id,
      instagramMediaPermalink: row.instagram_media_permalink,
      instagramMediaThumbnailUrl: row.instagram_media_thumbnail_url,
      instagramMediaCaption: row.instagram_media_caption,
      budgetCents: Number(row.budget_cents),
      budgetCurrency: row.budget_currency,
      durationDays: row.duration_days,
      audience: row.audience,
      status: row.status,
      failureReason: row.failure_reason,
      metaAdId: row.meta_ad_id,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      createdAt: row.created_at,
      leadCount: row.leads?.[0]?.count ?? 0,
    };
  }
}
