# Temis

Acompanhamento privado de processos judiciais em Cloudflare Workers, com banco Cloudflare D1, histórico de movimentações e notificações dentro do site.

**Autor:** Dumar Castilho - https://github.com/dumarcastilho

## Funcionalidades

- Cadastro de número CNJ com validação do dígito verificador, identificação, observações e instância.
- Carteira compartilhada entre os usuários autorizados no Cloudflare Access.
- Filtros por tribunal, identificação, status e avisos não lidos.
- Consulta direta ao tribunal, histórico paginado e primeira consulta usada como referência inicial.
- Notificações para movimentos encontrados após o histórico inicial, com leitura individual por usuário.
- Pausa, retomada, edição e exclusão do acompanhamento.
- Verificações agendadas, identificação de falhas, controle de concorrência e deduplicação.
- Interface adaptável a celular, sem serviços externos de fontes ou rastreamento.

## Fontes e cobertura

O Temis **não utiliza DataJud**. A consulta precisa estar disponível diretamente no tribunal.

| Tribunal | Fonte | Situação do conector |
| --- | --- | --- |
| TJMT | API utilizada pela [consulta processual oficial](https://consultaprocessual.tjmt.jus.br/) | Implementado para históricos públicos. Seleção por instância e consulta dos registros encontrados, incluindo arquivados. |
| TJPE | [MNI oficial](https://portal.tjpe.jus.br/web/transparencia/tic/dados-abertos) | Cliente MNI implementado; exige configurar e validar o endpoint e o acesso. |
| TJBA | [MNI oficial](https://www.tjba.jus.br/portal/web-service/) | Cliente MNI implementado; exige configurar e validar o endpoint e o acesso. |
| TJRN | PJe | Cadastro disponível; integração direta ainda depende de endpoint/acesso e validação. |
| TJGO | [Projudi / PJD](https://projudi.tjgo.jus.br/BuscaProcesso) | Cadastro disponível; conector específico ainda precisa ser implementado ou homologado via MNI compatível. |

A tela **Tribunais** diferencia conectores configurados de integrações pendentes. Configurar um endpoint não comprova disponibilidade nem autorização. O cliente MNI suporta SOAP 1.1 no modelo 2.2.2, com resposta XML, movimentos nacionais/locais e credenciais opcionais no envelope; adaptações de contrato podem ser necessárias em cada instalação.

O número CNJ identifica o tribunal, mas não necessariamente a instância atual. Cadastre 1º e 2º graus separadamente quando necessário. O produto atualmente trabalha com processos e movimentações públicos. Não baixa documentos, não abre intimações e não contorna CAPTCHA, MFA ou restrições do tribunal. Regras de acesso por IP fixo ou certificado cliente exigem infraestrutura e implementação adicional.

## Requisitos

- Node.js 24 ou superior e pnpm 11.
- Conta Cloudflare com Workers, D1 e Zero Trust Access.
- Domínio sob controle da conta Cloudflare.
- Acesso autorizado aos serviços dos tribunais que forem configurados.

O agendador usa lotes de até 10 processos a cada 15 minutos. Cada processo é consultado por padrão a cada 120 minutos; a duração real aumenta conforme a carteira, as falhas e os limites da conta. Avalie os limites de requisições externas, CPU e consultas D1 do plano escolhido, especialmente para históricos extensos. Carteiras maiores precisam de dimensionamento dos lotes ou migração do agendamento para Queues.

## Desenvolvimento local

```sh
git clone https://github.com/dumarcastilho/temis.git
cd temis
pnpm install --frozen-lockfile
pnpm db:local
pnpm dev --var LOCAL_DEV:true
```

Abra `http://localhost:8787`. O acesso de desenvolvimento só funciona em loopback (`localhost`, `127.0.0.1`, `::1`) e representa `developer@example.invalid`. Não defina `LOCAL_DEV` no ambiente remoto. Sem esse parâmetro, a aplicação exige Cloudflare Access também localmente.

O estado local fica em `.wrangler/`, fora do versionamento. Sem conectores configurados, cadastros dos demais tribunais ficam como integração pendente. O TJMT possui conector público embutido.

```sh
pnpm test
pnpm check
pnpm build
```

Os testes usam números e movimentos sintéticos, verificam autenticação, protocolo MNI, histórico inicial, novos avisos, concorrência e cascatas do banco. Não consultam processos reais.

## Implantação na Cloudflare

### 1. Banco e configuração do Worker

```sh
pnpm exec wrangler login
pnpm exec wrangler d1 create temis
```

Copie `wrangler.jsonc` para `wrangler.local.jsonc` (arquivo ignorado pelo Git). No arquivo local:

- Substitua `d1_databases[0].database_id` pelo identificador retornado ao criar o banco.
- Informe `vars.APP_ORIGIN`, por exemplo `https://temis.example.com`.
- Informe `vars.ACCESS_TEAM_DOMAIN`, por exemplo `sua-equipe.cloudflareaccess.com`, sem protocolo nem barra final.
- Informe `vars.ACCESS_AUD` com o Application Audience (AUD) do Access.
- Adicione `routes: [{ "pattern": "temis.example.com", "custom_domain": true }]` na raiz.
- Mantenha `workers_dev: false`, `preview_urls: false` e `assets.run_worker_first: true`.

Todos os endereços de aplicação dos exemplos são fictícios: substitua pelo seu domínio. O arquivo versionado não contém IDs da sua conta, e-mails autorizados nem credenciais.

### 2. Proteger o domínio com Access

No painel Cloudflare Zero Trust, crie uma aplicação **Self-hosted** para o hostname completo e **todos os caminhos**, incluindo `/api/*` e os arquivos estáticos. Configure uma política **Allow** apenas para os e-mails ou grupos autorizados. Escolha seu provedor de identidade ou One-time PIN por e-mail. Não crie política Bypass ou liberação Everyone.

Copie o AUD da aplicação para a configuração local do Worker. A aplicação valida assinatura RS256, emissor, audiência, validade temporal e e-mail do token `Cf-Access-Jwt-Assertion`. Não confia apenas no cabeçalho de e-mail. Sem configuração ou token válido, bloqueia também a interface e os arquivos estáticos.

Todos os usuários liberados compartilham a mesma carteira e podem editar ou excluir processos. As marcações de leitura são individuais. Ainda não há perfis de administrador ou carteiras isoladas.

### 3. Conectores MNI

O TJMT funciona sem esse segredo. Para outros tribunais, use `COURT_CONNECTORS` como segredo JSON, com uma chave por tribunal e grau. Exemplo com endereço fictício:

```json
{
  "tjpe:1g": {
    "endpoint": "https://integracao.example.jus.br/servico-intercomunicacao-2.2.2",
    "username": "IDENTIFICADOR_AUTORIZADO",
    "password": "SENHA_DO_SERVICO"
  }
}
```

O exemplo de endpoint é ilustrativo. Obtenha o endereço real e as condições de acesso diretamente com o tribunal. Os endpoints publicados pelo TJPE e TJBA estão nas referências da tabela de cobertura. Use a URL do serviço **sem `?wsdl`**. Omita usuário e senha somente se o serviço aceitar consulta anônima. Não coloque credenciais no repositório, no navegador, nos logs ou nas observações do processo.

```sh
pnpm exec wrangler secret put COURT_CONNECTORS --config wrangler.local.jsonc
```

Cole o JSON no prompt protegido do Wrangler. Para desenvolvimento, o mesmo segredo pode ser definido em `.dev.vars`, arquivo ignorado pelo Git. O Worker limita endpoints a HTTPS em domínios oficiais `.jus.br` e rejeita redirecionamentos. O endpoint configurado é uma informação administrativa confiável, não uma URL fornecida pelos visitantes do site.

### 4. Aplicar migrações e publicar

```sh
pnpm exec wrangler d1 migrations apply temis --remote --config wrangler.local.jsonc
pnpm exec wrangler deploy --config wrangler.local.jsonc
```

O Cron Trigger é definido no arquivo Wrangler. Ele não precisa de uma rota pública para consultar os tribunais. A consulta manual pelo site exige sessão válida e verifica a origem da requisição.

Depois da implantação, valide o redirecionamento ao login em sessão anônima, a recusa de um e-mail fora da política, o acesso de um usuário permitido, o cadastro e uma consulta de um processo público do tribunal desejado. Verifique também que os endereços `workers.dev` e de preview permanecem desabilitados.

## Operação e limitações

- A primeira consulta bem-sucedida registra o histórico sem criar avisos retroativos. Movimentos novos, mesmo com datas antigas, geram avisos nas consultas seguintes.
- As notificações são persistentes no site; não há e-mail, Telegram, push ou alerta com o site fechado. A lista é atualizada a cada minuto enquanto a página está visível.
- Falhas do tribunal mantêm o último histórico confirmado e mostram erro. Uma resposta vazia de pesquisa não prova inexistência nem ausência de mudanças.
- Datas são exibidas no horário de Brasília. Datas compactas do MNI usam o fuso do tribunal.
- Os avisos representam mudanças encontradas pelo conector. Não substituem os canais oficiais do tribunal.
- Processos excluídos removem histórico e notificações em cascata. Exporte o banco antes de alterações importantes.

```sh
pnpm exec wrangler d1 export temis --remote --output backup.sql --config wrangler.local.jsonc
```

Guarde exportações em local privado e fora do checkout. Se precisar voltar o código, use as versões/deployments do Workers. Restaurar o código não restaura o banco: avalie a compatibilidade das migrações antes do rollback. Consulte [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) para recuperação do banco conforme a retenção da conta.

Para adicionar tribunais, atualize `src/courts.ts`, o mapeamento CNJ se necessário e o conector em `src/sources.ts`. Crie testes sintéticos do contrato de resposta e valide uma consulta autorizada antes de habilitar a integração.

## Segurança e licença

Use segredos do Workers para credenciais, restrinja a carteira à equipe necessária e mantenha exportações privadas. O banco contém números de processos, anotações e identidades de usuários; gerencie retenção e acesso conforme a necessidade da equipe.

Copyright © 2026 Dumar Castilho. Todos os direitos reservados. Nenhuma licença de redistribuição foi concedida neste repositório. As dependências mantêm suas próprias licenças.
