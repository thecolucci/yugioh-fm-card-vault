# Política de versionamento

## Ciclo atual

Durante o desenvolvimento privado, o projeto usa o formato `0.0.N`, em que `N` representa o número cumulativo da iteração de produto aprovada.

A versão consolidada atual é `v0.0.82`.

Perguntas, análises sem alteração no produto e tarefas administrativas não incrementam a versão. Um novo pacote de mudanças implementado e validado incrementa `N` uma única vez, mesmo quando reúne vários ajustes relacionados.

## Marco da versão 1.0.0

Ao concluir a iteração 100, o projeto entra na auditoria de lançamento. A promoção para `v1.0.0` depende de:

- validação das 722 cartas e dos dados exibidos;
- build, testes, lint e auditorias sem erros bloqueadores;
- revisão final de desktop e mobile;
- revisão dos créditos, avisos legais e política de distribuição de assets;
- documentação de instalação e publicação aprovada;
- definição do ambiente oficial de hospedagem.

## Após o lançamento

A partir de `v1.0.0`, o projeto adota Versionamento Semântico:

- `MAJOR`: mudanças incompatíveis ou reformulação estrutural;
- `MINOR`: novas funcionalidades compatíveis;
- `PATCH`: correções e refinamentos compatíveis.

Exemplos: `1.0.1` para uma correção, `1.1.0` para uma nova funcionalidade e `2.0.0` para uma mudança incompatível de arquitetura ou experiência.
