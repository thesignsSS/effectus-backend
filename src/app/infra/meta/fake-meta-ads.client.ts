import { randomUUID } from 'node:crypto';
import {
  InstagramMediaItem,
  LaunchedLeadAd,
  LaunchLeadAdInput,
  MetaAdsClient,
  MetaAuthorizedAccount,
  MetaCity,
  MetaLead,
} from '../../domain/interfaces/meta-ads-client.interface.js';

const FAKE_CITIES: MetaCity[] = [
  { key: '256140', name: 'Belém', region: 'Pará', countryCode: 'BR' },
  { key: '249993', name: 'Ananindeua', region: 'Pará', countryCode: 'BR' },
  { key: '269969', name: 'São Paulo', region: 'São Paulo', countryCode: 'BR' },
  { key: '266709', name: 'Rio de Janeiro', region: 'Rio de Janeiro', countryCode: 'BR' },
  { key: '245926', name: 'Brasília', region: 'Distrito Federal', countryCode: 'BR' },
];

/**
 * Simula a Graph API para desenvolver sem app aprovado pela Meta. A URL de
 * autorização volta direto para o nosso callback, então o fluxo de conexão
 * funciona de ponta a ponta no navegador.
 */
export class FakeMetaAdsClient implements MetaAdsClient {
  constructor(private readonly redirectUri: string) {}

  getAuthorizationUrl(state: string): string {
    const url = new URL(this.redirectUri);
    url.searchParams.set('code', 'fake-code');
    url.searchParams.set('state', state);
    return url.toString();
  }

  async authorize(): Promise<MetaAuthorizedAccount> {
    return {
      metaUserId: 'fake-user',
      userAccessToken: `fake-user-token-${randomUUID()}`,
      userTokenExpiresAt: new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString(),
      pageId: 'fake-page',
      pageName: 'Página de teste',
      pageAccessToken: `fake-page-token-${randomUUID()}`,
      instagramBusinessId: 'fake-ig',
      instagramUsername: 'imobiliaria.teste',
      adAccountId: 'act_fake',
    };
  }

  async subscribePageToLeads(): Promise<void> {}

  async listInstagramMedia(): Promise<InstagramMediaItem[]> {
    return Array.from({ length: 9 }, (_, index) => {
      const imageUrl = `https://picsum.photos/seed/effectus-${index + 1}/600/600`;
      return {
        id: `fake-media-${index + 1}`,
        caption: `Apartamento ${index + 1} quartos, pronto para morar. #imoveis`,
        mediaType: 'IMAGE',
        mediaUrl: imageUrl,
        thumbnailUrl: imageUrl,
        permalink: `https://www.instagram.com/p/fake${index + 1}/`,
        timestamp: new Date(Date.now() - index * 86_400_000).toISOString(),
      };
    });
  }

  async searchCities(query: string): Promise<MetaCity[]> {
    const normalized = normalize(query);
    return FAKE_CITIES.filter((city) => normalize(city.name).includes(normalized));
  }

  async launchLeadAd(input: LaunchLeadAdInput): Promise<LaunchedLeadAd> {
    if (input.name.toLowerCase().includes('falhar')) {
      throw new Error('Meta: falha simulada (nome da campanha contém "falhar")');
    }

    const suffix = randomUUID().slice(0, 8);
    return {
      campaignId: `fake-campaign-${suffix}`,
      adSetId: `fake-adset-${suffix}`,
      leadFormId: `fake-form-${suffix}`,
      creativeId: `fake-creative-${suffix}`,
      adId: `fake-ad-${suffix}`,
    };
  }

  async fetchLead(leadgenId: string): Promise<MetaLead> {
    return {
      id: leadgenId,
      createdTime: new Date().toISOString(),
      adId: null,
      formId: null,
      fields: [
        { name: 'full_name', values: ['Maria da Silva'] },
        { name: 'email', values: ['maria.silva@example.com'] },
        { name: 'phone_number', values: ['+5591999990000'] },
      ],
    };
  }
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
