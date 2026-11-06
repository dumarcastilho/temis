import type { Env } from './env';

export const courts = [
  { id: 'tjgo', name: 'Goiás', system: 'Projudi / PJD', url: 'https://projudi.tjgo.jus.br/BuscaProcesso' },
  { id: 'tjmt', name: 'Mato Grosso', system: 'PJe', url: 'https://consultaprocessual.tjmt.jus.br/' },
  { id: 'tjrn', name: 'Rio Grande do Norte', system: 'PJe', url: 'https://pje1g.tjrn.jus.br/consultapublica/ConsultaPublica/listView.seam' },
  { id: 'tjba', name: 'Bahia', system: 'PJe', url: 'https://consultapublicapje.tjba.jus.br/pje/ConsultaPublica/listView.seam' },
  { id: 'tjpe', name: 'Pernambuco', system: 'PJe', url: 'https://pje.cloud.tjpe.jus.br/1g/ConsultaPublica/listView.seam' },
];

export interface Connector { endpoint: string; username?: string; password?: string }
const defaultConnectors: Record<string, Connector> = {
  'tjpe:1g': { endpoint: 'https://pjemni.app.tjpe.jus.br/1g/servico-intercomunicacao-2.2.2' },
  'tjba:1g': { endpoint: 'https://pje1g-mni.tjba.jus.br/pje/intercomunicacao' },
};

export const hasPublicConnector = (tribunal: string, instance: string): boolean => tribunal === 'tjmt' || tribunal === 'tjgo' && instance === '1g';
export function connectors(env: Env): Record<string, Connector> {
  try { return { ...defaultConnectors, ...JSON.parse(env.COURT_CONNECTORS || '{}') }; }
  catch { throw new Error('Configuração dos conectores inválida.'); }
}

export function validateEndpoint(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.jus.br') || url.username || url.password || url.port) {
    throw new Error('O endpoint MNI deve usar HTTPS em um domínio oficial jus.br.');
  }
  return url;
}
