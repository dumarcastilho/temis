# Temis

Acompanhamento privado de processos judiciais em Cloudflare Workers, com banco Cloudflare D1, histórico de movimentações e notificações dentro do site.

**Autor:** Dumar Castilho - https://github.com/dumarcastilho

## Funcionalidades

- Cadastro de número CNJ com validação do dígito verificador, identificação, observações e instância.
- Máscara CNJ durante a digitação e colagem, com preservação de zeros iniciais e teclado numérico no celular.
- Carteira compartilhada entre os usuários autorizados no Cloudflare Access.
- Filtros por tribunal, identificação, status e avisos não lidos.
- Acompanhamento ordenado por prioridade: atenção e integração pendente, primeira consulta pendente, em acompanhamento e pausados; a ordem anterior é preservada dentro de cada grupo.
- Catálogo nacional com 27 TJs, 6 TRFs e 24 TRTs, identificação pelo CNJ e busca de tribunais por ramo e disponibilidade.
- Lista simples dos processos cadastrados, organizada por UF ou região e comarca, sem andamentos, com cópia em texto para compartilhamento.
- Consulta direta ao tribunal, histórico paginado e primeira consulta usada como referência inicial.
- Notificações para movimentos encontrados após o histórico inicial, com leitura individual por usuário.
- Pausa, retomada, edição e exclusão do acompanhamento.
- Verificações agendadas, identificação de falhas, controle de concorrência e deduplicação.
- Interface adaptável a celular, sem serviços externos de fontes ou rastreamento.

## Fontes e cobertura

O Temis prioriza a consulta direta ao tribunal. Quando ela falha ou não existe conector direto, usa a [API Pública do DataJud/CNJ](https://datajud-wiki.cnj.jus.br/api-publica/) como alternativa para processos públicos. A carteira mostra a fonte efetiva e a atualização informada pela base; a consulta direta é tentada novamente nas próximas verificações.

O DataJud depende das remessas dos tribunais e pode estar defasado. Não é uma consulta em tempo real ao PJe, não oferece documentos nem dados de processos sigilosos e não garante que um processo recente já esteja disponível. Um resultado ausente, parcial ou inválido não cria um histórico vazio nem apaga o histórico anterior.

O cadastro aceita os 57 tribunais da Justiça Estadual (incluindo TJDFT), Federal e do Trabalho, com prioridade para o 1º grau. **Presença no catálogo não significa integração automática concluída.** O DataJud pode atender os tribunais sem serviço direto acessível; disponibilidade de cada processo, instância e atualização precisa ser confirmada na consulta. Sem resposta válida em qualquer fonte, o processo fica com indicação de erro. Justiça Eleitoral, Militar e tribunais superiores não fazem parte desse catálogo.

A identificação por TRF representa a região da Justiça Federal de origem. Os serviços de 1º grau podem ser separados por seção judiciária; não se deve usar um endpoint de 2º grau para todos os processos federais.

| Tribunal | Fonte | Situação do conector |
| --- | --- | --- |
| TJMT | API utilizada pela [consulta processual oficial](https://consultaprocessual.tjmt.jus.br/) | Implementado para históricos públicos. Seleção por instância e consulta dos registros encontrados, incluindo arquivados. |
| TJPE | [MNI oficial](https://portal.tjpe.jus.br/web/transparencia/tic/dados-abertos) | 1º grau com conector público embutido, incluindo respostas SOAP multipart/MTOM. 2º grau exige configurar e validar o endpoint e o acesso. |
| TJBA | [MNI oficial](https://www.tjba.jus.br/portal/web-service/) | Endpoint oficial de 1º grau embutido. O acesso e a resposta de um processo real ainda precisam ser validados; pode exigir credenciais ou liberação pelo tribunal. 2º grau permanece pendente. |
| TJRN | PJe | Cadastro disponível; integração direta ainda depende de endpoint/acesso e validação. |
| TJGO | [Serviços públicos do Projudi](https://transparencia.tjgo.jus.br/ti-comunicacoes/acesso-automatizado) | Conector público de 1º grau embutido, conforme o contrato XML oficial. 2º grau depende de serviço compatível; DataJud disponível como alternativa. |
| TJPI, TJES, TJAM (SAJ) | Contratos oficiais: [TJPI](https://pje.tjpi.jus.br/1g/intercomunicacao?wsdl), [TJES](https://pje.tjes.jus.br/pje/intercomunicacao?wsdl), [TJAM](https://www.tjam.jus.br/index.php/dados-abertos) | Perfis MNI de 1º grau embutidos, desativados até configuração explícita de acesso. Sem consulta real validada; não cobrem automaticamente outros sistemas do mesmo tribunal. |
| TRF1, TRT6, TRT15 | [TRF1](https://www.trf1.jus.br/trf1/conteudo/NUGTI/MNI_Orienta%C3%A7%C3%B5es.pdf), [TRT6](https://www.trt6.jus.br/portal/transparencia/dados-abertos), [TRT15](https://trt15.jus.br/transparencia/dados-abertos) | Perfis MNI de 1º grau embutidos, desativados até configuração explícita. Exigem validar as permissões e o contrato com credenciais autorizadas; TRT6 e TRT15 informam exigência de credenciamento ou convênio. |
| Demais TJs, TRFs e TRTs | Portal oficial de cada tribunal na tela **Tribunais e integrações** | Cadastro e configuração MNI 2.2.2 disponíveis. DataJud como alternativa pública. A consulta direta exige confirmar endpoint, acesso e compatibilidade; sistemas ou versões diferentes podem exigir adaptadores ainda não implementados. |

A tela **Tribunais** distingue consulta direta, alternativa DataJud, primeira consulta pendente e falha de consulta. A configuração direta e seu eventual credenciamento são independentes da alternativa DataJud. A confirmação depende de um processo com histórico consultado com sucesso e sem erro registrado na carteira. Configurar um endpoint não comprova disponibilidade nem autorização. O cliente MNI suporta SOAP 1.1 no modelo 2.2.2, com resposta XML simples ou envelope XML em multipart/related (MTOM), movimentos nacionais/locais e credenciais opcionais no envelope. Anexos MIME são ignorados e partes incompletas ou não reconhecidas são rejeitadas; adaptações de contrato podem ser necessárias em cada instalação.

O número CNJ identifica o tribunal, mas não necessariamente a instância atual. Cadastre 1º e 2º graus separadamente quando necessário. O produto trabalha com processos e movimentações públicos. Não baixa documentos, não abre intimações e não contorna CAPTCHA, MFA ou restrições do tribunal. Regras de acesso por IP fixo ou certificado cliente exigem infraestrutura e implementação adicional.

## Nomes das movimentações e links oficiais

Quando o MNI retorna um código nacional sem descrição, o Temis resolve o nome pela tabela oficial TPU/CNJ incluída na aplicação. Descrições fornecidas pelo tribunal e complementos são preservados; códigos locais não são confundidos com códigos nacionais. A próxima consulta atualiza os nomes já salvos sem recriar os movimentos ou seus avisos.

A tabela é obtida do [serviço público TPU/CNJ](https://gateway.cloud.pje.jus.br/tpu/api/v1/publico/download/movimentos). Para atualizá-la, execute `node scripts/update-tpu.mjs` e revise a alteração em `src/tpu-movements.json`. Ela contém somente códigos e nomes públicos da taxonomia, sem dados de processos.

**Abrir tribunal** abre outra aba. O TJMT aceita o número no link de consulta. Páginas públicas PJe e Projudi recebem o número na URL de pesquisa quando esse formato é conhecido; isso não substitui CAPTCHA, identificadores assinados ou pesquisa exigida pelo portal. Portais como o TJPE podem exigir um identificador específico e CAPTCHA para abrir o detalhe; passar apenas o número não garante a abertura automática. O número é copiado ao abrir, se o navegador permitir; o botão **Copiar número** oferece uma alternativa.

## Alternativa DataJud

O recurso é habilitado por padrão para os 57 tribunais do catálogo. A chave pública de autenticação é obtida da [documentação oficial do CNJ](https://datajud-wiki.cnj.jus.br/api-publica/acesso/) e mantida temporariamente em memória no Worker; não é enviada ao navegador, registrada em logs ou versionada. Se a página não estiver acessível ou o CNJ mudar seu formato, configure `DATAJUD_API_KEY` como segredo do Worker com a chave pública vigente. A configuração explícita tem prioridade. `DATAJUD_ENABLED=false` desativa a alternativa e mantém somente a consulta direta.

A busca restringe tribunal, número CNJ e grau. Para o 1º grau aceita `G1` e `JE`; para o 2º grau, `G2` e `TR`. Respostas com erro, páginas repetidas, pesquisa incompleta ou datas inválidas são rejeitadas. O nome da movimentação vem do DataJud, com TPU como alternativa quando omitido.

A primeira consulta e a primeira consulta após uma troca de fonte criam uma referência inicial, sem alertar sobre movimentos antigos. Só movimentos novos encontrados nas verificações seguintes da mesma fonte geram avisos. Históricos anteriores e leituras dos avisos são preservados; use **Histórico exibido** no detalhe para alternar entre consulta direta e DataJud. A API de movimentos aceita `source=direct` ou `source=datajud`; sem esse parâmetro mostra a fonte da última consulta.

A atualização depende da resposta do CNJ e pode levar dezenas de segundos. A chave pública não substitui as credenciais ou autorizações MNI da consulta direta. A migração `0003_history_sources.sql` mantém os movimentos existentes como consulta direta e separa as fontes. A implantação com `deploy:ci` aplica as migrações antes de publicar o Worker.

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

O estado local fica em `.wrangler/`, fora do versionamento. Sem conectores diretos adicionais, os demais tribunais usam a alternativa DataJud por padrão. TJMT, TJPE de 1º grau, TJBA de 1º grau e Projudi/TJGO de 1º grau possuem endereços embutidos; isso não garante autorização ou disponibilidade do serviço.

```sh
pnpm test
pnpm check
pnpm build
```

Os testes usam números e movimentos sintéticos, verificam autenticação, protocolo MNI, histórico inicial, novos avisos, concorrência e cascatas do banco. Não consultam processos reais.

## Lista simples de processos

Na carteira, alterne entre **Acompanhamento** e **Lista simples**. A lista simples reúne os processos cadastrados, inclusive os pausados ou com integração pendente, com UF, comarca/localidade, número CNJ e identificação. Os filtros de busca e tribunal continuam disponíveis; o filtro de status aplica-se apenas ao acompanhamento.

O campo **Comarca / localidade** é opcional. Quando estiver vazio, uma consulta bem-sucedida tenta preenchê-lo com os metadados oficiais do processo: jurisdição/localidade no TJMT ou município do órgão julgador no MNI. No MNI, o código de município retornado pelo tribunal é convertido em nome pela [API de localidades do IBGE](https://servicodados.ibge.gov.br/api/docs/localidades); somente esse código é enviado ao IBGE, sem número do processo ou dados das partes. Se faltar essa informação ou o serviço de localidades estiver indisponível, o histórico continua sendo salvo e o campo permanece disponível para edição manual.

Valores já preenchidos são preservados, inclusive se forem editados durante a consulta. Cadastros antigos com o campo vazio podem receber a informação na próxima consulta automática ou em **Acompanhamento → Consultar tribunal**. A comarca não é deduzida apenas pelo número CNJ. Uma mudança somente na comarca não gera aviso de movimentação.

Use **Copiar lista** para copiar os processos exibidos, respeitando os filtros, em blocos com UF, comarca e número. Entradas de 2º grau incluem a instância para distingui-las. O texto copiado não inclui andamentos, erros de consulta, identificação interna nem observações. Se o navegador impedir a cópia automática, o texto fica disponível para seleção manual.

## Implantação na Cloudflare

### Workers Builds conectado ao GitHub

O `database_id` com zeros em `wrangler.jsonc` é um marcador para desenvolvimento, não um banco remoto. No deploy pelo GitHub, use o comando abaixo para receber o ID real pelas variáveis de build sem publicar a configuração da conta no repositório.

1. Crie um banco chamado `temis` em **Storage & databases → D1** no painel Cloudflare, ou escolha um banco existente destinado ao Temis. Copie seu **Database ID** (UUID, diferente do Account ID).
2. Em **Workers & Pages → seu Worker → Settings → Build**, configure os comandos:
   - **Build command:** `pnpm run build`
   - **Deploy command:** `pnpm run deploy:ci`
3. Nas **variáveis e segredos do build**, defina `TEMIS_D1_DATABASE_ID` com o UUID real do D1. Essa variável é usada pelo processo de implantação, não pelo navegador.
4. Configure o domínio personalizado do Worker e o Cloudflare Access conforme a seção abaixo. As variáveis `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` e `APP_ORIGIN` podem ser informadas no build ou nas variáveis de execução do Worker. Exemplo de origem: `https://temis.example.com`, sem barra final. Use o domínio da sua aplicação.
5. Execute um novo build com a versão atualizada do repositório.

`deploy:ci` gera uma configuração temporária ignorada pelo Git, valida o UUID, aplica as migrações no D1 e só então publica o Worker. Se as migrações falharem, o deploy é interrompido. O processo não cria o banco automaticamente: o banco indicado precisa existir na mesma conta e o token de build precisa permitir acesso ao D1 e publicação do Worker.

Os valores de execução definidos no painel são preservados quando não forem fornecidos pelo build. Valores definidos no build têm precedência para as quatro variáveis de execução suportadas (`ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `APP_ORIGIN`, `CHECK_INTERVAL_MINUTES`). Segredos de conectores não são copiados para o arquivo temporário.

Não use `npx wrangler deploy` diretamente com o arquivo de exemplo sem substituir seu marcador por uma configuração local válida. A ausência de configuração do Cloudflare Access bloqueia o acesso com HTTP 503; ela não abre o site ao público. Configure os e-mails permitidos e o hostname em Access antes de utilizar a aplicação.

Para atualizar uma aplicação conectada ao GitHub, envie as alterações para a branch de produção configurada (normalmente `main`). Com builds automáticos habilitados, o Workers Builds inicia a implantação. Acompanhe o resultado em **Workers & Pages → seu Worker → Builds/Implantações**; se necessário, inicie um novo build da versão mais recente. Mantenha o comando `pnpm run deploy:ci` e as variáveis existentes. As migrações já aplicadas são reconhecidas e o banco existente é preservado. Após concluir o deploy, recarregue a página para carregar os arquivos atualizados.

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

A prioridade de integração é o 1º grau. As chaves de configuração aceitam os identificadores do catálogo seguidos de `:1g` (por exemplo, `tjsp:1g`, `trf3:1g` e `trt24:1g`). Isso habilita o cliente SOAP 1.1 / MNI 2.2.2 para o endereço informado, não cria compatibilidade com APIs SAJ/Projudi próprias, eproc ou MNI 3.0. Serviços que exigem certificado cliente ou IP fixo precisam de infraestrutura e adaptação adicionais.

Há perfis de endpoint embutidos para `tjpi:1g`, `tjes:1g`, `tjam:1g`, `trf1:1g`, `trt6:1g` e `trt15:1g`. Eles só são ativados se a respectiva chave estiver presente em `COURT_CONNECTORS`; o MNI desses perfis não é consultado anonimamente por padrão. Sem configuração direta, a alternativa DataJud continua disponível. Exemplo de configuração de um perfil, com credenciais fictícias:

```json
{
  "trt6:1g": {
    "username": "IDENTIFICADOR_AUTORIZADO",
    "password": "SENHA_DO_SERVICO"
  }
}
```

Para outros tribunais, informe também `endpoint`. Use apenas acesso concedido pelo tribunal. Um contrato WSDL acessível não comprova permissão para consultar processos.

A consulta direta do TJRN permanece pendente até que o tribunal confirme um endpoint MNI acessível e as condições de acesso; uma URL de consulta pública no navegador não substitui esse serviço. Configure `tjrn:1g` apenas com o endereço autorizado fornecido pelo tribunal. Não use URLs antigas ou de outro segmento da Justiça.

O conector Projudi/TJGO consulta as operações públicas 74 (dados) e 75 (movimentações), verifica a correspondência do número e a indicação de consulta pública e preserva os acentos de respostas ISO-8859-1. Respostas ambíguas, sigilosas, incompletas ou com paginação ainda não reconhecida geram erro e não confirmam um histórico parcial. A serventia não é usada como nome da comarca. A primeira validação com processo real continua necessária para confirmar variações do contrato e da paginação.

Os endereços de TJMT, TJGO de 1º grau, TJPE de 1º grau e TJBA de 1º grau estão embutidos. O TJBA ainda precisa de validação de acesso; se exigir credenciais, configure-as neste segredo. Para configurar outros serviços ou substituir o endpoint MNI padrão, use `COURT_CONNECTORS` como segredo JSON, com uma chave por tribunal e grau. Exemplo com endereço fictício:

```json
{
  "tjpe:1g": {
    "endpoint": "https://integracao.example.invalid/servico-intercomunicacao-2.2.2",
    "username": "IDENTIFICADOR_AUTORIZADO",
    "password": "SENHA_DO_SERVICO"
  }
}
```

O domínio reservado `example.invalid` é apenas ilustrativo e será rejeitado pela validação do conector. Substitua-o pelo endpoint HTTPS oficial em domínio `.jus.br`, obtido diretamente com o tribunal junto com as condições de acesso. Os endpoints publicados pelo TJPE e TJBA estão nas referências da tabela de cobertura. Use a URL do serviço **sem `?wsdl`**. Omita usuário e senha somente se o serviço aceitar consulta anônima. Não coloque credenciais no repositório, no navegador, nos logs ou nas observações do processo.

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
- Datas são exibidas no horário de Brasília. Datas compactas do MNI usam o município do órgão julgador, quando informado, ou o fuso do tribunal. Regiões que abrangem mais de um fuso (TRF1, TRF3 e TRT14) exigem município ou data com fuso explícito; datas ambíguas não são confirmadas.
- Os avisos representam mudanças encontradas pelo conector. Não substituem os canais oficiais do tribunal.
- Processos excluídos removem histórico e notificações em cascata. Exporte o banco antes de alterações importantes.

```sh
pnpm exec wrangler d1 export temis --remote --output ../temis-backup.sql --config wrangler.local.jsonc
```

Guarde exportações em local privado e fora do checkout. Se precisar voltar o código, use as versões/deployments do Workers. Restaurar o código não restaura o banco: avalie a compatibilidade das migrações antes do rollback. Consulte [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) para recuperação do banco conforme a retenção da conta.

Para adicionar tribunais, atualize `src/courts.ts`, o mapeamento CNJ se necessário e o conector em `src/sources.ts`. Crie testes sintéticos do contrato de resposta e valide uma consulta autorizada antes de habilitar a integração.

## Segurança e licença

Use segredos do Workers para credenciais, restrinja a carteira à equipe necessária e mantenha exportações privadas. O banco contém números de processos, anotações e identidades de usuários; gerencie retenção e acesso conforme a necessidade da equipe.

Licenciado sob a [licença MIT](LICENSE). Copyright © 2026 Dumar Castilho. As dependências mantêm suas próprias licenças e atribuições; a licença deste projeto não substitui os termos de terceiros.
