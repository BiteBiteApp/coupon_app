// Run from the repository root. Generated HTML is copied by flutter build web.
// No network, Auth, deployment, or activation is performed here.
import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:coupon_app/legal/legal_documents.dart';

String escape(String value) => const HtmlEscape().convert(value);

String documentText(LegalDocument doc) => [
  doc.title,
  ...legalMetadata(doc),
  for (final block in doc.blocks)
    block.kind == LegalBlockKind.bullets
        ? block.text.map((s) => '• $s').join('\n')
        : block.text.join(': '),
].join('\n\n');

String documentHtml(LegalDocument doc) {
  final body = doc.blocks
      .map(
        (b) => switch (b.kind) {
          LegalBlockKind.paragraph => '<p>${escape(b.text.single)}</p>',
          LegalBlockKind.heading => '<h2>${escape(b.text.single)}</h2>',
          LegalBlockKind.subheading => '<h3>${escape(b.text.single)}</h3>',
          LegalBlockKind.bullets =>
            '<ul>${b.text.map((s) => '<li>${escape(s)}</li>').join()}</ul>',
          LegalBlockKind.link =>
            '<p><a class="action" href="${escape(b.text.last)}">${escape(b.text.first)}</a></p>',
        },
      )
      .join('\n');
  return '''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escape(doc.title)}</title>
<style>
:root { color-scheme: light; font-family: system-ui, -apple-system, sans-serif; color: #212529; background: #faf9f6; }
* { box-sizing: border-box; }
body { margin: 0; font-size: 1.0625rem; line-height: 1.65; overflow-wrap: anywhere; }
main, nav { max-width: 48rem; margin: auto; padding: 1.5rem; }
nav { display: flex; flex-wrap: wrap; gap: .5rem 1rem; padding-bottom: 0; }
a { color: #754020; text-underline-offset: .2em; }
nav a, .action { display: inline-block; padding: .65rem 0; }
a:focus-visible { outline: 3px solid #754020; outline-offset: 4px; }
h1 { font-size: clamp(1.5rem, 5vw, 2rem); line-height: 1.2; margin: 1rem 0; }
h2 { font-size: 1.4rem; line-height: 1.3; margin-top: 2rem; }
h3 { font-size: 1.15rem; line-height: 1.4; }
p, li { margin: 0 0 1rem; }
ul { padding-left: 1.5rem; }
@media print { nav { display: none; } body { background: white; } }
</style>
</head>
<body>
<nav aria-label="BiteStar legal information">
<a href="/privacy-policy.html">Privacy Policy</a>
<a href="/terms-of-service.html">Terms of Service</a>
<a href="/delete-account.html">Account Deletion</a>
</nav>
<main>
<h1>${escape(doc.title)}</h1>
${legalMetadata(doc).map((line) => '<p>${escape(line)}</p>').join('\n')}
$body
</main>
</body>
</html>
''';
}

void main(List<String> args) {
  if (args.any((a) => a != '--check')) {
    stderr.writeln('Usage: dart run tool/generate_legal_pages.dart [--check]');
    exitCode = 2;
    return;
  }
  final outputs = <String, String>{};
  final records = <String, Object?>{};
  for (final doc in legalDocuments) {
    final text = '${documentText(doc)}\n';
    outputs['web/${doc.slug}.html'] = documentHtml(doc);
    outputs['legal/${doc.slug}.txt'] = text;
    records[doc.slug] = {
      'title': doc.title,
      'path': '/${doc.slug}.html',
      'textFile': 'legal/${doc.slug}.txt',
      'textSha256': sha256.convert(utf8.encode(text)).toString(),
    };
  }
  outputs['legal/review-manifest.json'] =
      '${const JsonEncoder.withIndent('  ').convert({'ownerApproved': legalOwnerApproved, 'published': false, 'publicOrigin': legalPublicOrigin, 'approvedTermsVersion': legalTermsVersion, 'effectiveDate': null, 'effectiveDatePolicy': 'first-publication', 'documents': records})}\n';
  for (final entry in outputs.entries) {
    final file = File(entry.key);
    if (args.contains('--check')) {
      if (!file.existsSync() || file.readAsStringSync() != entry.value) {
        stderr.writeln('Generated legal copy differs: ${entry.key}');
        exitCode = 1;
      }
    } else {
      file.parent.createSync(recursive: true);
      file.writeAsStringSync(entry.value);
    }
  }
  if (exitCode == 0) {
    stdout.writeln(
      '${outputs.length} legal artifacts ${args.contains('--check') ? 'match' : 'generated'}; source final, unpublished, no activation.',
    );
  }
}
