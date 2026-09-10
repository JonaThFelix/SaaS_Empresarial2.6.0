# Central de Gestão Empresarial v2.6.0

Aplicação web empresarial portátil para Windows, sem Docker, WSL ou alteração de BIOS. O servidor utiliza Node.js portátil e o banco é SQLite persistente.

## 1. Como iniciar

Na primeira instalação, execute `INICIAR_WINDOWS.bat`. Se o motor Node portátil ainda não existir, ele será preparado dentro da própria pasta do sistema. Depois acesse `http://localhost:3000`.

O sistema inicia com `HOST=0.0.0.0`, portanto outros computadores da mesma rede podem acessar usando `http://IP-DO-PC-PRINCIPAL:3000`. Todos acessam a mesma aplicação e o mesmo arquivo `data/central-gestao.sqlite`.

Para encerrar deliberadamente o servidor use `PARAR_WINDOWS.bat`. Fechar apenas o navegador não encerra o servidor.

## 2. Banco e arquivos

Banco principal:

`data\central-gestao.sqlite`

O SQLite usa WAL para melhorar concorrência entre leitura e gravação. Os registros empresariais não possuem prazo automático de expiração.

A partir da v2.4, documentos anexados ficam fisicamente em:

`uploads\contracts\<empresa>\<contrato>\...`

O SQLite guarda os metadados do documento: contrato, tipo, título, datas, nome original, tamanho, SHA-256, usuário que enviou e caminho interno.

## 3. Segurança e permissões

- Login individual por CPF ou ID de acesso.
- Senhas protegidas com `scrypt`.
- Sessões autenticadas e CSRF nos formulários de escrita.
- Isolamento dos registros por organização.
- Permissões por módulo e ação.
- Exclusões permanentes críticas exigem perfil `ADMIN` ou `SUPERADMIN` no backend; não é apenas ocultação de botão.
- Auditoria registra alterações, exclusões e ações relevantes.

## 4. Clientes, contratos e versões

Um contrato renovado não deve ser sobrescrito. Use `Renovar contrato`.

Exemplo:

- CT1 / V1: 01/08/2025 a 13/08/2026, R$ 40.000,00.
- Renovação cria CT2 / V2: 14/08/2026 a 13/08/2027, R$ 50.000,00.
- CT1 continua consultável com postos, alocações, valor, escopo, documentos e histórico.

A série contratual registra quantas renovações ocorreram e a ligação entre as versões.

### Prazo de vencimento

As telas contratuais informam a data final e a quantidade exata de dias:

- vencido há X dias;
- vence hoje;
- crítico: até 4 dias;
- atenção: até 30 dias;
- janela de renovação: até 90 dias;
- vigente: quantidade de dias restantes.

## 5. Documentos do contrato

Abra `Clientes > Cliente > Contrato > Documentos`.

Tipos previstos:

- Contrato;
- Aditivo;
- Apólice;
- Ata;
- CCT / instrumento coletivo;
- Proposta / medição;
- Outro documento.

Formatos aceitos: PDF, DOC, DOCX, XLS, XLSX, JPG, JPEG, PNG, TXT e CSV, até 15 MB por arquivo.

Cada documento pode ter título, data de referência, vencimento e observações. A listagem mostra o prazo do próprio documento. O Dashboard também destaca documentos/apólices vencidos ou com vencimento em até 90 dias. O download exige usuário autenticado. Exclusão permanente de documento é administrativa.

## 6. Renovação, reajuste e repactuação

A v2.4 adiciona uma memória financeira formal por série contratual.

Ao renovar, o sistema registra:

- valor-base mensal;
- novo valor mensal;
- diferença mensal;
- percentual de variação;
- CCT/instrumento coletivo;
- referência/número da CCT;
- data-base;
- data de assinatura/aprovação do reajuste;
- data de início do efeito financeiro;
- data final do período retroativo;
- dias retroativos;
- retroativo calculado;
- retroativo final editável;
- medição mensal calculada;
- medição final editável;
- observações da memória de cálculo.

### Cálculo automático padrão

`diferença mensal = novo valor - valor anterior`

`percentual = diferença / valor anterior × 100`

`retroativo automático = diferença mensal / 30 × quantidade de dias do período`

O período é contado de forma inclusiva entre `Efeito financeiro desde` e `Retroativo até`.

Exemplo administrativo:

- valor anterior: R$ 40.000,00;
- novo valor: R$ 50.000,00;
- diferença: R$ 10.000,00;
- variação: 25%;
- efeito financeiro: 01/05/2026;
- retroativo até: 13/08/2026;
- 105 dias;
- cálculo automático: R$ 35.000,00.

Tanto o retroativo final quanto a medição final são editáveis. Isso é proposital: CCTs, contratos e regras de faturamento podem ter metodologias próprias.

Também é possível registrar `Nova repactuação / reajuste` sem criar uma nova versão contratual, quando a alteração financeira ocorre dentro da vigência.

## 7. Colaboradores, alocações e escala

Alocações possuem edição de posto, período, escala, par/ímpar, ciclo, turno, papel operacional, ferista e relação de cobertura. ADMIN pode excluir uma alocação lançada incorretamente; a operação é auditada.

Férias e afastamentos são considerados na escala. Substituições ficam ligadas ao titular e ao período, sem apagar a escala histórica.

O módulo `Escalas` projeta 12x36, 24x72, 6x1, 5x2, diário ou personalizado, inclusive até o fim da vigência contratual.

### Matriz tipo planilha (v2.5)

A visualização padrão foi redesenhada para evitar uma linha repetida para cada colaborador. Agora a escala pode ser lida como uma planilha operacional:

- cada **linha** representa um posto/local;
- cada **coluna** representa uma data;
- cada **célula** contém todas as pessoas projetadas naquele posto/data;
- um posto com 10 profissionais aparece em uma única célula, com os 10 nomes;
- férias, afastamentos, substituições e vagas descobertas aparecem dentro da própria célula;
- períodos longos são separados por mês para manter a leitura organizada;
- a primeira coluna com o posto permanece fixa durante a rolagem horizontal.

Também existe a visão `Quadro por dia`, em que cada data possui uma linha por posto e a equipe inteira fica agrupada na mesma célula. Essa visão é melhor para analisar ocorrências e substituições sem repetir uma linha para cada pessoa.

A exportação CSV da escala também passou a ser agrupada por **data + posto**, com a equipe reunida em uma única coluna.


## Ajuda contextual nos formulários (v2.5)

Campos que podem gerar dúvida operacional agora exibem uma orientação curta diretamente abaixo do campo e um ícone `?` no título. Exemplos:

- competência x vencimento x data de movimento;
- conta bancária usada na conciliação;
- data-base de ciclo 12x36;
- dia par/ímpar;
- ferista, rendição e cobertura;
- efeito financeiro e período retroativo;
- CCT e data-base;
- medição e retroativo editáveis;
- saldo inicial e estoque mínimo;
- condição na entrega/devolução;
- vencimento e referência de documentos contratuais.

A ajuda é centralizada no sistema, portanto aparece nos módulos que utilizam os mesmos campos sem exigir que o usuário consulte um manual externo para as dúvidas mais comuns. Campos simples e autoexplicativos permanecem sem aviso para não poluir a interface.

## 7.1. Regras de cadastro de colaboradores (v2.6)

A partir da v2.6, **Matrícula** e **CPF** são obrigatórios e únicos dentro de cada empresa.

- não é possível criar dois colaboradores com o mesmo CPF;
- não é possível criar dois colaboradores com a mesma matrícula;
- a matrícula é comparada sem diferenciar maiúsculas/minúsculas (`MAT001` e `mat001` são consideradas iguais);
- a proteção existe tanto na validação da aplicação quanto no próprio SQLite por triggers, evitando duplicidade mesmo em gravações fora da interface;
- bancos antigos que já possuam duplicidades não são apagados durante a atualização: a listagem de colaboradores exibe um aviso para regularização e novas duplicidades passam a ser bloqueadas.

## 7.2. Escala 12x36 por Dia/Noite e Par/Ímpar (v2.6)

A classificação do 12x36 passou a combinar **turno** e **paridade**. As quatro classificações operacionais são:

- **Dia Par**;
- **Dia Ímpar**;
- **Noite Par**;
- **Noite Ímpar**.

Na alocação do colaborador informe o turno (`Diurno` ou `Noturno`) e a paridade (`Par` ou `Ímpar`). Para 12x36 os dois campos são obrigatórios. A escala exibe a combinação completa, por exemplo `12x36 · Noite ímpar`.

O cadastro do posto também permite dimensionar separadamente:

- efetivo 12x36 Dia Par;
- efetivo 12x36 Dia Ímpar;
- efetivo 12x36 Noite Par;
- efetivo 12x36 Noite Ímpar.

Exemplo de posto 24 horas com quatro vigilantes na equipe total:

- 1 vigilante Dia Par;
- 1 vigilante Dia Ímpar;
- 1 vigilante Noite Par;
- 1 vigilante Noite Ímpar.

Em um dia par, a projeção exige o profissional Dia Par e o profissional Noite Par. Em um dia ímpar, exige Dia Ímpar e Noite Ímpar. Assim a equipe total é de quatro pessoas, mas a cobertura diária projetada é de duas posições, uma diurna e uma noturna.

### Matriz por posto e turno

Na matriz da escala cada posto continua ocupando apenas uma linha. Dentro de cada célula/data, porém, a equipe fica separada em blocos:

- `☀ Diurno`;
- `☾ Noturno`;
- `Outro / não definido`, quando aplicável.

O nome do colaborador mostra sua classificação 12x36. Vagas e ausências são apuradas no turno correto, evitando misturar a equipe da manhã/dia com a equipe da noite.

O `Quadro diário por turno` usa uma linha por posto e colunas separadas para equipe diurna, equipe noturna, ocorrências e cobertura.

## 7.3. Painéis recolhíveis para contratos grandes (v2.6)

Para evitar telas excessivamente longas, as seções com maior tendência de crescimento foram transformadas em painéis recolhíveis (`Mostrar/Recolher`).

No contrato:

- **Alocações e histórico de colaboradores** inicia recolhido e exibe a quantidade de registros no cabeçalho.

No cadastro do colaborador:

- **Histórico de alocação**;
- **Férias, afastamentos e indisponibilidades**.

O conteúdo continua disponível integralmente; o recurso altera somente a apresentação da tela e não remove registros.

## 8. Log do colaborador

Em `Colaboradores > Editar`, a v2.4 mostra diretamente:

- quantidade atual de uniformes em posse;
- quantidade atual de materiais de estoque vinculados;
- número de patrimônios atualmente alocados;
- botão `Abrir log do colaborador`.

O log consolida uma linha do tempo com entregas, devoluções, perdas, materiais e patrimônio.

## 9. Estoque

A listagem possui `Movimentar / abrir`, `Editar` e, para ADMIN, `Excluir`.

Movimentos de estoque podem ser editados ou excluídos. Depois de qualquer correção, o saldo é recalculado pelo histórico, incluindo o movimento-base `SALDO INICIAL`.

Para preservar rastreabilidade, um item com movimentação operacional não é apagado em bloco. Se a movimentação estiver errada, corrija ou exclua o movimento específico. Se o item apenas não será mais usado, edite e desmarque `Item ativo`.

Um item cadastrado por engano e sem histórico operacional pode ser excluído pelo administrador.

## 10. Uniformes / fardamento

Cada item de fardamento possui saldo, estoque mínimo, custo, tamanho e histórico.

Movimentos:

- compra/entrada;
- entrega ao colaborador;
- devolução;
- troca;
- perda/baixa;
- ajuste.

Os movimentos podem ser editados e, por ADMIN, excluídos. O estoque é recalculado automaticamente. O log do colaborador mostra quantos itens permanecem em sua posse por peça/tamanho.

Quando existe histórico operacional, o item de catálogo não é apagado em bloco para não destruir o histórico pessoal. Cadastros sem histórico podem ser excluídos.

## 11. Patrimônio

O bem cadastrado pode ser aberto, editado, alocado/devolvido e colocado em manutenção.

Alocações patrimoniais podem ser editadas. ADMIN pode excluir uma alocação cadastrada incorretamente; o status do patrimônio é recalculado automaticamente.

Um patrimônio sem alocações/manutenções pode ser excluído. Se já possui histórico operacional, a exclusão do bem é bloqueada para manter o rastreio; corrija a alocação específica em vez de destruir toda a cadeia.

## 12. Financeiro e conciliação

A Central mantém contas a pagar/receber, baixas por conta bancária, extratos e conciliação. A baixa financeira e a linha do extrato são registros distintos e podem ser vinculados. Contas bancárias possuem cadastro, edição, ativação e operações administrativas conforme permissões.

## 13. Backup e restauração

### Recomendado na v2.4: backup completo

Execute `BACKUP_WINDOWS.bat`.

Ele produz em `backups\` um arquivo semelhante a:

`backup-completo-2026-08-13T...zip`

O ZIP contém:

- `data/central-gestao.sqlite` consistente;
- todos os documentos existentes em `uploads`.

Isso é importante porque copiar apenas o SQLite não copia PDFs, apólices, aditivos e demais anexos.

Na interface também existem opções de `Backup completo (banco + documentos)` e `Somente banco SQLite`.

### Restaurar

Use `RESTAURAR_BACKUP_WINDOWS.bat` com a Central parada.

O restaurador aceita:

- `.zip`: restaura banco + documentos;
- `.sqlite`: restaura apenas o banco, útil para backups antigos.

Antes da restauração, o banco atual é copiado para `backups\antes-da-restauracao.sqlite`. Quando um ZIP é restaurado, a pasta atual de anexos também é preservada em backup antes da substituição.

## 14. Atualização de uma Central v2.5 (ou anterior)

Use o pacote de correção v2.6, e não a instalação limpa.

O atualizador:

1. localiza sua Central;
2. encerra apenas o servidor da Central;
3. faz backup do código e banco;
4. copia os arquivos da v2.6;
5. preserva e valida o SQLite existente (a v2.6 não exige mudança destrutiva de schema);
6. executa validações de sintaxe, `integrity_check` e `foreign_key_check`;
7. restaura a versão anterior automaticamente se a validação falhar;
8. inicia a Central novamente.

A migração não substitui o seu `data\central-gestao.sqlite` por um banco vazio.

## 15. Observação sobre memória de cálculo

A Central fornece cálculo administrativo e armazenamento de parâmetros. A fórmula automática de retroativo é deliberadamente genérica e editável. Definição jurídica/contábil do valor efetivamente devido depende do contrato, CCT aplicável, data-base, cláusulas de repactuação, eventos que compõem a planilha de custos e regras de faturamento da relação específica.

<img width="1096" height="630" alt="Captura de tela 2026-09-10 134935" src="https://github.com/user-attachments/assets/efecb93f-d231-43b3-807f-1e0e0053af34" />
<img width="1895" height="856" alt="Captura de tela 2026-09-10 135124" src="https://github.com/user-attachments/assets/4ed14fc4-cbb8-40c2-bdf3-fb368186d57f" />
<img width="1601" height="767" alt="Captura de tela 2026-09-10 135112" src="https://github.com/user-attachments/assets/c327adce-f3cd-439c-9607-1ea8d1412c06" />
<img width="1590" height="837" alt="Captura de tela 2026-09-10 135054" src="https://github.com/user-attachments/assets/bf55846c-5930-4f27-a55a-185c55095b33" />
<img width="1573" height="421" alt="Captura de tela 2026-09-10 135039" src="https://github.com/user-attachments/assets/4f582fd4-aa60-4614-ac9f-b583fe2c78a8" />
<img width="1897" height="863" alt="Captura de tela 2026-09-10 135013" src="https://github.com/user-attachments/assets/84840b0f-f182-4de7-a387-0763c8aae4a9" />

