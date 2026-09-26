import { createHmac } from 'node:crypto';
import {
  InstagramMediaItem,
  LaunchedLeadAd,
  LaunchLeadAdInput,
  MetaAdsClient,
  MetaAuthorizedAccount,
  MetaCity,
  MetaLead,
} from '../../domain/interfaces/meta-ads-client.interface.js';
import { Logger } from '../../domain/interfaces/logger.interface.js';

export interface GraphMetaAdsClientConfig {
  appId: string;
  appSecret: string;
  apiVersion: string;
  redirectUri: string;
  /** Facebook Login for Business: quando definido, substitui a lista de escopos. */
  loginConfigId?: string;
  /** Imóveis costumam exigir `HOUSING`, que restringe idade/gênero e raio mínimo. */
  specialAdCategories: string[];
}

const SCOPES = [
  'ads_management',
  'business_management',
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_ads',
  'pages_manage_metadata',
  'instagram_basic',
  'leads_retrieval',
];

// Limite mínimo de raio que a Meta aceita na categoria especial HOUSING.
const HOUSING_MIN_RADIUS_KM = 25;

type GraphParams = Record<string, string | number | boolean | object | undefined>;

export class GraphMetaAdsClient implements MetaAdsClient {
  private readonly baseUrl: string;

  constructor(
    private readonly config: GraphMetaAdsClientConfig,
    private readonly logger: Logger,
  ) {
    this.baseUrl = `https://graph.facebook.com/${config.apiVersion}`;
  }

  getAuthorizationUrl(state: string): string {
    const url = new URL(`https://www.facebook.com/${this.config.apiVersion}/dialog/oauth`);
    url.searchParams.set('client_id', this.config.appId);
    url.searchParams.set('redirect_uri', this.config.redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('response_type', 'code');

    if (this.config.loginConfigId) {
      url.searchParams.set('config_id', this.config.loginConfigId);
    } else {
      url.searchParams.set('scope', SCOPES.join(','));
    }

    return url.toString();
  }

  async authorize(code: string): Promise<MetaAuthorizedAccount> {
    const shortLived = await this.get<{ access_token: string }>('/oauth/access_token', {
      client_id: this.config.appId,
      client_secret: this.config.appSecret,
      redirect_uri: this.config.redirectUri,
      code,
    });

    const longLived = await this.get<{ access_token: string; expires_in?: number }>(
      '/oauth/access_token',
      {
        grant_type: 'fb_exchange_token',
        client_id: this.config.appId,
        client_secret: this.config.appSecret,
        fb_exchange_token: shortLived.access_token,
      },
    );
    const userToken = longLived.access_token;

    const [me, pages, adAccounts] = await Promise.all([
      this.get<{ id: string }>('/me', { fields: 'id' }, userToken),
      this.get<{
        data: Array<{
          id: string;
          name?: string;
          access_token: string;
          instagram_business_account?: { id: string; username?: string };
        }>;
      }>(
        '/me/accounts',
        { fields: 'id,name,access_token,instagram_business_account{id,username}', limit: 100 },
        userToken,
      ),
      this.get<{ data: Array<{ id: string; account_status: number }> }>(
        '/me/adaccounts',
        { fields: 'id,account_status', limit: 100 },
        userToken,
      ),
    ]);

    // Sem tela de escolha por enquanto: usa a primeira página com Instagram
    // Business vinculado e a primeira conta de anúncios ativa (status 1).
    const page = pages.data.find((item) => item.instagram_business_account?.id);
    if (!page?.instagram_business_account) {
      throw new Error(
        'Nenhuma página do Facebook com conta do Instagram Business vinculada foi autorizada.',
      );
    }

    const adAccount = adAccounts.data.find((item) => item.account_status === 1);
    if (!adAccount) {
      throw new Error('Nenhuma conta de anúncios ativa foi autorizada.');
    }

    return {
      metaUserId: me.id,
      userAccessToken: userToken,
      userTokenExpiresAt: longLived.expires_in
        ? new Date(Date.now() + longLived.expires_in * 1000).toISOString()
        : null,
      pageId: page.id,
      pageName: page.name ?? null,
      pageAccessToken: page.access_token,
      instagramBusinessId: page.instagram_business_account.id,
      instagramUsername: page.instagram_business_account.username ?? null,
      adAccountId: adAccount.id,
    };
  }

  async subscribePageToLeads(pageId: string, pageAccessToken: string): Promise<void> {
    await this.post(
      `/${pageId}/subscribed_apps`,
      { subscribed_fields: 'leadgen' },
      pageAccessToken,
    );
  }

  async listInstagramMedia(
    instagramBusinessId: string,
    userAccessToken: string,
  ): Promise<InstagramMediaItem[]> {
    const response = await this.get<{
      data: Array<{
        id: string;
        caption?: string;
        media_type: string;
        media_url?: string;
        thumbnail_url?: string;
        permalink?: string;
        timestamp?: string;
      }>;
    }>(
      `/${instagramBusinessId}/media`,
      { fields: 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp', limit: 30 },
      userAccessToken,
    );

    return response.data.map((item) => ({
      id: item.id,
      caption: item.caption ?? null,
      mediaType: item.media_type,
      mediaUrl: item.media_url ?? null,
      thumbnailUrl: item.thumbnail_url ?? item.media_url ?? null,
      permalink: item.permalink ?? null,
      timestamp: item.timestamp ?? null,
    }));
  }

  async searchCities(query: string, userAccessToken: string): Promise<MetaCity[]> {
    const response = await this.get<{
      data: Array<{ key: string; name: string; region?: string; country_code?: string }>;
    }>(
      '/search',
      {
        type: 'adgeolocation',
        location_types: ['city'],
        country_code: 'BR',
        q: query,
        limit: 10,
      },
      userAccessToken,
    );

    return response.data.map((item) => ({
      key: item.key,
      name: item.name,
      region: item.region ?? null,
      countryCode: item.country_code ?? null,
    }));
  }

  async launchLeadAd(input: LaunchLeadAdInput): Promise<LaunchedLeadAd> {
    const token = input.userAccessToken;
    const act = input.adAccountId.startsWith('act_')
      ? input.adAccountId
      : `act_${input.adAccountId}`;
    let campaignId: string | undefined;

    try {
      const campaign = await this.post<{ id: string }>(
        `/${act}/campaigns`,
        {
          name: input.name,
          objective: 'OUTCOME_LEADS',
          status: 'ACTIVE',
          special_ad_categories: this.config.specialAdCategories,
          is_adset_budget_sharing_enabled: false,
        },
        token,
      );
      campaignId = campaign.id;

      const leadForm = await this.post<{ id: string }>(
        `/${input.pageId}/leadgen_forms`,
        {
          name: `${input.name} - formulário`,
          locale: 'pt_BR',
          questions: [{ type: 'FULL_NAME' }, { type: 'EMAIL' }, { type: 'PHONE' }],
          privacy_policy: { url: input.privacyPolicyUrl },
        },
        input.pageAccessToken,
      );

      const adSet = await this.post<{ id: string }>(
        `/${act}/adsets`,
        {
          name: `${input.name} - público`,
          campaign_id: campaign.id,
          lifetime_budget: input.budgetCents,
          start_time: input.startsAt.toISOString(),
          end_time: input.endsAt.toISOString(),
          billing_event: 'IMPRESSIONS',
          optimization_goal: 'LEAD_GENERATION',
          bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
          destination_type: 'ON_AD',
          promoted_object: { page_id: input.pageId },
          targeting: this.buildTargeting(input),
          status: 'ACTIVE',
        },
        token,
      );

      const creative = await this.post<{ id: string }>(
        `/${act}/adcreatives`,
        {
          name: `${input.name} - criativo`,
          object_id: input.pageId,
          instagram_user_id: input.instagramBusinessId,
          source_instagram_media_id: input.instagramMediaId,
          call_to_action: {
            type: 'SIGN_UP',
            value: { lead_gen_form_id: leadForm.id },
          },
        },
        token,
      );

      const ad = await this.post<{ id: string }>(
        `/${act}/ads`,
        {
          name: input.name,
          adset_id: adSet.id,
          creative: { creative_id: creative.id },
          status: 'ACTIVE',
        },
        token,
      );

      return {
        campaignId: campaign.id,
        adSetId: adSet.id,
        leadFormId: leadForm.id,
        creativeId: creative.id,
        adId: ad.id,
      };
    } catch (error) {
      // Apagar a campanha leva junto adset/ads já criados: não sobra nada
      // cobrando na conta de anúncios do cliente.
      if (campaignId) {
        await this.delete(`/${campaignId}`, token).catch((cleanupError: unknown) => {
          this.logger.error('Falha ao desfazer campanha parcial na Meta', {
            campaignId,
            error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          });
        });
      }

      throw error;
    }
  }

  async fetchLead(leadgenId: string, pageAccessToken: string): Promise<MetaLead> {
    const lead = await this.get<{
      id: string;
      created_time: string;
      ad_id?: string;
      form_id?: string;
      field_data?: Array<{ name: string; values: string[] }>;
    }>(
      `/${leadgenId}`,
      { fields: 'id,created_time,ad_id,form_id,field_data' },
      pageAccessToken,
    );

    return {
      id: lead.id,
      createdTime: lead.created_time,
      adId: lead.ad_id ?? null,
      formId: lead.form_id ?? null,
      fields: lead.field_data ?? [],
    };
  }

  private buildTargeting(input: LaunchLeadAdInput): object {
    const isHousing = this.config.specialAdCategories.includes('HOUSING');
    const { audience } = input;

    const geoLocations = audience.city
      ? {
          cities: [
            {
              key: audience.city.key,
              radius: isHousing
                ? Math.max(audience.city.radiusKm, HOUSING_MIN_RADIUS_KM)
                : audience.city.radiusKm,
              distance_unit: 'kilometer',
            },
          ],
        }
      : { countries: audience.countries };

    return {
      geo_locations: geoLocations,
      // HOUSING proíbe segmentar por idade: a Meta rejeita qualquer faixa
      // diferente da padrão.
      ...(isHousing ? {} : { age_min: audience.ageMin, age_max: audience.ageMax }),
      publisher_platforms: ['instagram'],
      instagram_positions: ['stream', 'story', 'explore'],
    };
  }

  private async get<T>(path: string, params: GraphParams, token?: string): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(this.withAuth(params, token))) {
      url.searchParams.set(key, value);
    }

    return this.send<T>(url, { method: 'GET' });
  }

  private async post<T = unknown>(path: string, params: GraphParams, token: string): Promise<T> {
    return this.send<T>(new URL(`${this.baseUrl}${path}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(this.withAuth(params, token)).toString(),
    });
  }

  private async delete(path: string, token: string): Promise<void> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(this.withAuth({}, token))) {
      url.searchParams.set(key, value);
    }

    await this.send(url, { method: 'DELETE' });
  }

  /** Objetos vão como JSON dentro do form, que é o formato que a Graph API espera. */
  private withAuth(params: GraphParams, token?: string): Record<string, string> {
    const encoded: Record<string, string> = {};

    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue;
      encoded[key] = typeof value === 'object' ? JSON.stringify(value) : String(value);
    }

    if (token) {
      encoded.access_token = token;
      encoded.appsecret_proof = createHmac('sha256', this.config.appSecret)
        .update(token)
        .digest('hex');
    }

    return encoded;
  }

  private async send<T>(url: URL, init: RequestInit): Promise<T> {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
    const body = (await response.json().catch(() => ({}))) as {
      error?: { message?: string; error_user_msg?: string; code?: number };
    };

    if (!response.ok || body.error) {
      const detail = body.error?.error_user_msg ?? body.error?.message ?? `HTTP ${response.status}`;
      throw new MetaApiError(`Meta: ${detail}`, body.error?.code);
    }

    return body as T;
  }
}

export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
    this.name = 'MetaApiError';
  }
}
