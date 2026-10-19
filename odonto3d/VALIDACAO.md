# Verificação técnica — Odonto3D 0.5 — 19/10/2026

## Resultado

- Build de produção concluído: HTML independente com bibliotecas e recursos de PDF embutidos.
- 30 testes JavaScript de DICOM, JPEG Lossless, ZIP, geometria, intensidades, distâncias, reconstrução de lâminas e intercâmbio de segmentações: aprovados.
- 9 testes Python do protocolo, geometria de superfícies, restauração das etiquetas, acesso ao serviço e cancelamento: aprovados.
- 15 verificações de integração no Chrome isolado: aprovadas.
- 3 verificações adicionais: fallback 2D sem WebGL, rejeição de PDF inválido e recuperação com JPG válido: aprovadas.
- Nenhuma requisição HTTP externa foi registrada no fluxo de integração usando o arquivo HTML local.
- Nenhum erro de execução do navegador foi registrado nesse fluxo.
- Importação e visualização do ZIP de exemplo fornecido pelo usuário: aprovadas, conforme o escopo descrito abaixo.

## Integração testada

1. Abertura da demonstração e inicialização do volume WebGL.
2. Rotação 3D com mudança dos pixels renderizados.
3. Navegação entre cortes axiais.
4. Sincronização das miras com os demais planos.
5. Régua experimental e apresentação da medida.
6. Reconstrução local a partir de uma sequência JPG sintética.
7. Desativação de medida, recorte e IA no modo de lâminas.
8. Apresentação da origem, quantidade de cortes e matriz reformatada.
9. Importação de 20 arquivos DICOM sintéticos com ordem de seleção invertida.
10. Identificação visual do DICOM importado, diferente da demonstração.
11. Rejeição de espaçamento irregular, mantendo o volume anterior.
12. Limpeza dos arquivos DICOM e das lâminas da sessão.
13. Layout em largura de 390 pixels, sem transbordamento horizontal.
14. Ausência de requisições externas durante o fluxo testado.
15. Ausência de erros de execução durante o fluxo testado.

## Revisão visual da versão 0.3

A versão 0.3 atualiza a apresentação da interface. Os leitores DICOM/ZIP/PDF e a reconstrução volumétrica permanecem iguais à versão 0.2. Foram repetidas as 15 verificações de integração no navegador após as alterações da interface; todas passaram, sem erros de execução nem requisições externas.

Também foram verificadas a ausência de transbordamento horizontal nas larguras de 1440, 1024, 768 e 390 pixels, a abertura do diálogo de importação em computador e celular, a tela vazia de PDF e os estados acessíveis das abas. Capturas de cada layout foram geradas para inspeção. Os textos secundários receberam contraste maior após a primeira revisão.

### Capturas inspecionadas

Inspecionadas capturas da interface no computador, demonstração 3D e cortes 2D, leitor PDF e layout estreito. A renderização foi aguardada antes da captura final. Os pixels dos três cortes permaneceram presentes após limpar a sessão e voltar à demonstração.

## Compatibilidade com o exame de exemplo

O ZIP foi processado localmente. Foram identificados 345 arquivos DICOM de uma série CT, produzida por Carestream Dental CS 8100 3D, com JPEG Lossless SV1 (1.2.840.10008.1.2.4.70), matriz de 553 × 553 × 345 e espaçamento uniforme de 0,15 mm nos três eixos.

Os 105.504.105 voxels foram preservados, sem redução da matriz. A leitura JavaScript foi comparada com decodificação independente por pydicom 3.0.2 e pylibjpeg/libjpeg. O SHA-256 dos pixels de todas as imagens, ordenadas por posição e concatenadas em Uint16 Little Endian, coincidiu integralmente nas duas implementações. A comparação passou tanto com os arquivos DICOM individuais quanto com a importação direta do ZIP. Isso verifica os pixels decodificados deste exemplo; não valida todo o pipeline de exibição ou a precisão clínica.

No Chrome isolado, o ZIP foi selecionado pela entrada da aplicação, a série foi carregada e foram verificados:

- Matriz completa e espaçamento exibidos corretamente.
- Imagens com conteúdo em escala de cinza nos três planos.
- Mudança da imagem ao navegar entre cortes axiais.
- Volume 3D visível e alteração da renderização ao girá-lo.
- Ativação e desativação do recorte axial sem erro de execução.
- Limpeza da sessão, retornando à demonstração sintética.
- Ausência de erros de execução e de requisições HTTP externas no fluxo.

A abertura do ZIP até a montagem do volume levou aproximadamente 6 segundos no ambiente testado; o tempo varia com computador e exame. Uma captura foi inspecionada para confirmar visualmente os cortes e a reconstrução. Arquivos DICOM, identificadores do paciente e capturas do exame não estão incluídos no HTML nem no pacote de fontes distribuído.

## Versão 0.5 — reconstrução por lâminas PDF/JPG

O antigo leitor de páginas PDF foi substituído por uma reconstrução experimental. O importador procura imagens transversais repetidas, determina a sequência pelos números impressos quando disponíveis e reamostra os cortes para uma matriz uniforme. A interface apresenta a lâmina transversal selecionada, a sequência desenrolada, um mapa reformatado e uma forma 3D curva aproximada.

O PDF privado fornecido pelo usuário contém cinco páginas. Foram extraídas 106 imagens transversais independentes de 661 × 931 pixels, numeradas de 18 a 123. O navegador montou uma matriz de visualização de 128 × 106 × 180. Os três painéis 2D apresentaram conteúdo e o volume curvo 3D ficou visível. O fluxo completo levou aproximadamente 12 segundos no computador testado, sem requisições externas nem erros de execução. O PDF, identificadores e capturas permanecem privados e não integram a entrega.

Também foram testados JPGs sintéticos, PDF inválido, recuperação após erro e ausência de WebGL. As larguras de 1440, 1024, 768 e 390 pixels permaneceram sem transbordamento horizontal. No modo de lâminas, medida, recorte e IA volumétrica ficam desativados e a interface exibe “LÂMINAS · ESTIMADO”.

Essa reformatação não recupera voxels, escala de intensidade, espaçamento ou geometria originais. O resultado depende da diagramação e da sequência presentes no documento. Ele serve para exploração visual experimental e não foi validado para diagnóstico, medidas, segmentação, planejamento ou fabricação de guias.

## Limites desta validação

Os testes automatizados distribuídos usam somente dados sintéticos. Foi acrescentado um teste local de compatibilidade com um exame real fornecido pelo usuário. Isso verifica funcionamento técnico e algumas condições de erro; não comprova precisão clínica, compatibilidade com todos os tomógrafos ou conformidade regulatória. As medidas, orientações e reconstruções ainda não foram validadas por especialistas clínicos nem comparadas de ponta a ponta a um visualizador de referência.

A demonstração contém geometria simplificada e não deve ser usada como atlas anatômico. Os controles de limiar e opacidade não constituem segmentação anatômica. Recursos de planejamento de implantes, panorâmica curva e fabricação de guias não estão implementados. A IA acrescenta sugestões de cinco classes, incluindo canal mandibular, ainda sem validação clínica.

## Versão 0.4 — lateral e IA local

A barra superior, importação, ferramentas e controles de segmentação foram movidos à lateral. As abas Imagem/Estruturas IA usam uma área com rolagem própria. As quatro visualizações ocupam a altura restante da janela e não mudam de tamanho quando surgem as camadas. Em telas estreitas, há uma lateral sobreposta com controle de foco. A primeira renderização 2D usa canvas em CPU e repintura após inicializar WebGL. Foram inspecionadas capturas nas larguras 1440, 1024, 768 e 390, sem transbordamento horizontal.

O modelo publicado Dataset112_DentalSegmentator_v100 foi conferido contra o MD5 b71cd5230168d28a4f71b078265b76be (229747861 bytes). A integração aceita exclusivamente as classes 1–5 desse modelo. O mapa permanece na matriz original, com correspondência por SHA-256 dos pixels, dimensões, origem, espaçamento e rescale. Cores, visibilidade e intensidade da sobreposição são exportadas e reimportadas sem modificar as etiquetas.

Os testes Python conferem: limites e integridade do upload; exclusão de identificadores do cabeçalho; origem/eixos/espaçamento das malhas; exportação da matriz completa; equivalência voxel a voxel da restauração em fluxo com a função oficial do nnU-Net em casos sintéticos, incluindo empates, recorte e transposição; rejeição de origem/host/token incorretos; apenas um trabalho por vez; encerramento do processo de inferência e remoção de temporários ao cancelar.

O caminho PyTorch direto excedeu a memória deste Mac de 16 GB e foi interrompido. A execução da rede foi transferida para ONNX Runtime CPU; os pesos, a arquitetura e os blocos originais de 128 × 160 × 112 são preservados. Antes de aceitar a conversão, a integração comparou logits e etiquetas com PyTorch em duas entradas sintéticas de 32 × 32 × 32 e 64 × 32 × 32. Houve concordância de 100% das etiquetas nos dois casos; a maior diferença absoluta de logit foi 0,000102. Essa verificação não comprova precisão clínica. A restauração em fluxo evita alocar seis mapas de probabilidades na resolução completa. O ambiente definitivo fica em ~/.cache/odonto3d, evitando dependências sob demanda na pasta Documentos.

### Verificação real da IA

O exame real fornecido foi processado inteiramente pelo serviço local em CPU. A inferência até a restauração das etiquetas levou 441 segundos; o fluxo incluindo verificações da interface e salvamento levou 455 segundos. Não houve requisições externas pelo navegador nem erros de execução registrados.

O resultado contém 7.071.801 voxels de maxila/crânio superior, 210.826 de mandíbula, 3.141.488 de dentes superiores e 1.724.014 de dentes inferiores. O modelo não atribuiu voxels ao canal mandibular neste exame. A interface mostra essa classe como “Não identificado”, sem inventar um trajeto nem concluir que esteja ausente.

Foram conferidos: sobreposição colorida nos três planos, cores editáveis, ocultação das estruturas ósseas por “Só dentes”, alternância do volume original, salvamento em .odseg, remoção e reabertura do resultado com preferências preservadas. Os limites dos painéis permaneceram idênticos antes e depois das camadas.

A inspeção visual identificou iluminação escura nas superfícies. Foi corrigida a orientação dos triângulos para concordar com as normais em XYZ, com teste geométrico específico. As superfícies foram regeneradas sem mudar as etiquetas da IA e novamente verificadas no navegador, incluindo o recorte axial. Capturas e o resultado do exame ficam na pasta privada de trabalho e não integram o HTML, a prévia sintética nem o ZIP de fontes.

Esta conferência demonstra funcionamento técnico neste exemplo. Não houve avaliação especializada da acurácia anatômica nem validação de diagnóstico, nervos, medidas ou planejamento.
