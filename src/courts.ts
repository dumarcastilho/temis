import type { Env } from './env';
import { courtCatalog } from './court-catalog.js';

const courtDetails = [
  { id: 'tjam', name: 'Amazonas', system: 'SAJ / Projudi', url: 'https://www.tjam.jus.br/' },
  { id: 'tjes', name: 'Espírito Santo', system: 'PJe', url: 'https://www.tjes.jus.br/' },
  { id: 'tjpi', name: 'Piauí', system: 'PJe', url: 'https://www.tjpi.jus.br/' },
  { id: 'tjgo', name: 'Goiás', system: 'Projudi / PJD', url: 'https://projudi.tjgo.jus.br/BuscaProcesso' },
  { id: 'tjmt', name: 'Mato Grosso', system: 'PJe', url: 'https://consultaprocessual.tjmt.jus.br/' },
  { id: 'tjrn', name: 'Rio Grande do Norte', system: 'PJe', url: 'https://pje1g.tjrn.jus.br/consultapublica/ConsultaPublica/listView.seam' },
  { id: 'tjba', name: 'Bahia', system: 'PJe', url: 'https://consultapublicapje.tjba.jus.br/pje/ConsultaPublica/listView.seam' },
  { id: 'tjpe', name: 'Pernambuco', system: 'PJe', url: 'https://pje.cloud.tjpe.jus.br/1g/ConsultaPublica/listView.seam' },
];

export const courts = courtCatalog.map(court => ({ ...court, ...courtDetails.find(detail => detail.id === court.id) }));

export interface Connector { endpoint: string; username?: string; password?: string }
const connectorProfiles: Record<string, Connector> = {
  'tjpi:1g': { endpoint: 'https://pje.tjpi.jus.br/1g/intercomunicacao' },
  'tjes:1g': { endpoint: 'https://pje.tjes.jus.br/pje/intercomunicacao' },
  'tjam:1g': { endpoint: 'https://consultasaj.tjam.jus.br/mniws/servico-intercomunicacao-2.2.2/intercomunicacao' },
  'trf1:1g': { endpoint: 'https://pje1g.trf1.jus.br/pje/intercomunicacao' },
  'trt6:1g': { endpoint: 'https://pje.trt6.jus.br/primeirograu/servicosweb/mni222/intercomunicacao' },
  'trt15:1g': { endpoint: 'https://pje.trt15.jus.br/primeirograu/servicosweb/mni222/intercomunicacao' },
};
const defaultConnectors: Record<string, Connector> = {
  'tjpe:1g': { endpoint: 'https://pjemni.app.tjpe.jus.br/1g/servico-intercomunicacao-2.2.2' },
  'tjba:1g': { endpoint: 'https://pje1g-mni.tjba.jus.br/pje/intercomunicacao' },
};

export const hasPublicConnector = (tribunal: string, instance: string): boolean => tribunal === 'tjmt' || tribunal === 'tjgo' && instance === '1g';
export const hasConnectorProfile = (tribunal: string, instance: string): boolean => !!connectorProfiles[`${tribunal}:${instance}`];
export function connectors(env: Env): Record<string, Connector> {
  try {
    const configured = JSON.parse(env.COURT_CONNECTORS || '{}');
    if (!configured || typeof configured !== 'object' || Array.isArray(configured)) throw new Error();
    const result = { ...defaultConnectors };
    for (const [key, value] of Object.entries(configured)) {
      const [id, instance, extra] = key.split(':');
      if (!courts.some(c => c.id === id) || !['1g', '2g'].includes(instance) || extra || !value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
      const connector = { ...connectorProfiles[key], ...defaultConnectors[key], ...value } as Connector;
      validateEndpoint(connector.endpoint);
      if ([connector.username, connector.password].some(v => v !== undefined && typeof v !== 'string')) throw new Error();
      result[key] = connector;
    }
    return result;
  }
  catch { throw new Error('Configuração dos conectores inválida.'); }
}

export function validateEndpoint(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.jus.br') || url.username || url.password || url.port) {
    throw new Error('O endpoint MNI deve usar HTTPS em um domínio oficial jus.br.');
  }
  return url;
}
