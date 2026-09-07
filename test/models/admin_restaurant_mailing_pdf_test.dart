import 'package:coupon_app/models/admin_restaurant_mailing_batch.dart';
import 'package:coupon_app/models/admin_restaurant_mailing_pdf.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('manifest preserves exact identity, fields, order, and three lines', () {
    final first = _entry(
      'restaurant-a',
      name: 'Café Delta',
      street: 'PO Box 42',
      city: 'New York',
      state: 'NY',
      zip: '10001-1234',
    );
    final second = _entry(
      'restaurant-b',
      name: 'Beta Kitchen',
      street: '18 Main St Suite 4',
      city: 'Boston',
      state: 'MA',
      zip: '02108',
    );
    final manifest = AdminRestaurantMailingManifest(
      <AdminRestaurantMailingManifestEntry>[first, second],
    );

    expect(manifest.entries.map((entry) => entry.catalogRestaurantId), <String>[
      'restaurant-a',
      'restaurant-b',
    ]);
    expect(first.printedLines, <String>[
      'Café Delta',
      'PO Box 42',
      'New York, NY 10001-1234',
    ]);
    expect(second.printedLines, <String>[
      'Beta Kitchen',
      '18 Main St Suite 4',
      'Boston, MA 02108',
    ]);
    expect(() => manifest.entries.add(first), throwsUnsupportedError);
    expect(() => first.printedLines.add('Country'), throwsUnsupportedError);
  });

  test('manifest never deduplicates by matching name or address', () {
    final manifest = AdminRestaurantMailingManifest(
      <AdminRestaurantMailingManifestEntry>[
        _entry('restaurant-a'),
        _entry('restaurant-b'),
      ],
    );

    expect(manifest.labelCount, 2);
    expect(manifest.entries.map((entry) => entry.catalogRestaurantId), <String>[
      'restaurant-a',
      'restaurant-b',
    ]);
  });

  test('manifest rejects duplicate canonical identities', () {
    expect(
      () =>
          AdminRestaurantMailingManifest(<AdminRestaurantMailingManifestEntry>[
            _entry('restaurant-a'),
            _entry('restaurant-a'),
          ]),
      throwsA(isA<AdminRestaurantMailingProtocolException>()),
    );
  });

  test('preflight, problems, and summaries own immutable copies', () {
    final entry = _entry('restaurant-a');
    final layouts = <AdminRestaurantMailingLayoutEntry>[
      AdminRestaurantMailingLayoutEntry(
        entry: entry,
        fontSizePoints: 9,
        lineHeightPoints: 11,
      ),
    ];
    final problems = <AdminRestaurantMailingPdfProblem>[
      AdminRestaurantMailingPdfProblem(
        catalogRestaurantId: 'restaurant-b',
        restaurantName: 'Beta',
        code: AdminRestaurantMailingPdfProblemCode.textCannotFit,
        message: 'The complete address cannot fit.',
      ),
    ];
    final preflight = AdminRestaurantMailingPdfPreflightResult(
      validLayouts: layouts,
      problems: problems,
    );
    layouts.clear();
    problems.clear();

    expect(preflight.validLayouts, hasLength(1));
    expect(preflight.problems, hasLength(1));
    expect(() => preflight.validLayouts.clear(), throwsUnsupportedError);

    final ids = <String>['restaurant-a'];
    final summary = AdminRestaurantMailingPdfArtifactSummary(
      filename: 'bitestar-mailing-labels-20260907-100000.pdf',
      includedCatalogRestaurantIds: ids,
      pageCount: 1,
      problems: preflight.problems,
    );
    ids[0] = 'changed';
    expect(summary.includedCatalogRestaurantIds, <String>['restaurant-a']);
    expect(summary.restaurantCount, 1);
    expect(summary.labelCount, 1);

    final source = Uint8List.fromList('%PDF-synthetic'.codeUnits);
    final artifact = AdminRestaurantMailingPdfArtifact(
      bytes: source,
      summary: summary,
    );
    source[0] = 0;
    final firstRead = artifact.bytes;
    firstRead[0] = 0;
    expect(artifact.bytes[0], 37);
    expect(artifact.byteLength, '%PDF-synthetic'.length);
  });

  test('layout and artifact summaries reject incoherent shapes', () {
    final entry = _entry('restaurant-a');
    expect(
      () => AdminRestaurantMailingLayoutEntry(
        entry: entry,
        fontSizePoints: 7.75,
        lineHeightPoints: 10,
      ),
      throwsA(isA<AdminRestaurantMailingProtocolException>()),
    );
    expect(
      () => AdminRestaurantMailingLayoutEntry(
        entry: entry,
        fontSizePoints: 8,
        lineHeightPoints: 11,
      ),
      throwsA(isA<AdminRestaurantMailingProtocolException>()),
    );

    final problem = AdminRestaurantMailingPdfProblem(
      catalogRestaurantId: 'restaurant-a',
      restaurantName: 'Same Restaurant',
      code: AdminRestaurantMailingPdfProblemCode.textCannotFit,
      message: 'The complete address cannot fit.',
    );
    expect(
      () => AdminRestaurantMailingPdfPreflightResult(
        validLayouts: <AdminRestaurantMailingLayoutEntry>[
          AdminRestaurantMailingLayoutEntry(
            entry: entry,
            fontSizePoints: 9,
            lineHeightPoints: 11,
          ),
        ],
        problems: <AdminRestaurantMailingPdfProblem>[problem],
      ),
      throwsA(isA<AdminRestaurantMailingProtocolException>()),
    );
    expect(
      () => AdminRestaurantMailingPdfArtifactSummary(
        filename: 'restaurant-a-labels.pdf',
        includedCatalogRestaurantIds: const <String>['restaurant-a'],
        pageCount: 2,
        problems: const <AdminRestaurantMailingPdfProblem>[],
      ),
      throwsA(isA<AdminRestaurantMailingProtocolException>()),
    );
  });

  test('sanitized problems reject URLs and unsafe lines', () {
    expect(
      () => AdminRestaurantMailingPdfProblem(
        catalogRestaurantId: 'restaurant-a',
        restaurantName: 'Alpha',
        code: AdminRestaurantMailingPdfProblemCode.unconfirmedTransport,
        message: 'https://example.test/private',
      ),
      throwsA(isA<AdminRestaurantMailingProtocolException>()),
    );
    expect(
      () => AdminRestaurantMailingPdfProblem(
        catalogRestaurantId: 'restaurant-a',
        restaurantName: 'Alpha\nBeta',
        code: AdminRestaurantMailingPdfProblemCode.unsupportedGlyph,
        message: 'Unsupported character.',
      ),
      throwsA(isA<AdminRestaurantMailingProtocolException>()),
    );
  });
}

AdminRestaurantMailingManifestEntry _entry(
  String id, {
  String name = 'Same Restaurant',
  String street = '1 Same Street Apt 2',
  String city = 'Same City',
  String state = 'NY',
  String zip = '10001',
}) => AdminRestaurantMailingManifestEntry.fromReady(
  AdminRestaurantMailingReady(
    catalogRestaurantId: id,
    restaurantName: name,
    streetAddress: street,
    city: city,
    state: state,
    zipCode: zip,
  ),
);
