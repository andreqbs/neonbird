# -----------------------------------------------------------------------------
# Pagina de privacidade do Major Flyer.
#
# Uma pagina estatica, sem build, sem node_modules, sem runtime de aplicacao.
# A imagem final tem so o nginx e um arquivo HTML — nada mais para manter,
# atualizar ou ser explorado.
#
#   docker build -t major-flyer-privacidade .
#   docker run -d --name privacidade -p 8080:80 major-flyer-privacidade
# -----------------------------------------------------------------------------
FROM nginx:1.27-alpine

LABEL org.opencontainers.image.title="Major Flyer — Politica de Privacidade" \
      org.opencontainers.image.description="Pagina estatica da politica de privacidade do app com.aqblab.majorflyer" \
      org.opencontainers.image.licenses="UNLICENSED"

# A imagem oficial ja traz um default.conf; o nosso entra no lugar dele.
RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/privacidade.conf

COPY index.html /usr/share/nginx/html/index.html

# Falha cedo: build quebrado por erro de sintaxe e melhor do que container que
# sobe e cai em producao.
RUN nginx -t

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
