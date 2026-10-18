FROM --platform=linux/amd64 eclipse-temurin:21-jre-jammy@sha256:8ecbec1f32912979c15b86aaf98f7082a77d318a7f92af3d9fe2c0fd2723df10 AS java
FROM --platform=linux/amd64 node:24.21.0-bookworm-slim@sha256:51b1100cc2a83d370c6a60952e3f2989c8a43159d0e38586e090f3b3326efefd
COPY --from=java /opt/java/openjdk /opt/java/openjdk
ENV JAVA_HOME=/opt/java/openjdk PATH=/opt/java/openjdk/bin:$PATH JAVA_TOOL_OPTIONS=-Xmx1400m CI=true FIREBASE_CLI_DISABLE_MOTD=true
WORKDIR /fixture
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY firebase.json firestore.rules storage.rules ./
COPY cloud-firestore-emulator-v1.21.0.jar cloud-storage-rules-runtime-v1.1.3.jar /home/node/.cache/firebase/emulators/
RUN chown -R node:node /fixture /home/node/.cache && java -version && node node_modules/firebase-tools/lib/bin/firebase.js --version
USER node
ENTRYPOINT ["node", "node_modules/firebase-tools/lib/bin/firebase.js", "emulators:start", "--only", "firestore,auth,storage", "--project", "demo-bs-postgis-integration"]
