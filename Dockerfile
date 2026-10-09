# MIXMIND · loja, contas e licenças (servidor Node 22, sem dependências)
FROM node:22-slim
WORKDIR /app
COPY . .
ENV NODE_ENV=production PORT=8790 DATA_DIR=/data
EXPOSE 8790
CMD ["node", "--no-warnings", "server/bin/loja.mjs"]
