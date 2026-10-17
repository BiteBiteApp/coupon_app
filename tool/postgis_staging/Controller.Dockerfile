# Source preparation only. This image has NOT been built or run on Linux here.
# Both are single-architecture linux/amd64 official image manifests resolved
# read-only on 2026-10-17. Build context is the repository after npm run build.
FROM --platform=linux/amd64 node:24.21.0-bookworm-slim@sha256:51b1100cc2a83d370c6a60952e3f2989c8a43159d0e38586e090f3b3326efefd AS node
FROM --platform=linux/amd64 python:3.12.13-slim-bookworm@sha256:6e13e65c55e33adf203d77ee371cf8bf5d81bd4902ef07565721f46bf44917af
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/lib/x86_64-linux-gnu/libstdc++.so.6 /usr/lib/x86_64-linux-gnu/libstdc++.so.6
COPY --from=node /lib/x86_64-linux-gnu/libgcc_s.so.1 /lib/x86_64-linux-gnu/libgcc_s.so.1
WORKDIR /app
COPY tool/postgis_staging/scripts/guard.py tool/postgis_staging/scripts/cloud_provider.py tool/postgis_staging/scripts/cloud_controller.py tool/postgis_staging/scripts/provider_entrypoint.py /app/tool/postgis_staging/scripts/
COPY tool/postgis_staging/verify-approval.cjs /app/tool/postgis_staging/verify-approval.cjs
COPY functions/lib/postgis_execution_approval.js /app/functions/lib/postgis_execution_approval.js
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
# These checks are build steps, not evidence that this source was built locally.
RUN node --version && python3 --version && python3 -c "import ssl, sqlite3"
USER 65532:65532
ENTRYPOINT ["python3", "/app/tool/postgis_staging/scripts/provider_entrypoint.py"]
# No execution config, trust root, approval, credential or timer is in this image.
