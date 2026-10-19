# Atribuição da IA local

Pesos: Dataset112_DentalSegmentator_v100, Dot et al., 2024. Fonte: https://zenodo.org/records/10829675 . Licença CC BY 4.0: https://creativecommons.org/licenses/by/4.0/ . Pesos originais, sem retreinamento ou modificação. Arquivo publicado: 229747861 bytes, MD5 b71cd5230168d28a4f71b078265b76be. Não redistribuídos neste pacote.

Cite: Dot et al., Journal of Dentistry 2024, https://doi.org/10.1016/j.jdent.2024.105130 . Engine: nnU-Net, Isensee et al., Nature Methods 2021, https://doi.org/10.1038/s41592-020-01008-z . Licença Apache 2.0 de nnunetv2 acompanha este diretório. As dependências Python são instaladas com suas próprias licenças, preservadas em site-packages; requisitos exatos no lockfile.

O resultado gerado no Odonto3D passa por adaptação de formato e criação de superfícies simplificadas para exibição. Este protótipo independente não é a extensão SlicerDentalSegmentator e não tem validação clínica.

A rede é convertida localmente para ONNX sem retreinamento, com verificações numéricas em entradas sintéticas. ONNX Runtime usa licença MIT; documentação: https://onnxruntime.ai/docs/api/python/api_summary.html . A restauração de etiquetas preserva a interpolação do nnU-Net e aplica argmax por classe em fluxo.
