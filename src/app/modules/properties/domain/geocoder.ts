import type { PropertyAddress } from './property.js';

/**
 * Localização no mapa a partir do endereço (12.6). O serviço ainda não foi
 * escolhido (pendência levada à spec); falha ou ausência nunca bloqueia o
 * salvamento nem o indicador — o imóvel só fica sem ponto no mapa.
 */
export interface Geocoder {
  locate(address: PropertyAddress): Promise<{ latitude: number; longitude: number } | null>;
}

/** [PROVISÓRIO] Enquanto não há serviço definido: nenhum imóvel ganha ponto no mapa. */
export class NoGeocoder implements Geocoder {
  async locate(): Promise<null> {
    return null;
  }
}
