# Auditoria do Fusion Card Gallery

Referências analisadas:

- https://fusion.lukadevv.com/cards
- https://fusion.lukadevv.com/assets/v2/spritesheets/frames.webp
- https://github.com/lukadevv/fusion-simulator/

## Como o ambiente atual é construído

O site publicado em 21/07/2026 entrega a galeria com Next.js e chunks estáticos em `/_next/static/`. A interface usa classes utilitárias no estilo Tailwind, a fonte `Jersey 15`, um fundo global e componentes React. O repositório público preservado como referência mostra a geração anterior em Preact + Vite + Tailwind, além dos componentes `Card` e `MiniCard` que estabeleceram o padrão visual.

A galeria publicada limita o conteúdo principal a aproximadamente 900 px, mantém um header de 940 px e renderiza os resultados em uma janela interna virtualizada. Em 1890×875, o header começa em `x=475`, o conteúdo em `x=495`, o primeiro minicard mede aproximadamente `132×148`, e o documento completo chega a cerca de 3.633 px de altura por incluir tabelas de drop rate e conteúdo editorial. Para o nosso objetivo de consulta rápida, a virtualização e o uso de sprites são boas decisões; a largura estreita e o documento longo não são.

## Composição do minicard de referência

O minicard do Fusion mede `72×90` e é montado em camadas:

1. Um recorte da arte em `cards.webp`, exibido em `62,54×56,64`.
2. Um recorte do frame em `frames.webp`, exibido em `72×90`.
3. Números de ATK/DEF formados por recortes de `main.png`.
4. Nome e número fora do frame.

O DOM não usa 722 imagens independentes. Cada arte é um `span` com `background-image`, `background-size` e `background-position`. Isso reduz requisições, preserva `image-rendering: pixelated` e permite lazy painting do card inteiro.

## Spritesheets extraídas

### `cards.webp`

- Dimensão: `2652×2688`.
- Grade: `26×28` células.
- Célula: `102×96`.
- Capacidade: 728; 722 posições ocupadas por cards.
- Peso observado: 2.279.778 bytes.
- Os 722 PNGs separados em `assets/minicards/icons` ocupam aproximadamente 8,5 MB.
- A ordem do Fusion é otimizada e não segue o número do card. O script local compara cada PNG com as 728 células e gera um mapa explícito, sem duplicatas.

### `frames.webp`

- Dimensão: `441×308`.
- Oito regiões principais:

| Asset | x | y | largura | altura |
|---|---:|---:|---:|---:|
| Monster | 0 | 0 | 123 | 154 |
| Magic/Field | 123 | 0 | 123 | 154 |
| Card Back | 246 | 0 | 72 | 90 |
| Mini Badge Panel | 246 | 90 | 72 | 64 |
| Ritual | 318 | 0 | 123 | 154 |
| Trap | 0 | 154 | 123 | 154 |
| Blank Monster | 123 | 154 | 123 | 154 |
| Equip | 318 | 154 | 123 | 154 |

Preset confirmado no site publicado para um elemento de `72×90`:

| Tipo | background-position |
|---|---|
| Monster | `0 0` |
| Magic / Field | `-72px 0` |
| Ritual | `-186.15px 0` |
| Trap | `0 -90px` |
| Equip | `-186.15px -90px` |

O `background-size` usado pelo Fusion é `258.15×180`.

### `main.png`

- Dimensão: `191×203`.
- Contém números, ícones de tipos, símbolos e elementos do HUD.
- Os 20 tipos de monstro foram medidos no DOM publicado como recortes de `16×16` e registrados em `assets/minicards/sprite-map.json`.

## Assets preservados

`assets/fusion-reference` contém:

- 71 arquivos observados e baixados da página publicada, com URLs e caminhos locais em `inventory.json`;
- spritesheets originais;
- fontes, estilos, imagens de fundo e retratos observados;
- assets públicos do repositório upstream;
- README, package metadata e licença GPL-3.0 do projeto de referência.

## Decisão para o nosso produto

A reconstrução mantém o que é tecnicamente forte no Fusion — sprites únicos, coordenadas explícitas, fonte pixel, recortes de tipo e pintura eficiente — mas muda a arquitetura visual:

- viewport de aplicação `100dvh`, sem rolagem da página;
- sidebar fixa do header ao footer;
- filtros primários em lista e 20 tipos em uma grade compacta;
- pesquisa e ordenação por Starchips dentro da sidebar;
- catálogo como única região rolável;
- minicards horizontais para combinar arte pequena com nome, tipo, Password e custo em fontes maiores;
- `content-visibility: auto` e containment por card para manter 722 resultados leves no DOM.
