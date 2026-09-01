import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:coupon_app/models/admin_restaurant_qr_batch.dart';
import 'package:coupon_app/services/restaurant_qr_pdf_service.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:qr/qr.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  final generatedAt = DateTime(2026, 8, 29, 20, 54);
  final service = RestaurantQrPdfService(clock: () => generatedAt);

  group('Avery 5658 geometry', () {
    test('uses the exact Letter page and 6 by 8 physical grid', () {
      expect(RestaurantQrPdfService.pageWidthPoints, 612);
      expect(RestaurantQrPdfService.pageHeightPoints, 792);
      expect(RestaurantQrPdfService.columnCount, 6);
      expect(RestaurantQrPdfService.rowCount, 8);
      expect(RestaurantQrPdfService.labelsPerPage, 48);
      expect(RestaurantQrPdfService.labelSizePoints, 72);
      expect(RestaurantQrPdfService.horizontalPitchPoints, 90);
      expect(RestaurantQrPdfService.verticalPitchPoints, 90);
      expect(RestaurantQrPdfService.horizontalGapPoints, 18);
      expect(RestaurantQrPdfService.verticalGapPoints, 18);

      for (var slot = 0; slot < 48; slot += 1) {
        final geometry = RestaurantQrPdfService.geometryForLabelIndex(slot);
        final expectedColumn = slot % 6;
        final expectedRow = slot ~/ 6;
        expect(geometry.pageIndex, 0);
        expect(geometry.slotIndex, slot);
        expect(geometry.column, expectedColumn);
        expect(geometry.row, expectedRow);
        expect(
          geometry.labelRect,
          RestaurantQrPdfRect(
            left: 45 + (expectedColumn * 90),
            top: 45 + (expectedRow * 90),
            width: 72,
            height: 72,
          ),
          reason: 'Unexpected physical label rectangle for slot $slot.',
        );
      }

      final first = RestaurantQrPdfService.geometryForLabelIndex(0);
      final last = RestaurantQrPdfService.geometryForLabelIndex(47);
      expect(first.labelRect.left, 45);
      expect(first.labelRect.top, 45);
      expect(last.labelRect.right, 612 - 45);
      expect(last.labelRect.bottom, 792 - 45);
      expect(
        RestaurantQrPdfService.geometryForLabelIndex(48).labelRect,
        first.labelRect,
      );
      expect(RestaurantQrPdfService.geometryForLabelIndex(48).pageIndex, 1);
    });

    test('uses the exact provisional one-inch content geometry', () {
      final geometry = RestaurantQrPdfService.geometryForLabelIndex(0);
      expect(
        geometry.headerRect,
        const RestaurantQrPdfRect(
          left: 49.5,
          top: 49.5,
          width: 63,
          height: 7.5,
        ),
      );
      expect(
        geometry.qrRect,
        const RestaurantQrPdfRect(left: 54, top: 58.5, width: 54, height: 54),
      );
      expect(
        RestaurantQrPdfService.safeInsetPoints +
            RestaurantQrPdfService.headerHeightPoints +
            RestaurantQrPdfService.headerGapPoints +
            RestaurantQrPdfService.qrOuterSizePoints +
            RestaurantQrPdfService.safeInsetPoints,
        72,
      );
    });

    test('has exact page-count boundaries and no trailing page', () {
      expect(RestaurantQrPdfService.pageCountForLabelCount(0), 0);
      expect(RestaurantQrPdfService.pageCountForLabelCount(1), 1);
      expect(RestaurantQrPdfService.pageCountForLabelCount(47), 1);
      expect(RestaurantQrPdfService.pageCountForLabelCount(48), 1);
      expect(RestaurantQrPdfService.pageCountForLabelCount(49), 2);
      expect(
        () => RestaurantQrPdfService.pageCountForLabelCount(-1),
        throwsRangeError,
      );
    });
  });

  group('QR matrix and physical-density preflight', () {
    test(
      'matches qr package EC Q matrices and coalesces exact dark runs',
      () async {
        final manifest = _manifest(
          restaurantCount: 1,
          types: AdminRestaurantQrLabelType.values,
        );
        final result = await service.preflight(manifest);

        expect(
          RestaurantQrPdfService.errorCorrectLevel,
          QrErrorCorrectLevel.quartile,
        );
        expect(RestaurantQrPdfService.quietZoneModules, 4);
        expect(result.problems, isEmpty);
        expect(result.labelPlans, hasLength(4));

        final matrixSizes = <String, int>{};
        for (final plan in result.labelPlans) {
          final expected = QrImage(
            QrCode(
              payload: QrPayload.fromString(plan.label.payloadUrl),
              errorCorrectLevel: QrErrorCorrectLevel.quartile,
            ),
          );
          matrixSizes[plan.label.type.wireName] = expected.moduleCount;
          expect(plan.matrix.dataModuleCount, expected.moduleCount);
          expect(plan.moduleSizePoints, 54 / (expected.moduleCount + 8));
          expect(
            plan.moduleSizePoints,
            greaterThanOrEqualTo(
              RestaurantQrPdfService.minimumQrModuleSizePoints,
            ),
          );

          final reconstructed = List<List<bool>>.generate(
            expected.moduleCount,
            (_) => List<bool>.filled(expected.moduleCount, false),
          );
          for (final run in plan.matrix.horizontalDarkRuns) {
            expect(run.length, greaterThan(0));
            for (
              var column = run.startColumn;
              column < run.startColumn + run.length;
              column += 1
            ) {
              reconstructed[run.row][column] = true;
            }
          }

          for (var row = 0; row < expected.moduleCount; row += 1) {
            for (var column = 0; column < expected.moduleCount; column += 1) {
              expect(
                plan.matrix.isDark(row, column),
                expected.isDark(row, column),
                reason:
                    'Matrix drift for ${plan.label.type.wireName} at '
                    '$row,$column.',
              );
              expect(reconstructed[row][column], expected.isDark(row, column));
            }
          }
          expect(
            plan.matrix.horizontalDarkRuns.length,
            lessThan(plan.matrix.darkModuleCount),
          );
        }
        // ignore: avoid_print
        print('PDF_QR_MATRIX_DIAGNOSTIC $matrixSizes');
      },
    );

    test(
      'reports an over-dense canonical route without exposing its URL',
      () async {
        final denseId = 'dense-${List<String>.filled(220, 'x').join()}';
        final denseLabel = _label(
          type: AdminRestaurantQrLabelType.biteSaverCustomer,
          restaurantId: denseId,
          index: 0,
        );
        final directMatrix = QrImage(
          QrCode(
            payload: QrPayload.fromString(denseLabel.payloadUrl),
            errorCorrectLevel: QrErrorCorrectLevel.quartile,
          ),
        );
        expect(
          RestaurantQrPdfService.moduleSizeForDataModuleCount(
            directMatrix.moduleCount,
          ),
          lessThan(RestaurantQrPdfService.minimumQrModuleSizePoints),
        );

        final result = await service.preflight(
          AdminRestaurantQrArtifactManifest(
            selectedRestaurantCount: 1,
            restaurants: <AdminRestaurantQrArtifactRestaurant>[
              AdminRestaurantQrArtifactRestaurant(
                catalogRestaurantId: denseId,
                restaurantName: 'Dense Route Cafe',
                labels: <AdminRestaurantQrLabelEntry>[
                  _label(
                    type: AdminRestaurantQrLabelType.ownerInvite,
                    restaurantId: denseId,
                    index: 0,
                  ),
                  denseLabel,
                ],
              ),
            ],
          ),
        );

        expect(result.problems, hasLength(1));
        expect(result.problems.single.catalogRestaurantId, denseId);
        expect(result.problems.single.restaurantName, 'Dense Route Cafe');
        expect(
          result.problems.single.labelType,
          AdminRestaurantQrLabelType.biteSaverCustomer,
        );
        expect(result.problems.single.code, 'qr_too_dense');
        expect(result.problems.single.message, isNot(contains('https://')));
        expect(result.problems.single.message, isNot(contains(denseId)));
        expect(result.validManifest.labelCount, 1);
        expect(
          result.labelPlans.single.label.type,
          AdminRestaurantQrLabelType.ownerInvite,
        );
      },
    );

    test(
      'turns unsupported font characters into explicit layout problems',
      () async {
        final result = await service.preflight(
          _manifest(restaurantCount: 1, restaurantName: '東京 Sushi'),
        );

        expect(result.hasValidLabels, isFalse);
        expect(result.problems, hasLength(1));
        expect(result.problems.single.code, 'restaurant_name_font_unsupported');
        expect(result.problems.single.message, isNot(contains('東京')));
      },
    );
  });

  group('header, ordering, and immutable artifact', () {
    test('preserves restaurant and I C SA SR order', () async {
      final manifest = _manifest(
        restaurantCount: 2,
        types: AdminRestaurantQrLabelType.values,
      );
      final preflight = await service.preflight(manifest);
      expect(preflight.problems, isEmpty);
      expect(
        preflight.labelPlans
            .map(
              (plan) =>
                  '${plan.catalogRestaurantId}:${plan.label.type.wireName}',
            )
            .toList(),
        <String>[
          'restaurant-0:I',
          'restaurant-0:C',
          'restaurant-0:SA',
          'restaurant-0:SR',
          'restaurant-1:I',
          'restaurant-1:C',
          'restaurant-1:SA',
          'restaurant-1:SR',
        ],
      );
      expect(
        preflight.validManifest.restaurants[0].labels,
        manifest.restaurants[0].labels,
      );
      expect(
        preflight.validManifest.restaurants[1].labels,
        manifest.restaurants[1].labels,
      );
    });

    test(
      'uses deterministic ellipsis without shrinking text indefinitely',
      () async {
        final longName = List<String>.filled(20, 'Extraordinary').join(' ');
        final manifest = _manifest(
          restaurantCount: 1,
          restaurantName: longName,
        );
        final first = await service.preflight(manifest);
        final second = await service.preflight(manifest);

        expect(first.problems, isEmpty);
        expect(first.labelPlans.single.headerText, endsWith('…'));
        expect(
          first.labelPlans.single.headerText,
          second.labelPlans.single.headerText,
        );
        expect(first.labelPlans.single.headerText, startsWith('I '));
        expect(
          first.labelPlans.single.headerText.length,
          lessThan(longName.length),
        );
        expect(RestaurantQrPdfService.headerFontSizePoints, 6.5);
        final artifact = await service.build(first);
        await _writeDiagnosticPdfIfRequested(
          artifact.bytes,
          environmentKey: 'BITESTAR_PDF_HEADER_DIAGNOSTIC_OUTPUT',
        );
      },
    );

    test('embeds supported Unicode restaurant names', () async {
      final preflight = await service.preflight(
        _manifest(
          restaurantCount: 1,
          restaurantName: 'Café München Αθήνα Москва',
        ),
      );
      expect(preflight.problems, isEmpty);
      final artifact = await service.build(preflight);
      expect(artifact.bytes, isNotEmpty);
      expect(artifact.summary.labelCount, 1);
      await _writeDiagnosticPdfIfRequested(
        artifact.bytes,
        environmentKey: 'BITESTAR_PDF_UNICODE_DIAGNOSTIC_OUTPUT',
      );
    });

    test(
      'produces generic metadata, filename, and defensive PDF bytes',
      () async {
        final preflight = await service.preflight(
          _manifest(restaurantCount: 1),
        );
        final artifact = await service.build(preflight);
        final originalFirstByte = artifact.bytes.first;
        final mutableCopy = artifact.bytes..[0] = 0;
        final pdfText = latin1.decode(artifact.bytes, allowInvalid: true);

        expect(mutableCopy.first, 0);
        expect(artifact.bytes.first, originalFirstByte);
        expect(
          artifact.summary.filename,
          'bitestar-qr-labels-20260829-205400.pdf',
        );
        expect(artifact.summary.pageCount, 1);
        expect(artifact.summary.restaurantCount, 1);
        expect(artifact.summary.labelCount, 1);
        expect(
          artifact.summary.includedManifest,
          same(preflight.validManifest),
        );
        expect(pdfText, startsWith('%PDF-1.4'));
        expect(pdfText, contains('BiteStar QR Labels'));
        expect(pdfText, contains('BiteStar'));
        expect(pdfText, isNot(contains('https://go.bitestar.app')));
        expect(pdfText, isNot(contains('synthetic-token')));
        expect(pdfText, isNot(contains('invitation-0')));
      },
    );

    test('does not build an empty or all-invalid artifact', () async {
      final emptyPreflight = await service.preflight(
        AdminRestaurantQrArtifactManifest(
          selectedRestaurantCount: 0,
          restaurants: const <AdminRestaurantQrArtifactRestaurant>[],
        ),
      );
      await expectLater(
        service.build(emptyPreflight),
        throwsA(isA<RestaurantQrPdfException>()),
      );
    });
  });

  group('multipage output', () {
    for (final labelCount in <int>[47, 48, 49]) {
      test('$labelCount labels have the exact PDF page count', () async {
        final preflight = await service.preflight(
          _manifest(restaurantCount: labelCount),
        );
        final artifact = await service.build(preflight);
        final expectedPages = labelCount <= 48 ? 1 : 2;
        final pdfText = latin1.decode(artifact.bytes, allowInvalid: true);

        expect(artifact.summary.labelCount, labelCount);
        expect(artifact.summary.pageCount, expectedPages);
        expect(_pdfPageObjectCount(pdfText), expectedPages);
        expect(_pdfLetterMediaBoxCount(pdfText), expectedPages);
        if (labelCount == 49) {
          await _writeDiagnosticPdfIfRequested(
            artifact.bytes,
            environmentKey: 'BITESTAR_PDF_DIAGNOSTIC_OUTPUT',
          );
        }
      });
    }

    test(
      'supports 1, 50, 200, 250, and 400 restaurants without an export cap',
      () async {
        for (final restaurantCount in <int>[1, 50, 200, 250, 400]) {
          final preflight = await service.preflight(
            _manifest(restaurantCount: restaurantCount),
          );
          final artifact = await service.build(preflight);
          final expectedPages = RestaurantQrPdfService.pageCountForLabelCount(
            restaurantCount,
          );

          expect(preflight.problems, isEmpty);
          expect(artifact.summary.selectedRestaurantCount, restaurantCount);
          expect(artifact.summary.restaurantCount, restaurantCount);
          expect(artifact.summary.labelCount, restaurantCount);
          expect(artifact.summary.pageCount, expectedPages);
          expect(artifact.byteLength, greaterThan(0));
          // ignore: avoid_print
          print(
            'PDF_SIZE_DIAGNOSTIC restaurants=$restaurantCount '
            'labels=$restaurantCount pages=$expectedPages '
            'bytes=${artifact.byteLength}',
          );
        }

        final fullPreflight = await service.preflight(
          _manifest(
            restaurantCount: 400,
            types: AdminRestaurantQrLabelType.values,
          ),
        );
        final fullArtifact = await service.build(fullPreflight);
        expect(fullPreflight.problems, isEmpty);
        expect(fullArtifact.summary.restaurantCount, 400);
        expect(fullArtifact.summary.labelCount, 1600);
        expect(fullArtifact.summary.pageCount, 34);
        expect(fullArtifact.byteLength, greaterThan(0));
        // ignore: avoid_print
        print(
          'PDF_SIZE_DIAGNOSTIC restaurants=400 labels=1600 pages=34 '
          'bytes=${fullArtifact.byteLength}',
        );
      },
      timeout: const Timeout(Duration(minutes: 5)),
    );
  });
}

AdminRestaurantQrArtifactManifest _manifest({
  required int restaurantCount,
  String? restaurantName,
  Iterable<AdminRestaurantQrLabelType> types =
      const <AdminRestaurantQrLabelType>[
        AdminRestaurantQrLabelType.ownerInvite,
      ],
}) => AdminRestaurantQrArtifactManifest(
  selectedRestaurantCount: restaurantCount,
  restaurants: List<AdminRestaurantQrArtifactRestaurant>.generate(
    restaurantCount,
    (index) {
      final restaurantId = 'restaurant-$index';
      return AdminRestaurantQrArtifactRestaurant(
        catalogRestaurantId: restaurantId,
        restaurantName: restaurantName ?? 'Restaurant $index',
        labels: types.map(
          (type) =>
              _label(type: type, restaurantId: restaurantId, index: index),
        ),
      );
    },
    growable: false,
  ),
);

AdminRestaurantQrLabelEntry _label({
  required AdminRestaurantQrLabelType type,
  required String restaurantId,
  required int index,
}) {
  final payloadUrl = switch (type) {
    AdminRestaurantQrLabelType.ownerInvite =>
      'https://go.bitestar.app/invite/coupon/'
          'synthetic-token-$index-abcdefghijklmnopqrstuvwxyz',
    AdminRestaurantQrLabelType.claimInvite =>
      'https://go.bitestar.app/invite/bitescore/'
          'synthetic-token-$index-abcdefghijklmnopqrstuvwxyz',
    AdminRestaurantQrLabelType.biteSaverCustomer => Uri(
      scheme: 'https',
      host: 'go.bitestar.app',
      pathSegments: <String>['r', 'coupons', restaurantId],
    ).toString(),
    AdminRestaurantQrLabelType.biteScoreCustomer => Uri(
      scheme: 'https',
      host: 'go.bitestar.app',
      pathSegments: <String>['r', 'bitescore', restaurantId],
    ).toString(),
  };
  return AdminRestaurantQrLabelEntry(
    type: type,
    payloadUrl: payloadUrl,
    invitationId: type.requiresInvitation ? 'invitation-$index' : null,
    invitationExpiresAtMillis: type.requiresInvitation ? 2000000000000 : null,
  );
}

int _pdfPageObjectCount(String pdfText) =>
    RegExp(r'/Type\s*/Page\b').allMatches(pdfText).length;

int _pdfLetterMediaBoxCount(String pdfText) => RegExp(
  r'/MediaBox\s*\[\s*0\s+0\s+612\s+792\s*\]',
).allMatches(pdfText).length;

Future<void> _writeDiagnosticPdfIfRequested(
  Uint8List bytes, {
  required String environmentKey,
}) async {
  final path = Platform.environment[environmentKey];
  if (path == null || path.isEmpty) return;
  await File(path).writeAsBytes(bytes, flush: true);
}
