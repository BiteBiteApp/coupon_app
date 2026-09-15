import { createReadStream } from 'node:fs';
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import {
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const loopbackHost = '127.0.0.1';
const cspReportPath = '/__navigation_history__/csp-report';
const healthPath = '/__navigation_history__/health';
const fontFallbackBasePath = '/__navigation_history__/font-fallback/';
const localRobotoRequestPath =
  `${fontFallbackBasePath}roboto/v32/KFOmCnqEu92Fr1Me4GZLCzYlKw.woff2`;
const googleIdentityServicesUrl = 'https://accounts.google.com/gsi/client';
const localGoogleIdentityStubPath =
  '/__navigation_history__/stubs/google-identity-services.js';
const localGoogleIdentityStubSource =
  'window.onGoogleLibraryLoad?.();\n';
const generatedBootstrapLoad = '_flutter.loader.load();';
const maximumCspReportBytes = 64 * 1024;

const contentSecurityPolicy = [
  "default-src 'none'",
  "base-uri 'self'",
  "child-src 'none'",
  "connect-src 'self'",
  "font-src 'self' data:",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "img-src 'self' data: blob:",
  "manifest-src 'self'",
  "media-src 'none'",
  "object-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "worker-src 'none'",
  `report-uri ${cspReportPath}`,
].join('; ');

const contentTypes = new Map([
  ['.bin', 'application/octet-stream'],
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.otf', 'font/otf'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.ttf', 'font/ttf'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.wasm', 'application/wasm'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

const usage = `
Usage:
  node test/browser/navigation_history_server.mjs \\
    --root /absolute/path/to/isolated-web-build \\
    --ledger /absolute/path/to/request-ledger.jsonl [--port 0]

Build the isolated entrypoint outside the repository first:
  flutter build web --release --no-web-resources-cdn \\
    --pwa-strategy=none \\
    --target test/browser/navigation_history_harness.dart \\
    --output /tmp/BS-BITESAVER-NAVIGATION-IMPLEMENT-002-browser/web

The server binds only to 127.0.0.1. Port 0 selects an unused port. It refuses
an in-repository build or ledger, a CDN-enabled Flutter build, and a build that
still registers a service worker. It does not launch a browser.
`.trim();

function fail(message) {
  process.stderr.write(`navigation history server: ${message}\n`);
  process.exitCode = 2;
}

function parseArguments(argv) {
  const options = { port: 0, root: null, ledger: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      process.stdout.write(`${usage}\n`);
      return null;
    }
    if (!['--root', '--ledger', '--port'].includes(argument)) {
      throw new Error(`unknown argument ${JSON.stringify(argument)}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${argument} requires a value`);
    }
    index += 1;
    if (argument === '--root') {
      options.root = value;
    } else if (argument === '--ledger') {
      options.ledger = value;
    } else {
      if (!/^\d+$/.test(value)) {
        throw new Error('--port must be an integer from 0 through 65535');
      }
      options.port = Number(value);
      if (!Number.isSafeInteger(options.port) || options.port > 65535) {
        throw new Error('--port must be an integer from 0 through 65535');
      }
    }
  }
  if (options.root === null || options.ledger === null) {
    throw new Error('--root and --ledger are required');
  }
  return options;
}

function isWithin(parent, candidate) {
  const pathFromParent = relative(parent, candidate);
  return (
    pathFromParent === '' ||
    (!pathFromParent.startsWith(`..${sep}`) &&
      pathFromParent !== '..' &&
      !isAbsolute(pathFromParent))
  );
}

function requireFile(path, description) {
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`${description} is missing: ${path}`);
  }
}

function validateIsolatedBuild(root) {
  const indexPath = resolve(root, 'index.html');
  const bootstrapPath = resolve(root, 'flutter_bootstrap.js');
  const mainPath = resolve(root, 'main.dart.js');
  const canvasKitScriptPath = resolve(root, 'canvaskit', 'canvaskit.js');
  const canvasKitWasmPath = resolve(root, 'canvaskit', 'canvaskit.wasm');
  const localRobotoAssetPath = resolve(
    root,
    'assets',
    'assets',
    'fonts',
    'NotoSans-Regular.ttf',
  );
  requireFile(indexPath, 'Flutter index');
  requireFile(bootstrapPath, 'Flutter bootstrap');
  requireFile(mainPath, 'compiled harness entrypoint');
  requireFile(canvasKitScriptPath, 'local CanvasKit script');
  requireFile(canvasKitWasmPath, 'local CanvasKit WebAssembly');
  requireFile(localRobotoAssetPath, 'local Roboto fallback substitute');

  const indexSource = readFileSync(indexPath, 'utf8');
  if (!/<script\s+src=["']flutter_bootstrap\.js["']/i.test(indexSource)) {
    throw new Error('index.html does not load the expected local Flutter bootstrap');
  }
  if (
    /<(?:script|link|img)\b[^>]*(?:src|href)=["'](?:https?:)?\/\//i.test(
      indexSource,
    )
  ) {
    throw new Error('index.html contains an external script, link, or image URL');
  }

  const bootstrapSource = readFileSync(bootstrapPath, 'utf8');
  if (!/["']useLocalCanvasKit["']\s*:\s*true/.test(bootstrapSource)) {
    throw new Error(
      'Flutter build is not pinned to local CanvasKit; rebuild with '
        + '--no-web-resources-cdn',
    );
  }
  if (!/_flutter\.loader\.load\(\s*\);\s*$/.test(bootstrapSource)) {
    throw new Error(
      'Flutter bootstrap still enables service-worker loading; rebuild with '
        + '--pwa-strategy=none',
    );
  }

  const serviceWorkerPath = resolve(root, 'flutter_service_worker.js');
  if (existsSync(serviceWorkerPath) && statSync(serviceWorkerPath).size !== 0) {
    throw new Error(
      'flutter_service_worker.js is non-empty; rebuild with --pwa-strategy=none',
    );
  }

  const mainSource = readFileSync(mainPath, 'utf8');
  const googleIdentityRewriteCount =
    mainSource.split(googleIdentityServicesUrl).length - 1;
  if (googleIdentityRewriteCount === 0) {
    throw new Error(
      'compiled harness no longer contains the expected Google Identity '
        + 'Services URL; review the isolation rewrite before running',
    );
  }

  return {
    bootstrapBytes: statSync(bootstrapPath).size,
    indexBytes: statSync(indexPath).size,
    mainBytes: statSync(mainPath).size,
    fontFallbackBasePath,
    googleIdentityRewriteCount,
    localGoogleIdentityStubPath,
    localRobotoAssetPath,
    serviceWorker: existsSync(serviceWorkerPath) ? 'empty' : 'absent',
    usesLocalCanvasKit: true,
  };
}

function parseHostHeader(hostHeader, expectedPort) {
  if (typeof hostHeader !== 'string' || hostHeader.length === 0) {
    return false;
  }
  try {
    const parsed = new URL(`http://${hostHeader}`);
    const parsedPort = parsed.port === '' ? 80 : Number(parsed.port);
    return parsed.hostname === loopbackHost && parsedPort === expectedPort;
  } catch (_) {
    return false;
  }
}

function isLoopbackPeer(remoteAddress) {
  return remoteAddress === loopbackHost || remoteAddress === `::ffff:${loopbackHost}`;
}

function responseHeaders(contentType, contentLength) {
  return {
    'Cache-Control': 'no-store, max-age=0',
    'Content-Length': String(contentLength),
    'Content-Security-Policy': contentSecurityPolicy,
    'Content-Type': contentType,
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    Expires: '0',
    'Origin-Agent-Cluster': '?1',
    'Permissions-Policy': [
      'camera=()',
      'geolocation=()',
      'microphone=()',
      'payment=()',
      'usb=()',
    ].join(', '),
    Pragma: 'no-cache',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  };
}

function sanitizedRequest(request) {
  return {
    host: request.headers.host ?? null,
    method: request.method ?? null,
    origin: request.headers.origin ?? null,
    path: request.url ?? null,
    remoteAddress: request.socket.remoteAddress ?? null,
    userAgent: request.headers['user-agent'] ?? null,
  };
}

function readBoundedBody(request, maximumBytes) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let byteLength = 0;
    request.on('data', (chunk) => {
      byteLength += chunk.length;
      if (byteLength > maximumBytes) {
        rejectBody(new Error(`request body exceeds ${maximumBytes} bytes`));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      resolveBody(Buffer.concat(chunks).toString('utf8'));
    });
    request.on('error', rejectBody);
  });
}

let options;
try {
  options = parseArguments(process.argv.slice(2));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
  process.stderr.write(`${usage}\n`);
  process.exit();
}

if (options === null) {
  process.exit();
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = realpathSync(resolve(scriptDirectory, '..', '..'));

let buildRoot;
let ledgerPath;
let buildEvidence;
try {
  buildRoot = realpathSync(resolve(options.root));
  if (!statSync(buildRoot).isDirectory()) {
    throw new Error(`--root is not a directory: ${buildRoot}`);
  }
  if (isWithin(repositoryRoot, buildRoot)) {
    throw new Error(
      '--root must be an isolated build directory outside the repository',
    );
  }
  if (!isAbsolute(options.ledger)) {
    throw new Error('--ledger must be an absolute path outside the repository');
  }
  ledgerPath = resolve(options.ledger);
  if (isWithin(repositoryRoot, ledgerPath)) {
    throw new Error('--ledger must be outside the repository');
  }
  if (isWithin(buildRoot, ledgerPath)) {
    throw new Error('--ledger must not be inside the served build directory');
  }
  if (existsSync(ledgerPath)) {
    throw new Error(`refusing to overwrite existing ledger: ${ledgerPath}`);
  }
  buildEvidence = validateIsolatedBuild(buildRoot);
  mkdirSync(dirname(ledgerPath), { recursive: true, mode: 0o700 });
  writeFileSync(ledgerPath, '', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
  process.exit();
}

let sequence = 0;
let boundPort = null;
let stopping = false;

function record(event, details = {}) {
  sequence += 1;
  const entry = {
    sequence,
    timestamp: new Date().toISOString(),
    event,
    ...details,
  };
  appendFileSync(ledgerPath, `${JSON.stringify(entry)}\n`, 'utf8');
}

function send(request, response, status, body, contentType, event, details = {}) {
  const payload = Buffer.from(body);
  response.writeHead(status, responseHeaders(contentType, payload.length));
  if (request.method === 'HEAD') {
    response.end();
  } else {
    response.end(payload);
  }
  record(event, {
    request: sanitizedRequest(request),
    status,
    bytes: payload.length,
    ...details,
  });
}

function resolveStaticFile(pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch (_) {
    return { error: 'malformed path encoding', status: 400 };
  }
  if (decodedPath.includes('\0') || decodedPath.includes('\\')) {
    return { error: 'invalid path characters', status: 400 };
  }
  const segments = decodedPath.split('/').filter((segment) => segment !== '');
  if (segments.includes('..') || segments.some((segment) => segment.startsWith('.'))) {
    return { error: 'path is outside the public asset surface', status: 403 };
  }
  const isCustomerRoute =
    segments.length === 3 &&
    segments[0] === 'r' &&
    (segments[1] === 'coupons' || segments[1] === 'bitescore') &&
    segments[2].length > 0;
  const isInviteRoute =
    segments.length === 3 &&
    segments[0] === 'invite' &&
    (segments[1] === 'coupon' || segments[1] === 'bitescore') &&
    segments[2].length > 0;
  const isPublicAppRoute = isCustomerRoute || isInviteRoute;
  const relativePath =
    segments.length === 0 || isPublicAppRoute
      ? 'index.html'
      : segments.join('/');
  let candidate = resolve(buildRoot, relativePath);
  if (!isWithin(buildRoot, candidate) || !existsSync(candidate)) {
    return { error: 'asset not found', status: 404 };
  }
  if (lstatSync(candidate).isSymbolicLink()) {
    return { error: 'symbolic-link assets are not served', status: 403 };
  }
  if (statSync(candidate).isDirectory()) {
    candidate = resolve(candidate, 'index.html');
  }
  if (!existsSync(candidate) || !statSync(candidate).isFile()) {
    return { error: 'asset not found', status: 404 };
  }
  const canonicalCandidate = realpathSync(candidate);
  if (!isWithin(buildRoot, canonicalCandidate)) {
    return { error: 'asset resolves outside the build root', status: 403 };
  }
  return {
    canonicalPath: canonicalCandidate,
    relativePath: relative(buildRoot, canonicalCandidate),
  };
}

const server = createServer(async (request, response) => {
  try {
    if (!isLoopbackPeer(request.socket.remoteAddress)) {
      send(
        request,
        response,
        403,
        'Loopback clients only.\n',
        'text/plain; charset=utf-8',
        'denied_non_loopback_peer',
      );
      return;
    }
    if (boundPort === null || !parseHostHeader(request.headers.host, boundPort)) {
      send(
        request,
        response,
        421,
        'The Host header must match the loopback harness origin.\n',
        'text/plain; charset=utf-8',
        'denied_host',
      );
      return;
    }

    let requestUrl;
    try {
      requestUrl = new URL(request.url ?? '/', `http://${loopbackHost}:${boundPort}`);
    } catch (_) {
      send(
        request,
        response,
        400,
        'Malformed request URL.\n',
        'text/plain; charset=utf-8',
        'denied_malformed_url',
      );
      return;
    }

    const expectedOrigin = `http://${loopbackHost}:${boundPort}`;
    const requestOrigin = request.headers.origin;
    if (requestOrigin !== undefined && requestOrigin !== expectedOrigin) {
      send(
        request,
        response,
        403,
        'Cross-origin requests are not accepted.\n',
        'text/plain; charset=utf-8',
        'denied_origin',
      );
      return;
    }

    if (requestUrl.pathname === cspReportPath) {
      if (request.method !== 'POST') {
        send(
          request,
          response,
          405,
          'CSP reports require POST.\n',
          'text/plain; charset=utf-8',
          'denied_csp_report_method',
        );
        return;
      }
      let rawReport;
      try {
        rawReport = await readBoundedBody(request, maximumCspReportBytes);
      } catch (error) {
        send(
          request,
          response,
          413,
          'CSP report is too large.\n',
          'text/plain; charset=utf-8',
          'denied_oversized_csp_report',
          { error: error instanceof Error ? error.message : String(error) },
        );
        return;
      }
      let report;
      try {
        report = JSON.parse(rawReport);
      } catch (_) {
        report = { malformed: true, raw: rawReport.slice(0, 2048) };
      }
      send(
        request,
        response,
        204,
        '',
        'text/plain; charset=utf-8',
        'csp_violation',
        { report },
      );
      return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      send(
        request,
        response,
        405,
        'Only GET and HEAD are allowed.\n',
        'text/plain; charset=utf-8',
        'denied_method',
      );
      return;
    }

    if (requestUrl.pathname === healthPath) {
      const health = JSON.stringify({
        buildEvidence,
        csp: contentSecurityPolicy,
        ledgerPath,
        origin: expectedOrigin,
        status: 'ready',
      });
      send(
        request,
        response,
        200,
        `${health}\n`,
        'application/json; charset=utf-8',
        'health',
      );
      return;
    }

    if (requestUrl.pathname === localRobotoRequestPath) {
      const font = readFileSync(buildEvidence.localRobotoAssetPath);
      send(
        request,
        response,
        200,
        font,
        'font/ttf',
        'local_font_fallback_served',
        { requestedPath: requestUrl.pathname },
      );
      return;
    }

    if (requestUrl.pathname === localGoogleIdentityStubPath) {
      send(
        request,
        response,
        200,
        localGoogleIdentityStubSource,
        'text/javascript; charset=utf-8',
        'local_google_identity_stub_served',
      );
      return;
    }

    const resolved = resolveStaticFile(requestUrl.pathname);
    if ('error' in resolved) {
      send(
        request,
        response,
        resolved.status,
        `${resolved.error}\n`,
        'text/plain; charset=utf-8',
        'asset_denied',
        { reason: resolved.error },
      );
      return;
    }

    const fileStat = statSync(resolved.canonicalPath);
    const contentType =
      contentTypes.get(extname(resolved.canonicalPath).toLowerCase()) ??
      'application/octet-stream';
    if (resolved.relativePath === 'flutter_bootstrap.js') {
      const bootstrapSource = readFileSync(resolved.canonicalPath, 'utf8');
      const configuredBootstrap = bootstrapSource.replace(
        generatedBootstrapLoad,
        `_flutter.loader.load({config:{fontFallbackBaseUrl:${JSON.stringify(fontFallbackBasePath)}}});`,
      );
      if (configuredBootstrap === bootstrapSource) {
        throw new Error('could not configure the local font fallback base URL');
      }
      send(
        request,
        response,
        200,
        configuredBootstrap,
        contentType,
        'asset_served',
        {
          asset: resolved.relativePath,
          transformation: 'local_font_fallback_base_url',
        },
      );
      return;
    }
    if (resolved.relativePath === 'main.dart.js') {
      const mainSource = readFileSync(resolved.canonicalPath, 'utf8');
      const isolatedMainSource = mainSource.replaceAll(
        googleIdentityServicesUrl,
        localGoogleIdentityStubPath,
      );
      if (
        isolatedMainSource === mainSource ||
        isolatedMainSource.includes(googleIdentityServicesUrl)
      ) {
        throw new Error('could not isolate the Google Identity Services URL');
      }
      send(
        request,
        response,
        200,
        isolatedMainSource,
        contentType,
        'asset_served',
        {
          asset: resolved.relativePath,
          transformation: 'local_google_identity_services_stub',
        },
      );
      return;
    }
    response.writeHead(
      200,
      responseHeaders(contentType, fileStat.size),
    );
    record('asset_served', {
      request: sanitizedRequest(request),
      status: 200,
      bytes: fileStat.size,
      asset: resolved.relativePath,
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    const stream = createReadStream(resolved.canonicalPath);
    stream.on('error', (error) => {
      record('asset_stream_error', {
        request: sanitizedRequest(request),
        asset: resolved.relativePath,
        error: error.message,
      });
      response.destroy(error);
    });
    stream.pipe(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    record('request_handler_error', {
      request: sanitizedRequest(request),
      error: message,
    });
    if (!response.headersSent) {
      send(
        request,
        response,
        500,
        'Harness server error.\n',
        'text/plain; charset=utf-8',
        'server_error_response',
      );
    } else {
      response.destroy();
    }
  }
});

server.keepAliveTimeout = 5_000;
server.headersTimeout = 10_000;
server.requestTimeout = 10_000;
server.maxConnections = 16;

server.on('clientError', (error, socket) => {
  record('client_error', {
    error: error.message,
    remoteAddress: socket.remoteAddress ?? null,
  });
  socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
});

server.on('error', (error) => {
  record('server_error', { error: error.message });
  fail(error.message);
});

function stop(signal) {
  if (stopping) {
    return;
  }
  stopping = true;
  record('server_stopping', { signal });
  const forcedExit = setTimeout(() => {
    record('server_forced_exit', { signal });
    process.exit(1);
  }, 5_000);
  forcedExit.unref();
  server.close(() => {
    clearTimeout(forcedExit);
    record('server_stopped', { signal });
    process.exit(0);
  });
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

server.listen({ host: loopbackHost, port: options.port, exclusive: true }, () => {
  const address = server.address();
  if (address === null || typeof address === 'string') {
    record('server_address_error');
    fail('could not determine the loopback listening address');
    server.close();
    return;
  }
  boundPort = address.port;
  const origin = `http://${loopbackHost}:${boundPort}`;
  record('server_started', {
    buildEvidence,
    buildRoot,
    csp: contentSecurityPolicy,
    ledgerPath,
    node: process.version,
    origin,
  });
  process.stdout.write(
    `${JSON.stringify({ event: 'listening', ledgerPath, origin })}\n`,
  );
});
