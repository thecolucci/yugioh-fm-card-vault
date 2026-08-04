# Pipeline de dados — Forbidden Memories Card Book

## Objetivo

Extrair, normalizar, auditar e publicar os detalhes das 722 cartas sem misturar captura externa com o runtime do Card Book. Cada fase produz um artefato persistente e só libera a seguinte quando seus gates passam.

## Fontes e autoridade

- `app/data/cards.json`: identidade canônica local (ID, nome, tipo, ATK, DEF, Password e Starchips).
- `https://fusion.lukadevv.com/sitemap.xml`: inventário de rotas das 722 cartas.
- página individual do Fusion Simulator: descrição, Field, Guardian Stars, recipes, fusions, equips e caminho do modelo.
- `assets/non-video-cards.gif`: fallback temporário para Magic, Equip, Field, Ritual, Trap e qualquer carta comprovadamente sem modelo 3D.

O ID de três dígitos é a chave primária. Divergências de nome nunca alteram o vínculo automaticamente: são registradas como `NAME_DRIFT` para revisão.

## Diretórios

- `assets/sources/fusion/routes.json`: catálogo de URLs e slugs.
- `assets/sources/fusion/raw/*.html.gz`: snapshots imutáveis das páginas.
- `assets/sources/fusion/capture-manifest.json`: hash, data e status de cada captura.
- `assets/data/card-details/*.json`: staging normalizado no schema v2.
- `assets/sources/fusion/reports/*.json`: auditorias e relatório de publicação.
- `public/data/card-details/*.json`: payloads aprovados consumidos sob demanda.
- `public/game-assets/models/*.webm`: modelos 3D locais.
- `app/data/card-details-manifest.json`: índice leve usado pelo Card Book.

## Fases e gates

### 1. Inventário de rotas

```powershell
npm.cmd run details:routes
```

Gate: exatamente 722 IDs únicos, de `001` a `722`, URL HTTPS e nenhum slug ausente. O relatório mantém avisos de diferenças normalizadas entre slug e nome local.

### 2. Captura reproduzível

Piloto ou intervalo:

```powershell
node scripts/capture-fusion-cards.mjs --ids 001,002,015
node scripts/capture-fusion-cards.mjs --from 001 --to 100 --concurrency 6
```

Lote completo:

```powershell
npm.cmd run details:capture -- --concurrency 24
```

Cada página é validada antes de ser salva: o ID embutido precisa coincidir com a rota. A captura usa retry, gzip e SHA-256. Execuções seguintes reaproveitam snapshots válidos; `--force` é reservado para atualização deliberada da fonte.

Gate: todos os IDs solicitados com status `captured`; falhas permanecem identificadas no manifesto e bloqueiam o lote.

### 3. Normalização determinística

```powershell
npm.cmd run details:normalize
```

O parser transforma o snapshot no schema v2, sem depender da rede. Recipes são ordenados canonicamente, relações são deduplicadas e todos os IDs são preenchidos com três dígitos.

Política de mídia:

- `Monster` com modelo: `model-video`, WebM copiado localmente na publicação.
- tipos não-monstro: `animated-fallback`, apontando para `/game-assets/non-video-cards.gif`.
- monstros Reptile mantêm `field: null`, pois esse tipo não recebe bônus de nenhum dos seis terrenos; a interface mostra `SEM AFINIDADE` sem esconder seus Guardian Stars.
- nenhum player ou URL externa é usado no frontend.

Gate: todo snapshot capturado gera um JSON parseável e com contagens derivadas dos próprios arrays.

### 4. Auditoria semântica

Piloto:

```powershell
node scripts/audit-fusion-details.mjs --ids 001,002,015
```

Lote completo:

```powershell
npm.cmd run details:audit -- --all
```

Validações obrigatórias:

- schema, ID e tipo contra `cards.json`;
- descrição não vazia;
- dois Guardian Stars e um Field para monstros; nenhum para outros tipos;
- referências sem IDs órfãos;
- recipes canônicos e sem duplicatas;
- fusions/equips sem duplicatas;
- parceiro de Equip com classe correta e boost positivo;
- contagens idênticas aos arrays;
- classificação de mídia coerente.
- no lote completo, cada recipe precisa existir como fusão de saída nos dois ingredientes, e cada fusão de saída precisa existir nos recipes da carta resultante.

Erros colocam a carta em quarentena. Avisos, como variação editorial de nome, exigem registro mas não alteram dados automaticamente.

### 5. Publicação atômica

```powershell
npm.cmd run details:publish -- --all --concurrency 24
```

Somente IDs aprovados pela auditoria são publicados. WebMs são baixados, verificados pelo cabeçalho do container e armazenados localmente. O manifesto do frontend só é atualizado após a publicação do lote.

### 6. Auditoria dos artefatos públicos

```powershell
npm.cmd run details:audit -- --all --published
```

Gate final: JSON público existente, WebM válido para cada modelo e GIF válido para todos os fallbacks.

### 7. Validação da aplicação

```powershell
npm.cmd run build
npm.cmd test
npm.cmd run lint
```

Além dos testes automatizados, o checklist visual cobre:

- abertura por clique e teclado;
- navegação anterior/próxima sem desmontar o overlay;
- vídeo em loop e fallback GIF;
- modos Recipes/Fusions/Equips e seus estados desabilitados;
- filtros, paginação e tooltips;
- desktop e mobile;
- ausência de erros no console e de requisições de mídia para domínios externos.

## Atualizações futuras

Uma atualização da fonte sempre cria nova captura com hash e nova auditoria. Nunca se edita o snapshot bruto. Correções manuais precisam ocorrer como regra documentada do normalizador ou override versionado, mantendo o dado original auditável.
