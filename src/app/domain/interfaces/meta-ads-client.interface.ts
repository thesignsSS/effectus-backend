export type MetaAuthorizedAccount = {
  metaUserId: string;
  userAccessToken: string;
  userTokenExpiresAt: string | null;
  pageId: string;
  pageName: string | null;
  pageAccessToken: string;
  instagramBusinessId: string;
  instagramUsername: string | null;
  adAccountId: string;
};

export type InstagramMediaItem = {
  id: string;
  caption: string | null;
  mediaType: string;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  permalink: string | null;
  timestamp: string | null;
};

export type MetaCity = {
  key: string;
  name: string;
  region: string | null;
  countryCode: string | null;
};

export type LeadAdAudience = {
  city?: { key: string; name: string; radiusKm: number };
  countries: string[];
  ageMin: number;
  ageMax: number;
};

export type LaunchLeadAdInput = {
  adAccountId: string;
  pageId: string;
  pageAccessToken: string;
  userAccessToken: string;
  instagramBusinessId: string;
  instagramMediaId: string;
  name: string;
  budgetCents: number;
  startsAt: Date;
  endsAt: Date;
  audience: LeadAdAudience;
  privacyPolicyUrl: string;
};

export type LaunchedLeadAd = {
  campaignId: string;
  adSetId: string;
  leadFormId: string;
  creativeId: string;
  adId: string;
};

export type MetaLeadField = { name: string; values: string[] };

export type MetaLead = {
  id: string;
  createdTime: string;
  adId: string | null;
  formId: string | null;
  fields: MetaLeadField[];
};

/**
 * Tudo que o sistema faz na Graph API da Meta passa por aqui. Existe uma
 * implementação fake para desenvolver sem app aprovado pela Meta.
 */
export interface MetaAdsClient {
  getAuthorizationUrl(state: string): string;
  authorize(code: string): Promise<MetaAuthorizedAccount>;
  subscribePageToLeads(pageId: string, pageAccessToken: string): Promise<void>;
  listInstagramMedia(
    instagramBusinessId: string,
    userAccessToken: string,
  ): Promise<InstagramMediaItem[]>;
  searchCities(query: string, userAccessToken: string): Promise<MetaCity[]>;
  launchLeadAd(input: LaunchLeadAdInput): Promise<LaunchedLeadAd>;
  fetchLead(leadgenId: string, pageAccessToken: string): Promise<MetaLead>;
}
