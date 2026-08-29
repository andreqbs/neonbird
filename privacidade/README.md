# Politica de Privacidade — Major Flyer

Pagina unica e estatica com a politica de privacidade do app `com.aqblab.majorflyer`,
para colar no campo **URL da politica de privacidade** do Google Play Console.

Portugues e ingles no mesmo arquivo, com botao de troca. Sem build, sem
dependencia, sem CDN: `index.html` e autocontido (estilo, icone e script embutidos).

## Antes de publicar — preencha os campos

O texto tem tres marcadores entre colchetes que precisam do seu dado real:

| Marcador | O que colocar |
|---|---|
| `[NOME COMPLETO OU RAZÃO SOCIAL]` | seu nome civil ou a razao social da empresa |
| `[CPF ou CNPJ]` | o documento do controlador |
| `[CIDADE / ESTADO]` | sua comarca (aparece tambem na clausula de foro) |

Achar todos de uma vez:

```bash
grep -n "\[NOME\|\[CPF\|\[CIDADE\|\[FULL LEGAL\|\[CITY" index.html
```

O e-mail de contato ja esta preenchido com `andreqbs@gmail.com`. Se preferir um
endereco dedicado (ex.: `privacidade@seudominio.com`), troque as ocorrencias.

## Subir na VPS

```bash
docker compose up -d --build
```

A pagina responde em `http://SEU_IP:8080`. Ajuste a porta no `docker-compose.yml`
se este for o unico servico da maquina.

Sem compose:

```bash
docker build -t major-flyer-privacidade . && docker run -d --name privacidade --restart unless-stopped -p 8080:80 major-flyer-privacidade
```

## HTTPS

O Google Play **exige** que a URL da politica seja acessivel publicamente, e um
endereco `https://` evita qualquer atrito na revisao. Coloque um proxy reverso
com certificado na frente (Caddy, Traefik ou Nginx Proxy Manager apontando para
`http://127.0.0.1:8080`) e depois descomente a linha do `Strict-Transport-Security`
no `nginx.conf`.

## Rotas

| Rota | Resposta |
|---|---|
| `/` | a politica |
| `/privacidade`, `/privacy` | redirecionam para `/` |
| `/health` | `ok` — usado pelo HEALTHCHECK do container |
| qualquer outra | serve a politica (link errado no Play Console nunca vira 404) |

## Depois de trocar o texto

```bash
docker compose up -d --build
```

O `index.html` entra na imagem no momento do build, entao editar o arquivo no
host nao muda o container em execucao sem um novo build.

## Onde isso aparece no Play Console

`Crescer > Presenca na loja > Ficha da loja principal` e tambem em
`Politica > Conteudo do app > Politica de privacidade`. A mesma URL serve para
as faixas de teste interno, fechado e aberto.

## Manter o texto verdadeiro

A politica descreve o que o codigo faz hoje: armazenamento so local via
`AsyncStorage`, anuncios do AdMob com `requestNonPersonalizedAdsOnly: true`,
Play Games Services inativo. **Se qualquer uma dessas coisas mudar, o texto
precisa mudar junto** — politica desatualizada e mais arriscada do que politica
nenhuma, porque vira declaracao falsa.

Pontos de atencao ja mapeados:

- ativar o ranking global do Play Games → atualizar a Secao 8.2;
- trocar para anuncios personalizados → reescrever a Secao 7.4 e a declaracao
  de Seguranca de Dados;
- adicionar analytics, crash reporting ou qualquer back-end → a Secao 4 deixa de
  ser verdadeira e o documento inteiro precisa ser revisto.
