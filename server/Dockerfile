# Imagem do servidor do ranking.
#
# Duas etapas: uma compila, a outra so carrega o binario. O que vai para a VPS
# tem ~15 MB e nao tem compilador, shell, gerenciador de pacote nem nada que
# alguem possa usar se um dia entrar ali.

FROM golang:1.23-alpine AS build

WORKDIR /src

# As dependencias primeiro: enquanto o go.mod nao muda, o Docker reaproveita
# esta camada e o build seguinte nao baixa nada de novo.
COPY go.mod go.sum ./
RUN go mod download

COPY . .

# CGO desligado = binario estatico, que roda na imagem vazia da proxima etapa.
# -trimpath tira os caminhos da minha maquina de dentro do binario.
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/majorflyer-server .

# ---------------------------------------------------------------------------

FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=build /out/majorflyer-server /majorflyer-server

# Roda como usuario comum (a imagem `nonroot` ja vem assim): se o processo for
# comprometido, ele nao e root do container.
USER nonroot:nonroot
EXPOSE 8080

ENTRYPOINT ["/majorflyer-server"]
