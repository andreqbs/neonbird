# Imagem do servidor do jogo.
#
# Duas etapas: uma compila, a outra so carrega o binario. O que vai para a VPS
# tem ~12 MB e nao tem compilador, shell, gerenciador de pacote nem nada que
# alguem possa usar se um dia entrar ali.
#
# CONTEXTO DO BUILD: este arquivo aceita as duas escolhas possiveis —
#   - a pasta server/ (docker compose, testes, Dokploy com "Docker Context Path"
#     vazio ou = server);
#   - a RAIZ do repositorio (Dokploy com o contexto na raiz — foi o que derrubou
#     o primeiro deploy: la nao existe go.mod nem go.sum, e o COPY falhava).
# O contexto entra numa pasta de passagem e so o servidor segue adiante. Com o
# contexto na raiz, o `.dockerignore` da raiz do repositorio faz so a pasta
# server/ ser enviada.

FROM golang:1.23-alpine AS build

WORKDIR /src

COPY . /contexto
RUN set -e; \
    if [ -f /contexto/server/go.mod ]; then origem=/contexto/server; \
    elif [ -f /contexto/go.mod ]; then origem=/contexto; \
    else echo "go.mod nao encontrado: o contexto do build precisa ser a raiz do repositorio ou a pasta server/" >&2; exit 1; fi; \
    cp -a "$origem"/. /src/; \
    rm -rf /contexto

RUN go mod download

# CGO desligado = binario estatico, que roda na imagem vazia da proxima etapa.
# -trimpath tira os caminhos da maquina de quem compilou de dentro do binario.
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/majorflyer-server .

# ---------------------------------------------------------------------------

FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=build /out/majorflyer-server /majorflyer-server

# Roda como usuario comum (a imagem `nonroot` ja vem assim): se o processo for
# comprometido, ele nao e root do container.
USER nonroot:nonroot
EXPOSE 8080

ENTRYPOINT ["/majorflyer-server"]
