import type { SupabaseClient } from '@supabase/supabase-js';
import type { Property, PropertyEvent, PropertyEventKind, PropertyStatus, PropertyType } from '../domain/property.js';
import type { PropertyAdData, TriState, Typology } from '../domain/property-ad.js';
import {
  DuplicateReferenceCode,
  type CompanyBroker,
  type NewPropertyEvent,
  type NewPropertyRecord,
  type PropertyListQuery,
  type PropertyPatch,
  type PropertyRepository,
} from '../domain/property-repository.js';

type PropertyRow = {
  id: string;
  company_id: string;
  reference_code: string;
  type: PropertyType;
  sale_price: number | string;
  development_name: string | null;
  state: string;
  municipality: string;
  municipality_ibge_code: string | null;
  neighborhood: string;
  street: string;
  street_number: string | null;
  complement: string | null;
  postal_code: string | null;
  private_area_m2: number | string | null;
  total_area_m2: number | string | null;
  registration_number: string | null;
  has_appraisal: boolean;
  appraisal_value: number | string | null;
  appraisal_valid_until: string | null;
  internal_notes: string | null;
  responsible_broker_id: string;
  status: PropertyStatus;
  status_changed_at: string;
  created_by: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  typology: Typology | null;
  ad_title: string | null;
  ad_headline: string | null;
  ad_description: string | null;
  ad_highlights: string[] | null;
  bedrooms: number | null;
  suites: number | null;
  bathrooms: number | null;
  parking_spaces: number | null;
  accepts_financing: TriState;
  accepts_fgts: TriState;
  accepts_mcmv: TriState;
  show_price: boolean;
  show_full_address: boolean;
  latitude: number | string | null;
  longitude: number | string | null;
};

const UNIQUE_VIOLATION = '23505';

export class SupabasePropertyRepository implements PropertyRepository {
  constructor(private readonly client: SupabaseClient) {}

  async insert(record: NewPropertyRecord): Promise<Property> {
    const { data, error } = await this.client
      .from('properties')
      .insert({
        company_id: record.companyId,
        created_by: record.createdBy,
        updated_by: record.createdBy,
        ...toColumns(record),
      })
      .select('*')
      .single<PropertyRow>();

    if (error?.code === UNIQUE_VIOLATION) throw new DuplicateReferenceCode();
    if (error) throw new Error(`Falha ao salvar imóvel: ${error.message}`);

    return toProperty(data);
  }

  async findById(companyId: string, id: string): Promise<Property | null> {
    if (!isUuid(id)) return null;

    const { data, error } = await this.client
      .from('properties')
      .select('*')
      .eq('company_id', companyId)
      .eq('id', id)
      .maybeSingle<PropertyRow>();

    if (error) throw new Error(`Falha ao carregar imóvel: ${error.message}`);

    return data ? toProperty(data) : null;
  }

  async update(companyId: string, id: string, patch: PropertyPatch): Promise<Property> {
    const { status, updatedBy, ad, ...fields } = patch;
    const columns: Record<string, unknown> = { ...toColumns(fields), ...adColumns(ad), updated_by: updatedBy };

    if (status) {
      columns.status = status;
      columns.status_changed_at = new Date().toISOString();
    }

    const { data, error } = await this.client
      .from('properties')
      .update(columns)
      .eq('company_id', companyId)
      .eq('id', id)
      .select('*')
      .single<PropertyRow>();

    if (error?.code === UNIQUE_VIOLATION) throw new DuplicateReferenceCode();
    if (error) throw new Error(`Falha ao atualizar imóvel: ${error.message}`);

    return toProperty(data);
  }

  async referenceCodeExists(companyId: string, code: string, exceptId?: string): Promise<boolean> {
    let query = this.client
      .from('properties')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('reference_code', code);

    if (exceptId) query = query.neq('id', exceptId);

    const { count, error } = await query;

    if (error) throw new Error(`Falha ao verificar código do imóvel: ${error.message}`);

    return (count ?? 0) > 0;
  }

  async addEvent(event: NewPropertyEvent): Promise<void> {
    const { error } = await this.client.from('property_events').insert({
      company_id: event.companyId,
      property_id: event.propertyId,
      kind: event.kind,
      actor_id: event.actorId,
      data: event.data ?? {},
    });

    if (error) throw new Error(`Falha ao registrar histórico do imóvel: ${error.message}`);
  }

  async listEvents(companyId: string, propertyId: string): Promise<PropertyEvent[]> {
    const { data, error } = await this.client
      .from('property_events')
      .select('id, property_id, kind, actor_id, data, created_at')
      .eq('company_id', companyId)
      .eq('property_id', propertyId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Falha ao carregar histórico do imóvel: ${error.message}`);

    return (data ?? []).map((row) => ({
      id: row.id as string,
      propertyId: row.property_id as string,
      kind: row.kind as PropertyEventKind,
      actorId: (row.actor_id as string | null) ?? null,
      data: (row.data as Record<string, unknown>) ?? {},
      createdAt: row.created_at as string,
    }));
  }

  async findBroker(companyId: string, brokerId: string): Promise<CompanyBroker | null> {
    if (!isUuid(brokerId)) return null;

    const { data, error } = await this.client
      .from('profiles')
      .select('id, full_name, is_active')
      .eq('company_id', companyId)
      .eq('id', brokerId)
      .maybeSingle<{ id: string; full_name: string | null; is_active: boolean | null }>();

    if (error) throw new Error(`Falha ao carregar corretor: ${error.message}`);

    return data ? { id: data.id, fullName: data.full_name, isActive: data.is_active !== false } : null;
  }

  async list(companyId: string, query: PropertyListQuery): Promise<{ items: Property[]; total: number }> {
    let request = this.client
      .from('properties')
      .select('*', { count: 'exact' })
      .eq('company_id', companyId);

    request = query.statuses.length > 0 ? request.in('status', query.statuses) : request.neq('status', 'inativo');

    if (query.types.length > 0) request = request.in('type', query.types);
    if (query.responsibleBrokerId) request = request.eq('responsible_broker_id', query.responsibleBrokerId);
    if (query.search) request = request.ilike('search_text', `%${escapeLike(query.search)}%`);

    const from = (query.page - 1) * query.pageSize;
    const { data, error, count } = await request
      .order('updated_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, from + query.pageSize - 1);

    if (error) throw new Error(`Falha ao listar imóveis: ${error.message}`);

    return { items: (data as PropertyRow[]).map(toProperty), total: count ?? 0 };
  }

  async listBrokers(companyId: string): Promise<CompanyBroker[]> {
    const { data, error } = await this.client
      .from('profiles')
      .select('id, full_name, is_active')
      .eq('company_id', companyId)
      .order('full_name', { ascending: true });

    if (error) throw new Error(`Falha ao listar corretores: ${error.message}`);

    return (data ?? []).map((row) => ({
      id: row.id as string,
      fullName: (row.full_name as string | null) ?? null,
      isActive: row.is_active !== false,
    }));
  }
}

/** `%`, `_` e `\` digitados na busca valem como texto, não como curinga do LIKE. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function toColumns(record: Partial<Omit<NewPropertyRecord, 'companyId' | 'createdBy'>>): Record<string, unknown> {
  const columns: Record<string, unknown> = {};
  const set = (column: string, value: unknown) => {
    if (value !== undefined) columns[column] = value;
  };

  set('reference_code', record.referenceCode);
  set('type', record.type);
  set('sale_price', record.salePrice);
  set('development_name', record.developmentName);
  set('private_area_m2', record.privateAreaM2);
  set('total_area_m2', record.totalAreaM2);
  set('registration_number', record.registrationNumber);
  set('has_appraisal', record.hasAppraisal);
  set('appraisal_value', record.appraisalValue);
  set('appraisal_valid_until', record.appraisalValidUntil);
  set('internal_notes', record.internalNotes);
  set('responsible_broker_id', record.responsibleBrokerId);
  set('latitude', record.latitude);
  set('longitude', record.longitude);

  if (record.address) {
    set('state', record.address.state);
    set('municipality', record.address.municipality);
    set('municipality_ibge_code', record.address.municipalityIbgeCode);
    set('neighborhood', record.address.neighborhood);
    set('street', record.address.street);
    set('street_number', record.address.number);
    set('complement', record.address.complement);
    set('postal_code', record.address.postalCode);
  }

  return columns;
}

function adColumns(ad: Partial<PropertyAdData> | undefined): Record<string, unknown> {
  if (!ad) return {};

  const map: Record<keyof PropertyAdData, string> = {
    typology: 'typology',
    title: 'ad_title',
    headline: 'ad_headline',
    description: 'ad_description',
    highlights: 'ad_highlights',
    bedrooms: 'bedrooms',
    suites: 'suites',
    bathrooms: 'bathrooms',
    parkingSpaces: 'parking_spaces',
    acceptsFinancing: 'accepts_financing',
    acceptsFgts: 'accepts_fgts',
    acceptsMcmv: 'accepts_mcmv',
    showPrice: 'show_price',
    showFullAddress: 'show_full_address',
    latitude: 'latitude',
    longitude: 'longitude',
  };

  return Object.fromEntries(
    Object.entries(ad)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [map[key as keyof PropertyAdData], value]),
  );
}

const toNumber = (value: number | string | null) => (value === null ? null : Number(value));

function toProperty(row: PropertyRow): Property {
  return {
    id: row.id,
    companyId: row.company_id,
    referenceCode: row.reference_code,
    type: row.type,
    salePrice: Number(row.sale_price),
    developmentName: row.development_name,
    address: {
      state: row.state,
      municipality: row.municipality,
      municipalityIbgeCode: row.municipality_ibge_code,
      neighborhood: row.neighborhood,
      street: row.street,
      number: row.street_number,
      complement: row.complement,
      postalCode: row.postal_code,
    },
    privateAreaM2: row.private_area_m2 === null ? null : Number(row.private_area_m2),
    totalAreaM2: row.total_area_m2 === null ? null : Number(row.total_area_m2),
    registrationNumber: row.registration_number,
    appraisal:
      row.has_appraisal && row.appraisal_value !== null && row.appraisal_valid_until
        ? { value: Number(row.appraisal_value), validUntil: row.appraisal_valid_until }
        : null,
    internalNotes: row.internal_notes,
    responsibleBrokerId: row.responsible_broker_id,
    status: row.status,
    statusChangedAt: row.status_changed_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ad: {
      typology: row.typology ?? null,
      title: row.ad_title ?? null,
      headline: row.ad_headline ?? null,
      description: row.ad_description ?? null,
      highlights: row.ad_highlights ?? [],
      bedrooms: row.bedrooms ?? null,
      suites: row.suites ?? null,
      bathrooms: row.bathrooms ?? null,
      parkingSpaces: row.parking_spaces ?? null,
      acceptsFinancing: row.accepts_financing ?? 'nao_informado',
      acceptsFgts: row.accepts_fgts ?? 'nao_informado',
      acceptsMcmv: row.accepts_mcmv ?? 'nao_informado',
      showPrice: row.show_price ?? true,
      showFullAddress: row.show_full_address ?? false,
      latitude: toNumber(row.latitude ?? null),
      longitude: toNumber(row.longitude ?? null),
    },
  };
}

/** Id malformado vira "não encontrado" em vez de erro do Postgres que revela o formato. */
function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
