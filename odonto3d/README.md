# Odonto3D 0.5 — DICOM, lâminas e IA local

Versão arquivada e citável: **[DOI 10.6084/m9.figshare.34701651](https://doi.org/10.6084/m9.figshare.34701651)**.

Para usar a identificação automática, abra **Abrir Odonto3D com IA.command**. Mantenha o serviço aberto e use a janela em **http://127.0.0.1:8766/**. A instalação já foi preparada neste computador. O instalador de IA desta versão foi preparado para macOS Apple Silicon e Python 3.11/3.12. Em outro Mac compatível, o primeiro uso baixa as bibliotecas Python e o modelo público de cerca de 230 MB; é necessário Python 3.11/3.12, espaço em disco e internet nessa etapa. A inferência usa a CPU e pode levar vários minutos.

O arquivo **Odonto3D.html** também abre diretamente no Chrome/Edge, sem serviço: permite visualizar DICOM, reconstruir séries de lâminas em PDF/JPG e reabrir uma segmentação salva. A execução do modelo de IA continua restrita ao DICOM aberto pelo serviço local. O 3D requer WebGL 2.

## Lateral e espaço de visualização

Importar DICOM, importar lâminas, ferramentas e ajustes ficam na lateral. A aba **Imagem** reúne os controles originais; **Estruturas IA** reúne identificação e camadas. A lateral rola de forma independente, preservando a altura dos quatro painéis. Em telas estreitas, o botão de controles abre a lateral sobre a área de trabalho.

## Colorir estruturas automaticamente

1. Abra o aplicativo pelo arquivo **Abrir Odonto3D com IA.command**.
2. Use **Importar DICOM → Arquivo ZIP**, escolha o exame e selecione a série.
3. Na lateral, abra **Estruturas IA → Identificar estruturas**. É possível explorar os cortes enquanto a CPU processa e cancelar pelo botão da lateral.
4. Confira as sugestões nos três planos. Cada camada tem uma cor ajustável e um controle de visibilidade. **Só dentes** oculta as demais estruturas.
5. **Cores nos cortes** controla a sobreposição 2D. **Estruturas em 3D** mostra as superfícies; **Volume original** mostra também as intensidades do exame.
6. **Salvar** exporta um arquivo `.odseg` com as marcações e suas preferências. Para reabrir, importe primeiro o mesmo DICOM e use **Abrir segmentação**. O aplicativo confere pixels, geometria e transformação de intensidade antes de aceitar o resultado.

O DentalSegmentator identifica cinco grupos: **maxila/crânio superior, mandíbula, dentes superiores, dentes inferiores e canal mandibular**. Não identifica cada dente individualmente e não separa **coroa, raiz ou canais radiculares**. O canal mandibular não é uma identificação direta do nervo. “Não identificado” significa que o modelo não atribuiu voxels àquela classe, e não que a estrutura esteja ausente. Ainda não há correção manual das máscaras.

As cores são sugestões da IA, inicialmente não revisadas. O aplicativo não informa uma confiança clínica nem valida a anatomia automaticamente.

## O que está disponível

- Demonstração geométrica sintética, sem dados de paciente e sem fidelidade anatômica clínica.
- Importação de séries DICOM diretamente de ZIP, por pasta ou por seleção de múltiplos arquivos.
- Escolha da série quando há mais de uma na pasta.
- Cortes axial, coronal e sagital com posição sincronizada, navegação por roda do mouse e controle de contraste/brilho.
- Renderização volumétrica 3D, rotação, aproximação, limiar de intensidade, opacidade e recorte no plano axial.
- Régua experimental em milímetros: selecione **Medir** e clique em dois pontos do mesmo corte.
- Reconstrução experimental de lâminas transversais contidas em PDF ou em arquivos JPG/JPEG. O aplicativo extrai, ordena e reamostra os cortes para uma matriz de visualização, com lâmina transversal, sequência desenrolada e forma 3D curva aproximada.
- PDF com imagens individuais repetidas é detectado automaticamente. Também são aceitos vários JPG individuais ou montagens compatíveis com a grade de sete colunas usada no exemplo testado.
- Limpeza da sessão. DICOM, PDF e JPG devem ser reabertos depois de recarregar a página; as marcações DICOM podem ser exportadas explicitamente em `.odseg`.

## DICOM e lâminas PDF/JPG têm papéis diferentes

O DICOM registra pixels, posição, orientação, espaçamento e profundidade necessários para montar o volume original. As lâminas em PDF/JPG são imagens já exportadas e comprimidas. Delas não é possível recuperar os voxels originais, a geometria exata, a escala de 16 bits ou o ajuste radiológico de janela.

Quando encontra uma sequência compatível, o aplicativo cria uma **reformatação aproximada** para visualização e explicação. O resultado é identificado na tela como “LÂMINAS · ESTIMADO”. Medidas, recorte e IA volumétrica ficam desativados nesse modo. Para diagnóstico, medida, segmentação por IA ou planejamento, use o DICOM original da clínica de radiologia.

## Compatibilidade inicial

Aceita DICOM Part 10, modalidade CT, uma imagem por arquivo, monocromático MONOCHROME2, pixels de 8 ou 16 bits, Explicit ou Implicit VR Little Endian **sem compressão**, ou JPEG Lossless SV1 (UID 1.2.840.10008.1.2.4.70). A série precisa ter cortes axiais alinhados aos eixos do paciente, geometria uniforme e identificadores de estudo, série, imagem e referencial. Direções axiais invertidas são normalizadas para LPS (esquerda, posterior, superior).

A versão rejeita outras compressões, multiframe/Enhanced CT, cortes oblíquos, imagens deslocadas entre cortes, duplicatas e geometria irregular ou incompleta. O ZIP é aberto localmente, com verificação CRC de cada arquivo DICOM e limites de tamanho. ZIP64, arquivos protegidos por senha e arquivos divididos em partes ainda não são suportados. Arquivos auxiliares como XML, DICOMDIR e itens do macOS são ignorados.

Limites: 3.000 arquivos, 1 GB de arquivos DICOM por seleção, até 134.217.728 voxels quando há transformação de intensidade uniforme (armazenamento exato em 16 bits), ou 67.108.864 voxels quando é necessária a conversão para Float32. Para lâminas, o limite é 100 MB por PDF e 240 imagens. PDF protegido por senha, sem uma sequência repetida de cortes ou com diagramação incompatível é rejeitado. Formulários XFA, assinaturas, anexos e formulários interativos não são verificados.

## Limites clínicos e próximos módulos

Este é um protótipo de visualização, **não validado para diagnóstico, medidas clínicas, planejamento cirúrgico ou fabricação de guias**. A régua foi testada com dados sintéticos e espaçamentos conhecidos, mas não foi comparada a exames reais em um visualizador de referência. Intensidades de CBCT não são apresentadas como densidade óssea calibrada.

Para atender o escopo de implantodontia, endodontia, cirurgia e explicação ao paciente, ainda é necessário desenvolver e validar:

1. Compatibilidade com os arquivos dos tomógrafos utilizados, incluindo outras compressões, multiframe e reorientação de volumes oblíquos.
2. Panorâmica curva e cortes transversais perpendiculares à arcada.
3. Separação de dentes individuais, coroa/raiz e canais radiculares, além de edição manual e validação das sugestões de IA.
4. Ferramentas específicas de endodontia, marcações e medidas calibradas.
5. Biblioteca de implantes, planejamento, análise de distâncias e exportações, com validação específica.
6. Salvamento de casos, anotações e integração com escaneamento intraoral, se desejados.

No modo DICOM, a reconstrução preserva a matriz e o espaçamento originais. A renderização 3D usa amostragem e interpolação para exibição; os cortes 2D usam os voxels originais. Os ajustes de limiar/opacidade atuam no volume de intensidades. A segmentação é executada separadamente pelo modelo. Não há IA para emitir diagnóstico ou interpretar laudos. O modelo usa seu pré-processamento e espaçamento de treinamento; as etiquetas são recolocadas na matriz original. As superfícies 3D usam uma grade simplificada para visualização; os cortes usam o mapa de etiquetas na resolução do exame. A inferência admite até 32 milhões de voxels na grade interna do modelo, além dos limites do importador.

## Dados e privacidade

DICOM, PDF e JPG são lidos na memória do navegador. No modo com IA, apenas a matriz de pixels DICOM e os parâmetros de geometria/intensidade são transferidos ao serviço no próprio computador. Tags como nome do paciente não fazem parte desse protocolo. Não há envio a APIs externas, telemetria, localStorage ou IndexedDB. A política de conteúdo permite conexões apenas à mesma origem; o serviço aceita somente 127.0.0.1, com token de sessão e verificação de origem.

Durante a inferência, o serviço cria arquivos temporários em `~/.cache/odonto3d/ai-runtime/jobs`, com acesso restrito ao usuário. Eles são removidos ao concluir, cancelar, falhar ou encerrar normalmente o serviço. Uma interrupção abrupta do computador pode deixar arquivos temporários; remova a pasta de casos residuais somente com o serviço parado. O resultado fica disponível para consulta por uma hora; os bytes são liberados quando a expiração é verificada ou ao encerrar o serviço. O salvamento em `.odseg` é explícito e contém anatomia do exame: trate-o como dado de saúde.

A aplicação não anonimiza os DICOM, PDF ou JPG originais. Nenhum exame, identificação pessoal, captura de paciente ou peso do modelo está incluído no HTML e no pacote de fontes.

## Validação técnica realizada

Os testes automatizados verificam pixels com e sem sinal, formatos de 8/16 bits, valores de 12 bits, rescale, ordem dos cortes, geometria, orientações invertidas, JPEG Lossless, integridade e limites do ZIP, rejeição de dados incompatíveis e cálculo de distâncias com voxels anisotrópicos.

O teste de navegador usa arquivos sintéticos, incluindo uma série DICOM e JPGs de lâminas. Um PDF privado de cinco páginas fornecido pelo usuário também foi testado localmente: o aplicativo extraiu 106 imagens transversais de 661 × 931 pixels, ordenadas pelos rótulos 18–123, e montou uma matriz de visualização de 128 × 106 × 180. Também foi testada uma série DICOM real de 345 cortes de 553 × 553 pixels, voxel de 0,15 mm, JPEG Lossless SV1. Todos os pixels DICOM decodificados coincidiram com uma implementação independente. Os exames e suas capturas não fazem parte desta entrega. Esses testes verificam compatibilidade técnica, não precisão clínica.

## Código-fonte

A pasta `odonto3d` contém os fontes, testes e dependências travadas no lockfile. Para reconstruir, use Node.js 22 ou superior:

```sh
cd odonto3d
pnpm install
node --test tests/*.test.mjs
node build.mjs
```

O build gera `Odonto3D.html` na pasta acima. O arquivo `Odonto3D-fonte.zip` contém os fontes sem `node_modules`. A aplicação final já está pronta; essas instruções são só para desenvolvimento.

Bibliotecas: VTK.js 35.16.0, dicomParser 1.8.21, PDF.js 5.7.284, jpeg-lossless-decoder-js 2.1.2 e fflate 0.8.3. Os avisos de terceiros acompanham os fontes; avisos de licença também são preservados no HTML gerado.

## Referências técnicas

- [DICOM — posição, orientação e espaçamento das imagens](https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_C.7.6.2.html)
- [VTK.js — renderização volumétrica](https://kitware.github.io/vtk-js/api/Rendering_Core_Volume.html)
- [dicomParser — leitor DICOM](https://github.com/cornerstonejs/dicomParser)
- [PDF.js — leitura e extração de imagens PDF](https://mozilla.github.io/pdf.js/examples/)

## Abrir o exame em ZIP

1. Abra `Odonto3D.html` no navegador do computador. Se o arquivo já estava aberto, recarregue a página.
2. Clique em **Importar DICOM → Arquivo ZIP**.
3. Selecione o ZIP recebido da clínica e aguarde a extração local.
4. Escolha a série encontrada. O aplicativo mostra o andamento da descompressão e monta o volume.
5. Ajuste o volume na aba **Imagem** ou use a aba **Estruturas IA** para identificar as cinco camadas.

O aplicativo não mantém o exame embutido no HTML. É necessário selecioná-lo novamente a cada nova sessão.

## Reconstruir lâminas PDF/JPG

1. Clique em **Importar lâminas** na lateral.
2. Escolha um PDF com a sequência transversal ou selecione vários arquivos JPG/JPEG.
3. Aguarde a extração e a ordenação. O resumo informa a quantidade de cortes, os rótulos encontrados e a matriz reformatada.
4. Explore a lâmina transversal, a sequência desenrolada e a forma curva 3D. Todas permanecem identificadas como geometria estimada.

Esse modo não alimenta a IA atual. Para identificar mandíbula, dentes e canal mandibular automaticamente, importe o DICOM original pelo serviço local.

## Modelo e atribuição

Modelo público **Dataset112_DentalSegmentator_v100**, por Dot e colaboradores, publicado em 2024, sob **CC BY 4.0**. Os pesos não foram retreinados nem alterados. O instalador verifica o arquivo publicado antes de extrair; a execução confere o SHA-256 dos arquivos extraídos. Motor nnU-Net v2.5.1 em CPU, com espelhamento de teste e passo 0,5. Dependências Python travadas em `odonto3d/ai/requirements-lock.txt`.

- [Modelo DentalSegmentator e licença](https://zenodo.org/records/10829675)
- [Artigo de Dot et al., Journal of Dentistry (2024)](https://doi.org/10.1016/j.jdent.2024.105130)
- [Extensão original SlicerDentalSegmentator](https://github.com/gaudot/SlicerDentalSegmentator)
- [nnU-Net — Isensee et al. (2021)](https://doi.org/10.1038/s41592-020-01008-z)

O código desta integração de navegador/serviço é específico do protótipo; não é o aplicativo 3D Slicer nem uma versão oficial do DentalSegmentator.

O motor, seus pesos e os temporários ficam em `~/.cache/odonto3d`, fora de Documentos. A rede neural é convertida localmente para ONNX e executada por ONNX Runtime na CPU, preservando os pesos, o tamanho original dos blocos, a sobreposição e o espelhamento do nnU-Net. A conversão é comparada numericamente ao PyTorch em duas entradas sintéticas; isso é verificação técnica, não validação clínica.
