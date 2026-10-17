import 'dart:convert';
import 'dart:io';

import 'package:coupon_app/legal/legal_documents.dart';
import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../tool/generate_legal_pages.dart' as generator;

void main() {
  for (final doc in legalDocuments) {
    test('${doc.slug} static and readable copies match the app copy', () {
      expect(
        File('web/${doc.slug}.html').readAsStringSync(),
        generator.documentHtml(doc),
      );
      final text = File('legal/${doc.slug}.txt').readAsStringSync();
      expect(text, '${generator.documentText(doc)}\n');
      final manifest =
          jsonDecode(File('legal/review-manifest.json').readAsStringSync())
              as Map;
      expect(
        manifest['documents'][doc.slug]['textSha256'],
        sha256.convert(utf8.encode(text)).toString(),
      );
      expect(text, isNot(contains('Draft for Owner Review')));
      expect(text, contains(legalEffectiveDateLabel));
    });
  }
  test(
    'final source records approval separately from publication and activation',
    () {
      final manifest =
          jsonDecode(File('legal/review-manifest.json').readAsStringSync())
              as Map;
      expect(legalOwnerApproved, true);
      expect(manifest['ownerApproved'], true);
      expect(manifest['published'], generator.legalPublicationVerified);
      expect(manifest['approvedTermsVersion'], 'bitestar-terms-v1');
      expect(manifest['publicOrigin'], 'https://app.colesmartllc.com');
      expect(manifest['effectiveDate'], '2026-10-17');
      expect(manifest['effectiveDate'], legalEffectiveDate);
      expect(manifest['effectiveDatePolicy'], 'first-publication');
      expect(
        generator.documentText(termsOfService),
        contains('Terms version: bitestar-terms-v1'),
      );
    },
  );
  test(
    'legal HTML is self-contained and uses only the existing secure deletion route',
    () {
      for (final doc in legalDocuments) {
        final html = generator.documentHtml(doc);
        expect(html, isNot(contains('<script')));
        expect(html, isNot(contains('<form')));
        expect(html, isNot(contains('<iframe')));
        expect(html, isNot(contains('name="email"')));
        expect(html, contains('name="viewport"'));
        expect(html, contains('lang="en"'));
      }
      final deletion = File('web/delete-account.html').readAsStringSync();
      expect(deletion, contains('href="&#47;#&#47;account&#47;delete"'));
      expect(
        deletion,
        contains('An email address alone is not deletion authority.'),
      );
      expect(deletion, isNot(contains('pending owner confirmation')));
      expect(deletion, isNot(contains('mailto:')));
    },
  );
  test(
    'final copy makes no provider-contract or monitored-mailbox promise',
    () {
      final allText = legalDocuments.map(generator.documentText).join('\n');
      expect(allText, isNot(contains('We require service providers')));
      expect(allText.toLowerCase(), isNot(contains('monitor this mailbox')));
      expect(allText.toLowerCase(), isNot(contains('support process')));
      expect(allText, isNot(contains('https://www.colesmartllc.com/')));
      expect(
        generator.documentText(privacyPolicy),
        contains('ColeSmart LLC does not sell personal information.'),
      );
      for (final service in [
        'Google/Firebase',
        'Stripe',
        'Apple or Google',
        "OpenAI's Moderation service",
        'Google Cloud Vision',
      ]) {
        expect(generator.documentText(privacyPolicy), contains(service));
      }
    },
  );
  test('unchanged business terms remain exact', () {
    final text = generator.documentText(termsOfService);
    for (final sentence in [
      "BiteStar's current restaurant subscription price is \$24.95 per month.",
      'Eligible first-time subscribers may receive a 60-day free trial.',
      'There is no separate cancellation penalty.',
      'Ordinary cancellation does not automatically provide a prorated refund for unused subscription time.',
      'These Terms are governed by the laws of the State of Florida, United States, except where applicable law requires otherwise.',
      'By submitting content, you grant ColeSmart LLC a nonexclusive license to host, store, reproduce, display, and distribute that content as reasonably necessary to operate and promote the BiteStar service.',
    ]) {
      expect(text, contains(sentence));
    }
  });
}
