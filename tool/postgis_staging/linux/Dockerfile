# Source-only package. Public official linux/amd64 manifest resolved 2026-10-17.
# Building this image does not qualify it or authorize any cloud execution.
FROM --platform=linux/amd64 node:24.21.0-bookworm-slim@sha256:51b1100cc2a83d370c6a60952e3f2989c8a43159d0e38586e090f3b3326efefd AS node
# Cross-language contracts require Python. Both pinned stages use Bookworm;
# copy the same Node/npm and its C++ runtime into the Python build stage.
FROM --platform=linux/amd64 python:3.12.13-slim-bookworm@sha256:6e13e65c55e33adf203d77ee371cf8bf5d81bd4902ef07565721f46bf44917af AS build
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
COPY --from=node /usr/lib/x86_64-linux-gnu/libstdc++.so.6 /usr/lib/x86_64-linux-gnu/libstdc++.so.6
COPY --from=node /lib/x86_64-linux-gnu/libgcc_s.so.1 /lib/x86_64-linux-gnu/libgcc_s.so.1
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm
RUN node --version && npm --version && python3 --version && python3 -c "import ssl, sqlite3"
WORKDIR /app/functions
COPY functions/package.json functions/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY functions/tsconfig.json ./
COPY functions/src ./src
COPY functions/search_candidate ./search_candidate
COPY functions/test ./test
COPY tool/postgis_staging/verify-approval.cjs /app/tool/postgis_staging/verify-approval.cjs
COPY tool/postgis_staging/hosted /app/tool/postgis_staging/hosted
COPY tool/postgis_staging/scripts/guard.py tool/postgis_staging/scripts/cloud_provider.py /app/tool/postgis_staging/scripts/
RUN npm run build
RUN node --test test/postgis_execution_approval.test.cjs test/postgis_cloudsql.test.cjs test/postgis_hosted_transport.test.cjs test/postgis_hosted_entrypoint.test.cjs
RUN node --test-isolation=none --test test/postgis_native_diagnostic.test.cjs test/postgis_native_diagnostic_descriptor.test.cjs

FROM --platform=linux/amd64 node:24.21.0-bookworm-slim@sha256:51b1100cc2a83d370c6a60952e3f2989c8a43159d0e38586e090f3b3326efefd
WORKDIR /app
COPY --from=build /app/functions /app/functions
COPY tool/postgis_staging/hosted /app/tool/postgis_staging/hosted
COPY tool/postgis_staging/linux /app/tool/postgis_staging/linux
USER node
ENV PORT=8080
EXPOSE 8080
# Explicit future approved descriptor replaces this dry-run command.
CMD ["node", "functions/lib/postgis_hosted_entrypoint.js", "--dry-run", "/app/tool/postgis_staging/hosted/hosted.example.json"]
