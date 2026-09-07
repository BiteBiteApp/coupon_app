import 'dart:convert';
import 'dart:io';

import 'package:coupon_app/models/admin_restaurant_mailing_batch.dart';
import 'package:coupon_app/models/admin_restaurant_mailing_pdf.dart';
import 'package:coupon_app/services/restaurant_mailing_label_pdf_service.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  final service = RestaurantMailingLabelPdfService(
    clock: () => DateTime(2026, 9, 7, 10, 11, 12),
  );

  group('Avery 5160 geometry', () {
    test('locks official Letter geometry and all 30 top-origin slots', () {
      expect(RestaurantMailingLabelPdfService.pageWidthPoints, 612);
      expect(RestaurantMailingLabelPdfService.pageHeightPoints, 792);
      expect(RestaurantMailingLabelPdfService.columnCount, 3);
      expect(RestaurantMailingLabelPdfService.rowCount, 10);
      expect(RestaurantMailingLabelPdfService.labelsPerPage, 30);
      expect(RestaurantMailingLabelPdfService.labelWidthPoints, 189.36);
      expect(RestaurantMailingLabelPdfService.labelHeightPoints, 72);
      expect(RestaurantMailingLabelPdfService.horizontalPitchPoints, 198);
      expect(RestaurantMailingLabelPdfService.verticalPitchPoints, 72);
      expect(RestaurantMailingLabelPdfService.horizontalGapPoints, 8.64);
      expect(RestaurantMailingLabelPdfService.verticalGapPoints, 0);
      expect(RestaurantMailingLabelPdfService.leftMarginPoints, 13.5);
      expect(RestaurantMailingLabelPdfService.rightMarginPoints, 13.14);
      expect(RestaurantMailingLabelPdfService.topMarginPoints, 36);
      expect(RestaurantMailingLabelPdfService.bottomMarginPoints, 36);

      for (var slot = 0; slot < 30; slot += 1) {
        final geometry = RestaurantMailingLabelPdfService.geometryForLabelIndex(
          slot,
        );
        final column = slot % 3;
        final row = slot ~/ 3;
        expect(geometry.pageIndex, 0);
        expect(geometry.slotIndex, slot);
        expect(geometry.column, column);
        expect(geometry.row, row);
        expect(geometry.labelRect.left, 13.5 + (column * 198));
        expect(geometry.labelRect.top, 36 + (row * 72));
        expect(geometry.labelRect.width, 189.36);
        expect(geometry.labelRect.height, 72);
        expect(geometry.labelRect.pdfBottom, 792 - (36 + (row * 72) + 72));
        expect(geometry.textRect.left, geometry.labelRect.left + 9);
        expect(geometry.textRect.top, geometry.labelRect.top + 9);
        expect(geometry.textRect.width, 171.36);
        expect(geometry.textRect.height, 54);
      }

      final last = RestaurantMailingLabelPdfService.geometryForLabelIndex(29);
      expect(last.labelRect.right, closeTo(612 - 13.14, 0.000001));
      expect(last.labelRect.bottom, 792 - 36);
      expect(last.labelRect.pdfBottom, 36);
      expect(
        RestaurantMailingLabelPdfService.geometryForLabelIndex(
          30,
        ).labelRect.left,
        13.5,
      );
      expect(
        RestaurantMailingLabelPdfService.geometryForLabelIndex(30).pageIndex,
        1,
      );
    });

    test('uses exact page-count boundaries without a trailing page', () {
      const expectations = <int, int>{
        0: 0,
        1: 1,
        29: 1,
        30: 1,
        31: 2,
        50: 2,
        200: 7,
        250: 9,
        400: 14,
      };
      for (final entry in expectations.entries) {
        expect(
          RestaurantMailingLabelPdfService.pageCountForLabelCount(entry.key),
          entry.value,
        );
      }
      expect(
        () => RestaurantMailingLabelPdfService.pageCountForLabelCount(-1),
        throwsRangeError,
      );
    });
  });

  group('three-line text preflight', () {
    test('keeps exact punctuation and accepts common mailing forms', () async {
      final manifest =
          AdminRestaurantMailingManifest(<AdminRestaurantMailingManifestEntry>[
            _entry(
              'po-box',
              name: 'Café Déjà Vu',
              street: 'PO Box 42',
              city: 'Québec',
              state: 'NY',
              zip: '10001',
            ),
            _entry(
              'suite',
              name: 'Suite Kitchen',
              street: '18 Main St Suite 4B',
              city: 'Boston',
              state: 'MA',
              zip: '02108-1234',
            ),
            _entry(
              'apartment',
              name: 'Apartment Café',
              street: '7 Oak Ave Apt 5',
              city: 'Albany',
              state: 'NY',
              zip: '12207',
            ),
          ]);

      final preflight = await service.preflight(manifest);

      expect(preflight.problems, isEmpty);
      expect(preflight.validLayouts, hasLength(3));
      expect(preflight.validLayouts.first.entry.printedLines, <String>[
        'Café Déjà Vu',
        'PO Box 42',
        'Québec, NY 10001',
      ]);
      expect(
        preflight.validLayouts[1].entry.printedLines.last,
        'Boston, MA 02108-1234',
      );
    });

    test('tries the exact bounded candidates and reaches every size', () async {
      expect(RestaurantMailingLabelPdfService.fontSizeCandidates, <double>[
        9,
        8.75,
        8.5,
        8.25,
        8,
      ]);
      for (final size in <double>[9, 8.75, 8.5, 8.25]) {
        expect(
          RestaurantMailingLabelPdfService.lineHeightForFontSize(size),
          11,
        );
      }
      expect(RestaurantMailingLabelPdfService.lineHeightForFontSize(8), 10);

      final candidates = <AdminRestaurantMailingManifestEntry>[];
      var id = 0;
      for (var wide = 12; wide <= 28; wide += 1) {
        for (var narrow = 0; narrow <= 16; narrow += 1) {
          candidates.add(
            _entry(
              'fit-${id++}',
              name:
                  '${List.filled(wide, 'W').join()}'
                  '${List.filled(narrow, 'i').join()}',
              street: '1 Main St',
              city: 'Rome',
              state: 'NY',
              zip: '10001',
            ),
          );
        }
      }

      final preflight = await service.preflight(
        AdminRestaurantMailingManifest(candidates),
      );
      final selectedSizes = preflight.validLayouts
          .map((layout) => layout.fontSizePoints)
          .toSet();
      expect(
        selectedSizes,
        containsAll(RestaurantMailingLabelPdfService.fontSizeCandidates),
      );
      expect(
        preflight.validLayouts
            .where((layout) => layout.fontSizePoints == 8)
            .every((layout) => layout.lineHeightPoints == 10),
        isTrue,
      );
    });

    test(
      'reports unsupported glyph and below-minimum fit explicitly',
      () async {
        final preflight = await service.preflight(
          AdminRestaurantMailingManifest(<AdminRestaurantMailingManifestEntry>[
            _entry('unsupported', name: 'Rocket 🚀 Kitchen'),
            _entry('too-long', street: List<String>.filled(100, 'W').join()),
            _entry('valid', name: 'Valid Café'),
          ]),
        );

        expect(preflight.validLayouts, hasLength(1));
        expect(
          preflight.validLayouts.single.entry.catalogRestaurantId,
          'valid',
        );
        expect(preflight.problems, hasLength(2));
        expect(
          preflight.problems.map((problem) => problem.code),
          containsAll(<AdminRestaurantMailingPdfProblemCode>[
            AdminRestaurantMailingPdfProblemCode.unsupportedGlyph,
            AdminRestaurantMailingPdfProblemCode.textCannotFit,
          ]),
        );
        expect(
          preflight.problems
              .singleWhere(
                (problem) =>
                    problem.code ==
                    AdminRestaurantMailingPdfProblemCode.textCannotFit,
              )
              .message,
          contains('eight-point minimum'),
        );
      },
    );
  });

  group('artifact', () {
    test(
      'requires valid-only approval and preserves order and metadata',
      () async {
        final existingProblem = AdminRestaurantMailingPdfProblem(
          catalogRestaurantId: 'excluded',
          restaurantName: 'Excluded Restaurant',
          code: AdminRestaurantMailingPdfProblemCode.excludedNoQrValidArtifact,
          message: 'Excluded because no approved QR-valid artifact remains.',
        );
        final preflight = await service.preflight(
          AdminRestaurantMailingManifest(<AdminRestaurantMailingManifestEntry>[
            _entry('restaurant-b'),
            _entry('restaurant-a'),
          ]),
          existingProblems: <AdminRestaurantMailingPdfProblem>[existingProblem],
        );

        await expectLater(
          service.build(preflight),
          throwsA(isA<RestaurantMailingLabelPdfException>()),
        );
        final artifact = await service.build(preflight, approveValidOnly: true);

        expect(artifact.bytes.take(5), '%PDF-'.codeUnits);
        expect(
          artifact.summary.filename,
          'bitestar-mailing-labels-20260907-101112.pdf',
        );
        expect(artifact.summary.includedCatalogRestaurantIds, <String>[
          'restaurant-b',
          'restaurant-a',
        ]);
        expect(artifact.summary.restaurantCount, 2);
        expect(artifact.summary.labelCount, 2);
        expect(artifact.summary.pageCount, 1);
        expect(artifact.summary.problems, <AdminRestaurantMailingPdfProblem>[
          existingProblem,
        ]);

        final ascii = latin1.decode(artifact.bytes, allowInvalid: true);
        expect(ascii, contains('BiteStar'));
        expect(ascii, isNot(contains('restaurant-a')));
        expect(ascii, isNot(contains('restaurant-b')));
        expect(ascii, isNot(contains('Excluded Restaurant')));
        expect(ascii, isNot(contains('/invite/')));
        expect(ascii, isNot(contains(' QR ')));
      },
    );

    test(
      'builds 30/31 boundary and large batches without a total cap',
      () async {
        for (final count in <int>[30, 31, 200, 250, 400]) {
          final preflight = await service.preflight(
            AdminRestaurantMailingManifest(
              <AdminRestaurantMailingManifestEntry>[
                for (var index = 0; index < count; index += 1)
                  _entry(
                    'restaurant-$index',
                    name: 'Restaurant $index',
                    street: '${index + 1} Main St',
                  ),
              ],
            ),
          );
          final artifact = await service.build(preflight);
          expect(
            artifact.summary.pageCount,
            RestaurantMailingLabelPdfService.pageCountForLabelCount(count),
          );
          expect(artifact.summary.labelCount, count);
          expect(
            artifact.summary.includedCatalogRestaurantIds.first,
            'restaurant-0',
          );
          expect(
            artifact.summary.includedCatalogRestaurantIds.last,
            'restaurant-${count - 1}',
          );
          expect(artifact.byteLength, greaterThan(1000));
          // Byte size is a diagnostic, not a wall-clock performance assertion.
          // ignore: avoid_print
          print('MAILING_PDF_BYTES labels=$count bytes=${artifact.byteLength}');
        }
      },
    );

    test('does not build an empty PDF', () async {
      final preflight = await service.preflight(
        AdminRestaurantMailingManifest(
          const <AdminRestaurantMailingManifestEntry>[],
        ),
      );
      await expectLater(
        service.build(preflight),
        throwsA(isA<RestaurantMailingLabelPdfException>()),
      );
    });
  });

  test(
    'optionally writes 30/31-page diagnostic PDFs outside the repository',
    () async {
      if (!Platform.isMacOS && !Platform.isLinux) return;
      final outputPrefix =
          Platform.environment['MAILING_PDF_DIAGNOSTIC_PREFIX'];
      if (outputPrefix == null || outputPrefix.isEmpty) return;

      final fitCandidates = <AdminRestaurantMailingManifestEntry>[
        for (var wide = 12; wide <= 28; wide += 1)
          for (var narrow = 0; narrow <= 16; narrow += 1)
            _entry(
              'fit-$wide-$narrow',
              name:
                  '${List<String>.filled(wide, 'W').join()}'
                  '${List<String>.filled(narrow, 'i').join()}',
              street: '1 Main St',
              city: 'Rome',
            ),
      ];
      final fitPreflight = await service.preflight(
        AdminRestaurantMailingManifest(fitCandidates),
      );
      final minimumFit = fitPreflight.validLayouts.firstWhere(
        (layout) => layout.fontSizePoints == 8,
      );
      final entries = <AdminRestaurantMailingManifestEntry>[
        _entry(
          'unicode-first',
          name: 'Café Déjà Vu',
          street: 'PO Box 42',
          city: 'Québec',
          state: 'NY',
          zip: '10001-1234',
        ),
        for (var index = 1; index < 30; index += 1)
          _entry(
            'restaurant-$index',
            name: 'Restaurant $index',
            street: '${index + 1} Main St Suite 4',
          ),
        minimumFit.entry,
      ];
      final preflight31 = await service.preflight(
        AdminRestaurantMailingManifest(entries),
      );
      expect(preflight31.validLayouts, hasLength(31));
      expect(preflight31.validLayouts.last.fontSizePoints, 8);
      final artifact31 = await service.build(preflight31);
      final preflight30 = await service.preflight(
        AdminRestaurantMailingManifest(entries.take(30)),
      );
      final artifact30 = await service.build(preflight30);
      await File('$outputPrefix-30.pdf').writeAsBytes(artifact30.bytes);
      await File('$outputPrefix-31.pdf').writeAsBytes(artifact31.bytes);
      // ignore: avoid_print
      print(
        'MAILING_PDF_DIAGNOSTICS '
        '$outputPrefix-30.pdf ${artifact30.byteLength} bytes; '
        '$outputPrefix-31.pdf ${artifact31.byteLength} bytes',
      );
    },
  );
}

AdminRestaurantMailingManifestEntry _entry(
  String id, {
  String name = 'Test Restaurant',
  String street = '123 Main St Suite 4',
  String city = 'Albany',
  String state = 'NY',
  String zip = '12207',
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
