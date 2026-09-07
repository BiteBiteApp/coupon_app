import 'dart:async';

import 'package:coupon_app/models/admin_restaurant_mailing_batch.dart';
import 'package:coupon_app/models/admin_restaurant_mailing_pdf.dart';
import 'package:coupon_app/models/admin_restaurant_qr_batch.dart';
import 'package:coupon_app/services/admin_restaurant_mailing_batch_service.dart';
import 'package:coupon_app/services/admin_restaurant_qr_batch_service.dart';
import 'package:coupon_app/services/restaurant_mailing_label_pdf_export.dart';
import 'package:coupon_app/services/restaurant_qr_pdf_export.dart';
import 'package:coupon_app/services/restaurant_qr_pdf_export_lifecycle.dart';
import 'package:coupon_app/services/restaurant_qr_pdf_service.dart';
import 'package:coupon_app/widgets/admin_restaurant_qr_batch_dialog.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
    'prepares automatically, reports progress, and creates no empty PDF',
    (tester) async {
      final ids = List<String>.generate(26, (index) => 'restaurant-$index');
      final preparation = Completer<AdminRestaurantQrPreparationRunResult>();
      AdminRestaurantQrPreparationProgressCallback? progress;
      var preparationCalls = 0;
      var preflightCalls = 0;
      var buildCalls = 0;
      final dependencies = _dependencies(
        preparation: _allProblems(ids),
        prepare: (catalogRestaurantIds, onProgress) {
          preparationCalls += 1;
          expect(catalogRestaurantIds, ids);
          progress = onProgress;
          return preparation.future;
        },
        preflight: (manifest) async {
          preflightCalls += 1;
          return const RestaurantQrPdfService().preflight(manifest);
        },
        buildPdf: (preflight) async {
          buildCalls += 1;
          return _artifact(preflight);
        },
      );

      await _openDialog(tester, ids: ids, dependencies: dependencies);
      await tester.pump();

      expect(preparationCalls, 1);
      expect(find.text('Preparing selected restaurants…'), findsOneWidget);
      progress!(
        const AdminRestaurantQrPreparationProgress(
          confirmedRestaurantCount: 25,
          totalRestaurantCount: 26,
        ),
      );
      await tester.pump();
      expect(find.text('Prepared 25 of 26 restaurants'), findsOneWidget);

      preparation.complete(_allProblems(ids));
      await tester.pumpAndSettle();

      expect(
        find.byKey(const ValueKey('admin-qr-batch-no-valid-labels')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('admin-qr-batch-export-valid')),
        findsNothing,
      );
      expect(preflightCalls, 0);
      expect(buildCalls, 0);
    },
  );

  testWidgets('builds one immutable artifact and shows an accurate summary', (
    tester,
  ) async {
    final preparation = _preparation([
      _readyRestaurant('restaurant-a', 'Café Δelta'),
    ]);
    var preparationCalls = 0;
    var buildCalls = 0;
    final dependencies = _dependencies(
      preparation: preparation,
      prepare: (ids, onProgress) async {
        preparationCalls += 1;
        return preparation;
      },
      buildPdf: (preflight) async {
        buildCalls += 1;
        return _artifact(preflight);
      },
    );

    await _openDialog(
      tester,
      ids: const ['restaurant-a'],
      dependencies: dependencies,
      textScale: 2,
    );
    await tester.pumpAndSettle();

    expect(find.text('PDF ready'), findsOneWidget);
    expect(find.text('Selected restaurants: 1'), findsOneWidget);
    expect(find.text('Ready restaurants: 1'), findsOneWidget);
    expect(find.text('Included labels: 4'), findsOneWidget);
    expect(find.text('Pages: 1'), findsOneWidget);
    expect(find.text('Problems: 0'), findsOneWidget);
    expect(find.text('Print at Actual Size / 100%'), findsOneWidget);
    expect(preparationCalls, 1);
    expect(buildCalls, 1);

    await tester.pump();
    expect(preparationCalls, 1);
    expect(buildCalls, 1);
    expect(tester.takeException(), isNull);
  });

  testWidgets('ordinary close and cancel are one-shot navigation actions', (
    tester,
  ) async {
    final observer = _RouteAccountingObserver();
    final ready = _preparation([_readyRestaurant('restaurant-a', 'Alpha')]);
    final problems = _allProblems(const ['restaurant-a']);
    var preparationCalls = 0;
    final dependencies = _dependencies(
      preparation: ready,
      prepare: (ids, onProgress) async {
        preparationCalls += 1;
        return preparationCalls == 1 ? ready : problems;
      },
    );
    await _openDialogOverAdminRoute(
      tester,
      ids: const ['restaurant-a'],
      dependencies: dependencies,
      observer: observer,
    );
    observer.reset();

    final close = tester.widget<TextButton>(
      find.byKey(const ValueKey('admin-qr-batch-close')),
    );
    close.onPressed!();
    close.onPressed!();
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('admin-qr-batch-dialog')), findsNothing);
    expect(find.byKey(const ValueKey('admin-route')), findsOneWidget);
    expect(find.byKey(const ValueKey('navigation-home')), findsNothing);
    expect(observer.popCount, 1);
    expect(tester.takeException(), isNull);

    await tester.tap(find.byKey(const ValueKey('open-batch-dialog')));
    await tester.pumpAndSettle();
    expect(preparationCalls, 2);
    observer.reset();
    final cancel = tester.widget<TextButton>(
      find.byKey(const ValueKey('admin-qr-batch-cancel')),
    );
    cancel.onPressed!();
    cancel.onPressed!();
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('admin-qr-batch-dialog')), findsNothing);
    expect(find.byKey(const ValueKey('admin-route')), findsOneWidget);
    expect(find.byKey(const ValueKey('navigation-home')), findsNothing);
    expect(observer.popCount, 1);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'first Keep working decision wins and later resolved close pops only batch',
    (tester) async {
      final observer = _RouteAccountingObserver();
      final preparation = _preparation([
        _readyRestaurant('restaurant-a', 'Alpha'),
      ]);
      var markingCalls = 0;
      final dependencies = _dependencies(
        preparation: preparation,
        markPrepared: (worklist, onProgress) async {
          markingCalls += 1;
          return _markingResult(
            worklist,
            failedTypes: markingCalls == 1
                ? const <AdminRestaurantQrLabelType>{
                    AdminRestaurantQrLabelType.ownerInvite,
                  }
                : const <AdminRestaurantQrLabelType>{},
          );
        },
      );
      await _openDialogOverAdminRoute(
        tester,
        ids: const ['restaurant-a'],
        dependencies: dependencies,
        observer: observer,
      );
      await _downloadIntoUnresolvedStatus(tester);
      observer.reset();

      final batchClose = tester
          .widget<TextButton>(
            find.byKey(const ValueKey('admin-qr-batch-close')),
          )
          .onPressed!;
      batchClose();
      batchClose();
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('admin-qr-batch-close-warning')),
        findsOneWidget,
      );
      expect(observer.pushCount, 1);

      final keepWorking = tester
          .widget<TextButton>(
            find.byKey(const ValueKey('admin-qr-batch-keep-working')),
          )
          .onPressed!;
      final closeAnyway = tester
          .widget<FilledButton>(
            find.byKey(const ValueKey('admin-qr-batch-close-anyway')),
          )
          .onPressed!;
      keepWorking();
      keepWorking();
      closeAnyway();
      closeAnyway();
      await tester.pumpAndSettle();

      expect(
        find.byKey(const ValueKey('admin-qr-batch-close-warning')),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('admin-qr-batch-dialog')),
        findsOneWidget,
      );
      expect(observer.popCount, 1, reason: 'Only the confirmation may pop.');

      keepWorking();
      closeAnyway();
      await tester.pump();
      expect(observer.popCount, 1, reason: 'Stale decisions must be inert.');

      await tester.tap(
        find.byKey(const ValueKey('admin-qr-batch-retry-status')),
      );
      await tester.pumpAndSettle();
      expect(find.text('Completed'), findsOneWidget);
      expect(markingCalls, 2);

      final resolvedClose = tester
          .widget<TextButton>(
            find.byKey(const ValueKey('admin-qr-batch-close')),
          )
          .onPressed!;
      resolvedClose();
      resolvedClose();
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('admin-qr-batch-dialog')), findsNothing);
      expect(find.byKey(const ValueKey('admin-route')), findsOneWidget);
      expect(find.byKey(const ValueKey('navigation-home')), findsNothing);
      expect(observer.popCount, 2, reason: 'Confirmation and batch pop once.');

      batchClose();
      resolvedClose();
      keepWorking();
      closeAnyway();
      await tester.pump();
      expect(
        observer.popCount,
        2,
        reason: 'All stale callbacks must be inert.',
      );
      expect(find.byKey(const ValueKey('admin-route')), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'first Close anyway decision wins without popping the Admin route',
    (tester) async {
      final observer = _RouteAccountingObserver();
      final preparation = _preparation([
        _readyRestaurant('restaurant-a', 'Alpha'),
      ]);
      final dependencies = _dependencies(
        preparation: preparation,
        markPrepared: (worklist, onProgress) async => _markingResult(
          worklist,
          failedTypes: const <AdminRestaurantQrLabelType>{
            AdminRestaurantQrLabelType.ownerInvite,
          },
        ),
      );
      await _openDialogOverAdminRoute(
        tester,
        ids: const ['restaurant-a'],
        dependencies: dependencies,
        observer: observer,
      );
      await _downloadIntoUnresolvedStatus(tester);
      observer.reset();

      final batchClose = tester
          .widget<TextButton>(
            find.byKey(const ValueKey('admin-qr-batch-close')),
          )
          .onPressed!;
      batchClose();
      batchClose();
      await tester.pumpAndSettle();
      final keepWorking = tester
          .widget<TextButton>(
            find.byKey(const ValueKey('admin-qr-batch-keep-working')),
          )
          .onPressed!;
      final closeAnyway = tester
          .widget<FilledButton>(
            find.byKey(const ValueKey('admin-qr-batch-close-anyway')),
          )
          .onPressed!;

      closeAnyway();
      closeAnyway();
      keepWorking();
      keepWorking();
      await tester.pumpAndSettle();

      expect(
        find.byKey(const ValueKey('admin-qr-batch-close-warning')),
        findsNothing,
      );
      expect(find.byKey(const ValueKey('admin-qr-batch-dialog')), findsNothing);
      expect(find.byKey(const ValueKey('admin-route')), findsOneWidget);
      expect(find.byKey(const ValueKey('navigation-home')), findsNothing);
      expect(observer.pushCount, 1);
      expect(
        observer.popCount,
        2,
        reason: 'Only the confirmation and batch routes may pop.',
      );

      batchClose();
      keepWorking();
      closeAnyway();
      await tester.pump();
      expect(
        observer.popCount,
        2,
        reason: 'Stale callbacks must not pop Admin.',
      );
      expect(find.byKey(const ValueKey('admin-route')), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('unresolved confirmation guards barrier and back consistently', (
    tester,
  ) async {
    final observer = _RouteAccountingObserver();
    final preparation = _preparation([
      _readyRestaurant('restaurant-a', 'Alpha'),
    ]);
    final dependencies = _dependencies(
      preparation: preparation,
      markPrepared: (worklist, onProgress) async => _markingResult(
        worklist,
        failedTypes: const <AdminRestaurantQrLabelType>{
          AdminRestaurantQrLabelType.ownerInvite,
        },
      ),
    );
    await _openDialogOverAdminRoute(
      tester,
      ids: const ['restaurant-a'],
      dependencies: dependencies,
      observer: observer,
    );
    await _downloadIntoUnresolvedStatus(tester);

    final batchClose = tester
        .widget<TextButton>(find.byKey(const ValueKey('admin-qr-batch-close')))
        .onPressed!;
    batchClose();
    await tester.pumpAndSettle();
    observer.reset();

    await tester.tapAt(const Offset(1, 1));
    await tester.pump();
    expect(
      find.byKey(const ValueKey('admin-qr-batch-close-warning')),
      findsOneWidget,
    );
    expect(observer.popCount, 0, reason: 'The barrier is not dismissible.');

    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey('admin-qr-batch-close-warning')),
      findsNothing,
    );
    expect(find.byKey(const ValueKey('admin-qr-batch-dialog')), findsOneWidget);
    expect(observer.popCount, 1, reason: 'Back means Keep working once.');

    batchClose();
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey('admin-qr-batch-close-warning')),
      findsOneWidget,
      reason: 'The outer close lock must be released after guarded back.',
    );
    await tester.tap(find.byKey(const ValueKey('admin-qr-batch-close-anyway')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('admin-route')), findsOneWidget);
    expect(find.byKey(const ValueKey('navigation-home')), findsNothing);
    expect(observer.popCount, 3);
    expect(tester.takeException(), isNull);
  });

  testWidgets('dialog remains usable across required viewport classes', (
    tester,
  ) async {
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    tester.view.devicePixelRatio = 1;
    final preparation = _preparation([
      _readyRestaurant('restaurant-a', 'Café Δelta'),
    ]);

    for (final size in const <Size>[
      Size(320, 568),
      Size(568, 320),
      Size(1024, 768),
      Size(1440, 900),
    ]) {
      tester.view.physicalSize = size;
      await _openDialog(
        tester,
        ids: const ['restaurant-a'],
        dependencies: _dependenciesWithMailing(
          qrPreparation: preparation,
          mailingPreparation: _mailingPreparation(
            <AdminRestaurantMailingResult>[
              _mailingReady('restaurant-a', 'Café Delta'),
            ],
          ),
        ),
        textScale: size.width == 320 ? 2 : 1,
      );
      await tester.pumpAndSettle();
      expect(find.text('PDF ready'), findsOneWidget, reason: '$size');
      expect(
        find.byKey(const ValueKey('admin-qr-batch-download')),
        findsOneWidget,
        reason: '$size',
      );
      expect(
        find.byKey(const ValueKey('admin-mailing-batch-download')),
        findsOneWidget,
        reason: '$size',
      );
      expect(tester.takeException(), isNull, reason: '$size');
      await tester.tap(find.byKey(const ValueKey('admin-qr-batch-close')));
      await tester.pumpAndSettle();
    }
  });

  testWidgets(
    'shows every problem and builds only after explicit valid-only approval',
    (tester) async {
      final denseId = 'dense-${List<String>.filled(600, 'x').join()}';
      final preparation = _preparation([
        _readyRestaurant('restaurant-a', 'Alpha'),
        _readyRestaurant(denseId, 'Dense Route'),
        AdminRestaurantQrProblemRestaurant(
          catalogRestaurantId: 'restaurant-c',
          outcome: AdminRestaurantQrProblemOutcome.failed,
          code: 'preparation_failed',
          message: 'Label preparation failed for this restaurant.',
        ),
      ]);
      var buildCalls = 0;
      final dependencies = _dependencies(
        preparation: preparation,
        buildPdf: (preflight) async {
          buildCalls += 1;
          return _artifact(preflight);
        },
      );

      await _openDialog(
        tester,
        ids: ['restaurant-a', denseId, 'restaurant-c'],
        dependencies: dependencies,
      );
      await tester.pumpAndSettle();

      expect(find.textContaining('Review all 3'), findsOneWidget);
      expect(
        find.byKey(
          const ValueKey('admin-qr-batch-preparation-problem-restaurant-c'),
        ),
        findsOneWidget,
      );
      expect(
        find.byKey(ValueKey('admin-qr-batch-pdf-problem-$denseId-SA')),
        findsOneWidget,
      );
      expect(
        find.byKey(ValueKey('admin-qr-batch-pdf-problem-$denseId-SR')),
        findsOneWidget,
      );
      expect(find.textContaining('/r/coupons/'), findsNothing);
      expect(buildCalls, 0);
      expect(find.text('PDF ready'), findsNothing);
      expect(
        find.byKey(const ValueKey('admin-qr-batch-export-valid')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('admin-qr-batch-cancel')),
        findsOneWidget,
      );

      await tester.tap(
        find.byKey(const ValueKey('admin-qr-batch-export-valid')),
      );
      await tester.pumpAndSettle();

      expect(buildCalls, 1);
      expect(find.text('PDF ready'), findsOneWidget);
      expect(find.text('Selected restaurants: 3'), findsOneWidget);
      expect(find.text('Ready restaurants: 2'), findsOneWidget);
      expect(find.text('Included labels: 6'), findsOneWidget);
      expect(find.text('Problems: 3'), findsOneWidget);
    },
  );

  testWidgets(
    'failed download retains artifact, skips marking, and re-download marks',
    (tester) async {
      final preparation = _preparation([
        _readyRestaurant('restaurant-a', 'Alpha'),
      ]);
      var preparationCalls = 0;
      var buildCalls = 0;
      var downloadCalls = 0;
      var markingCalls = 0;
      final downloadedBytes = <List<int>>[];
      final reconciliations = <AdminRestaurantQrBatchReconciliation>[];
      final dependencies = _dependencies(
        preparation: preparation,
        prepare: (ids, onProgress) async {
          preparationCalls += 1;
          return preparation;
        },
        buildPdf: (preflight) async {
          buildCalls += 1;
          return _artifact(preflight);
        },
        downloadPdf: (bytes, filename) async {
          downloadCalls += 1;
          downloadedBytes.add(List<int>.of(bytes));
          if (downloadCalls == 1) {
            return const RestaurantQrPdfExportResult.failed(
              failure: RestaurantQrPdfExportFailure.initiationFailed,
              message: 'Could not initiate the PDF download.',
            );
          }
          return const RestaurantQrPdfExportResult.initiated();
        },
        markPrepared: (worklist, onProgress) async {
          markingCalls += 1;
          return _markingResult(worklist);
        },
      );

      await _openDialog(
        tester,
        ids: const ['restaurant-a'],
        dependencies: dependencies,
        onReconciled: (value) {
          reconciliations.add(value);
          if (reconciliations.length == 1) {
            throw StateError('Synthetic screen reconciliation failure.');
          }
        },
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const ValueKey('admin-qr-batch-download')));
      await tester.pumpAndSettle();
      expect(markingCalls, 0);
      expect(find.text('Could not initiate the PDF download.'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('admin-qr-batch-download')),
        findsOneWidget,
      );

      await tester.tap(find.byKey(const ValueKey('admin-qr-batch-download')));
      await tester.pumpAndSettle();
      expect(markingCalls, 1);
      expect(find.text('PDF download initiated.'), findsOneWidget);
      expect(find.text('Completed'), findsOneWidget);
      expect(reconciliations, hasLength(1));
      expect(reconciliations.single.resolvedCatalogRestaurantIds, {
        'restaurant-a',
      });

      await tester.tap(find.byKey(const ValueKey('admin-qr-batch-download')));
      await tester.pumpAndSettle();
      expect(markingCalls, 2, reason: 'Re-download marks idempotently.');
      expect(downloadedBytes, hasLength(3));
      expect(listEquals(downloadedBytes[0], downloadedBytes[1]), isTrue);
      expect(listEquals(downloadedBytes[1], downloadedBytes[2]), isTrue);
      expect(preparationCalls, 1);
      expect(buildCalls, 1);
    },
  );

  testWidgets(
    'cleanup-only download errors still mark once without rebuilding',
    (tester) async {
      final preparation = _preparation([
        _readyRestaurant('restaurant-a', 'Alpha'),
      ]);
      var preparationCalls = 0;
      var buildCalls = 0;
      var adapterCalls = 0;
      var markingCalls = 0;
      final lifecycleEvents = <String>[];
      final exporter = RestaurantQrPdfExporter(
        capabilities: const RestaurantQrPdfExportCapabilities(
          canDownloadPdf: true,
        ),
        downloadPdf: (bytes, filename) async {
          adapterCalls += 1;
          await runRestaurantQrPdfDownloadLifecycle<Object>(
            bytes: bytes,
            filename: filename,
            mimeType: RestaurantQrPdfExporter.pdfMimeType,
            createObjectUrl: (_, mimeType) {
              expect(mimeType, 'application/pdf');
              lifecycleEvents.add('create-object-url');
              return 'blob:synthetic-pdf';
            },
            createAnchor: (_, _) {
              lifecycleEvents.add('create-anchor');
              return Object();
            },
            appendAnchor: (_) => lifecycleEvents.add('append-anchor'),
            clickAnchor: (_) => lifecycleEvents.add('click-anchor'),
            waitForInitiationTurn: () async {
              lifecycleEvents.add('wait-event-turn');
            },
            removeAnchor: (_) {
              lifecycleEvents.add('remove-anchor');
              throw StateError('Synthetic removal failure.');
            },
            revokeObjectUrl: (_) {
              lifecycleEvents.add('revoke-object-url');
              throw StateError('Synthetic revocation failure.');
            },
          );
        },
      );
      final dependencies = _dependencies(
        preparation: preparation,
        prepare: (ids, onProgress) async {
          preparationCalls += 1;
          return preparation;
        },
        buildPdf: (preflight) async {
          buildCalls += 1;
          return _artifact(preflight);
        },
        downloadPdf: exporter.downloadPdf,
        markPrepared: (worklist, onProgress) async {
          markingCalls += 1;
          return _markingResult(worklist);
        },
      );

      await _openDialog(
        tester,
        ids: const ['restaurant-a'],
        dependencies: dependencies,
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('admin-qr-batch-download')));
      await tester.pumpAndSettle();

      expect(find.text('PDF download initiated.'), findsOneWidget);
      expect(find.text('Completed'), findsOneWidget);
      expect(find.text('Could not initiate the PDF download.'), findsNothing);
      expect(preparationCalls, 1);
      expect(buildCalls, 1);
      expect(adapterCalls, 1);
      expect(markingCalls, 1);
      expect(lifecycleEvents, <String>[
        'create-object-url',
        'create-anchor',
        'append-anchor',
        'click-anchor',
        'wait-event-turn',
        'remove-anchor',
        'revoke-object-url',
      ]);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'partial marking retries only unresolved identities and warns before close',
    (tester) async {
      final preparation = _preparation([
        _readyRestaurant('restaurant-a', 'Alpha'),
        AdminRestaurantQrProblemRestaurant(
          catalogRestaurantId: 'restaurant-b',
          outcome: AdminRestaurantQrProblemOutcome.unavailable,
          code: 'restaurant_inactive',
          message: 'This restaurant is not currently eligible.',
        ),
      ]);
      var preparationCalls = 0;
      var buildCalls = 0;
      final markingWorklists = <AdminRestaurantQrMarkingWorklist>[];
      final reconciliations = <AdminRestaurantQrBatchReconciliation>[];
      final dependencies = _dependencies(
        preparation: preparation,
        prepare: (ids, onProgress) async {
          preparationCalls += 1;
          return preparation;
        },
        buildPdf: (preflight) async {
          buildCalls += 1;
          return _artifact(preflight);
        },
        markPrepared: (worklist, onProgress) async {
          markingWorklists.add(worklist);
          if (markingWorklists.length == 1) {
            return _markingResult(
              worklist,
              failedTypes: const {AdminRestaurantQrLabelType.ownerInvite},
            );
          }
          return _markingResult(worklist);
        },
      );

      await _openDialog(
        tester,
        ids: const ['restaurant-a', 'restaurant-b'],
        dependencies: dependencies,
        onReconciled: reconciliations.add,
      );
      await tester.pumpAndSettle();
      await tester.tap(
        find.byKey(const ValueKey('admin-qr-batch-export-valid')),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('admin-qr-batch-download')));
      await tester.pumpAndSettle();

      expect(find.text('Status saving incomplete'), findsOneWidget);
      expect(
        find.text(
          'Status results: 1 saved, 1 already saved, 1 not required, '
          '1 unresolved.',
        ),
        findsOneWidget,
      );
      expect(markingWorklists, hasLength(1));
      expect(markingWorklists.single.labelCount, 4);
      expect(reconciliations, hasLength(1));
      expect(reconciliations.single.unresolvedCatalogRestaurantIds, {
        'restaurant-a',
      });
      expect(reconciliations.single.problemCatalogRestaurantIds, {
        'restaurant-b',
      });
      expect(reconciliations.single.resolvedCatalogRestaurantIds, isEmpty);
      expect(
        find.byKey(const ValueKey('admin-qr-batch-unresolved-restaurant-a-I')),
        findsOneWidget,
      );
      expect(
        find.textContaining('Preparation status could not be confirmed.'),
        findsOneWidget,
      );
      expect(find.textContaining('synthetic-owner-token'), findsNothing);

      final closeButton = tester.widget<TextButton>(
        find.byKey(const ValueKey('admin-qr-batch-close')),
      );
      closeButton.onPressed!();
      closeButton.onPressed!();
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('admin-qr-batch-close-warning')),
        findsOneWidget,
      );
      await tester.tap(
        find.byKey(const ValueKey('admin-qr-batch-keep-working')),
      );
      await tester.pumpAndSettle();

      await tester.tap(
        find.byKey(const ValueKey('admin-qr-batch-retry-status')),
      );
      await tester.pumpAndSettle();

      expect(markingWorklists, hasLength(2));
      final retry = markingWorklists.last;
      expect(retry.restaurantCount, 1);
      expect(retry.labelCount, 1);
      expect(
        retry.restaurants.single.labels.single.type,
        AdminRestaurantQrLabelType.ownerInvite,
      );
      expect(
        retry.restaurants.single.labels.single.invitationId,
        'synthetic-owner-invitation',
      );
      expect(reconciliations, hasLength(2));
      expect(reconciliations.last.resolvedCatalogRestaurantIds, {
        'restaurant-a',
      });
      expect(reconciliations.last.unresolvedCatalogRestaurantIds, isEmpty);
      expect(reconciliations.last.problemCatalogRestaurantIds, {
        'restaurant-b',
      });
      expect(find.text('Completed'), findsOneWidget);
      expect(
        find.text(
          'Status results: 2 saved, 1 already saved, 1 not required, '
          '0 unresolved.',
        ),
        findsOneWidget,
      );
      expect(preparationCalls, 1);
      expect(buildCalls, 1);
    },
  );

  testWidgets(
    'marking transport failure lists every unresolved identity safely',
    (tester) async {
      final preparation = _preparation([
        _readyRestaurant('restaurant-a', 'Alpha'),
      ]);
      final dependencies = _dependencies(
        preparation: preparation,
        markPrepared: (worklist, onProgress) async {
          throw StateError(
            'https://go.bitestar.app/invite/coupon/synthetic-secret-token',
          );
        },
      );

      await _openDialog(
        tester,
        ids: const ['restaurant-a'],
        dependencies: dependencies,
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('admin-qr-batch-download')));
      await tester.pumpAndSettle();

      expect(find.text('Status saving incomplete'), findsOneWidget);
      for (final type in AdminRestaurantQrLabelType.values) {
        expect(
          find.byKey(
            ValueKey<String>(
              'admin-qr-batch-unresolved-restaurant-a-${type.wireName}',
            ),
          ),
          findsOneWidget,
        );
      }
      expect(
        find.textContaining('Preparation status could not be confirmed.'),
        findsNWidgets(5),
      );
      expect(find.textContaining('synthetic-secret-token'), findsNothing);
      expect(
        find.byKey(const ValueKey('admin-qr-batch-retry-status')),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'an interrupted preparation retries only unconfirmed IDs explicitly',
    (tester) async {
      final interrupted = AdminRestaurantQrPreparationRunResult(
        requestedCatalogRestaurantIds: const ['restaurant-a', 'restaurant-b'],
        results: [
          _readyRestaurant('restaurant-a', 'Alpha'),
          AdminRestaurantQrProblemRestaurant(
            catalogRestaurantId: 'restaurant-b',
            outcome: AdminRestaurantQrProblemOutcome.failed,
            code: 'preparation_unavailable',
            message: 'Label preparation could not be confirmed.',
          ),
        ],
        interruption: AdminRestaurantQrPreparationInterruption(
          code: 'preparation_unavailable',
          message: 'Label preparation could not be confirmed.',
          catalogRestaurantIds: const ['restaurant-b'],
        ),
      );
      var preparationCalls = 0;
      var retryCalls = 0;
      final dependencies = _dependencies(
        preparation: interrupted,
        prepare: (ids, onProgress) async {
          preparationCalls += 1;
          return interrupted;
        },
        retryPreparation: (previous, onProgress) async {
          retryCalls += 1;
          expect(previous.retryCatalogRestaurantIds, ['restaurant-b']);
          expect(
            previous.readyRestaurants.single.labels.first.invitationId,
            'synthetic-owner-invitation',
          );
          return previous.mergeExplicitRetry(
            _preparation([_readyRestaurant('restaurant-b', 'Beta')]),
          );
        },
      );

      await _openDialog(
        tester,
        ids: const ['restaurant-a', 'restaurant-b'],
        dependencies: dependencies,
      );
      await tester.pumpAndSettle();

      expect(preparationCalls, 1);
      expect(retryCalls, 0);
      expect(
        find.byKey(const ValueKey('admin-qr-batch-preparation-retry-warning')),
        findsOneWidget,
      );
      await tester.pump(const Duration(minutes: 1));
      expect(
        retryCalls,
        0,
        reason: 'Preparation must never retry automatically.',
      );

      await tester.tap(
        find.byKey(const ValueKey('admin-qr-batch-retry-preparation')),
      );
      await tester.pumpAndSettle();
      expect(preparationCalls, 1);
      expect(retryCalls, 1);
      expect(find.text('PDF ready'), findsOneWidget);
      expect(find.text('Selected restaurants: 2'), findsOneWidget);
      expect(find.text('Ready restaurants: 2'), findsOneWidget);
    },
  );

  testWidgets('operation lock prevents double download and disposal is safe', (
    tester,
  ) async {
    final preparation = _preparation([
      _readyRestaurant('restaurant-a', 'Alpha'),
    ]);
    final download = Completer<RestaurantQrPdfExportResult>();
    var downloadCalls = 0;
    var markingCalls = 0;
    final dependencies = _dependencies(
      preparation: preparation,
      downloadPdf: (bytes, filename) {
        downloadCalls += 1;
        return download.future;
      },
      markPrepared: (worklist, onProgress) async {
        markingCalls += 1;
        return _markingResult(worklist);
      },
    );

    await _openDialog(
      tester,
      ids: const ['restaurant-a'],
      dependencies: dependencies,
    );
    await tester.pumpAndSettle();
    final downloadButton = tester.widget<FilledButton>(
      find.byKey(const ValueKey('admin-qr-batch-download')),
    );
    downloadButton.onPressed!();
    downloadButton.onPressed!();
    await tester.pump();
    expect(downloadCalls, 1);

    await tester.pumpWidget(const SizedBox.shrink());
    download.complete(const RestaurantQrPdfExportResult.initiated());
    await tester.pump();
    expect(markingCalls, 0);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'late mailing download completion after route disposal has no side effects',
    (tester) async {
      const ids = <String>['restaurant-a'];
      final qrPreparation = _preparation(<AdminRestaurantQrRestaurantResult>[
        _readyRestaurant('restaurant-a', 'Alpha'),
      ]);
      final mailingPreparation = _mailingPreparation(
        <AdminRestaurantMailingResult>[_mailingReady('restaurant-a', 'Alpha')],
      );
      final mailingDownload =
          Completer<RestaurantMailingLabelPdfExportResult>();
      final downloadedMailingBytes = <Uint8List>[];
      final observer = _RouteAccountingObserver();
      AdminRestaurantMailingPdfArtifact? builtMailingArtifact;
      var qrPreparationCalls = 0;
      var qrBuildCalls = 0;
      var mailingPreparationCalls = 0;
      var mailingRetryCalls = 0;
      var mailingPreflightCalls = 0;
      var mailingBuildCalls = 0;
      var mailingDownloadCalls = 0;
      var markingCalls = 0;
      final dependencies = _dependenciesWithMailing(
        qrPreparation: qrPreparation,
        mailingPreparation: mailingPreparation,
        prepare: (value, _) async {
          qrPreparationCalls += 1;
          expect(value, ids);
          return qrPreparation;
        },
        buildPdf: (preflight) async {
          qrBuildCalls += 1;
          return _artifact(preflight);
        },
        markPrepared: (worklist, _) async {
          markingCalls += 1;
          return _markingResult(worklist);
        },
        prepareMailing: (value, _) async {
          mailingPreparationCalls += 1;
          expect(value, ids);
          return mailingPreparation;
        },
        retryMailing: (previous, _) async {
          mailingRetryCalls += 1;
          return previous;
        },
        preflightMailing: (manifest, problems) async {
          mailingPreflightCalls += 1;
          return _mailingPreflight(manifest, problems: problems);
        },
        buildMailingPdf: (preflight, approved) async {
          mailingBuildCalls += 1;
          expect(approved, isFalse);
          final artifact = _mailingArtifact(preflight);
          builtMailingArtifact = artifact;
          return artifact;
        },
        downloadMailingPdf: (bytes, filename) {
          mailingDownloadCalls += 1;
          downloadedMailingBytes.add(Uint8List.fromList(bytes));
          expect(filename, 'bitestar-mailing-labels-20260907-101112.pdf');
          expect(
            listEquals(bytes, builtMailingArtifact!.bytes),
            isTrue,
            reason: 'The in-flight download must own the built artifact bytes.',
          );
          return mailingDownload.future;
        },
      );

      await _openDialogOverAdminRoute(
        tester,
        ids: ids,
        dependencies: dependencies,
        observer: observer,
      );

      expect(find.text('Mailing-label PDF ready'), findsOneWidget);
      expect(builtMailingArtifact, isNotNull);
      expect(qrPreparationCalls, 1);
      expect(qrBuildCalls, 1);
      expect(mailingPreparationCalls, 1);
      expect(mailingPreflightCalls, 1);
      expect(mailingBuildCalls, 1);
      expect(mailingRetryCalls, 0);
      expect(markingCalls, 0);

      final mailingButton = tester.widget<FilledButton>(
        find.byKey(const ValueKey('admin-mailing-batch-download')),
      );
      mailingButton.onPressed!();
      mailingButton.onPressed!();
      await tester.pump();

      expect(mailingDownloadCalls, 1);
      expect(downloadedMailingBytes, hasLength(1));
      expect(mailingDownload.isCompleted, isFalse);
      expect(find.text('Downloading mailing-label PDF…'), findsOneWidget);

      observer.reset();
      final dialogContext = tester.element(
        find.byKey(const ValueKey('admin-qr-batch-dialog')),
      );
      final dialogRoute = ModalRoute.of(dialogContext)!;
      Navigator.of(dialogContext).removeRoute(dialogRoute);
      await tester.pumpAndSettle();

      expect(mailingDownload.isCompleted, isFalse);
      expect(find.byKey(const ValueKey('admin-qr-batch-dialog')), findsNothing);
      expect(find.byKey(const ValueKey('admin-route')), findsOneWidget);
      expect(find.byKey(const ValueKey('navigation-home')), findsNothing);
      expect(observer.pushCount, 0);
      expect(observer.popCount, 0);
      expect(observer.removeCount, 1);
      expect(tester.takeException(), isNull);

      mailingDownload.complete(
        const RestaurantMailingLabelPdfExportResult.initiated(),
      );
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      expect(find.byType(SnackBar), findsNothing);
      expect(
        find.byKey(const ValueKey('admin-qr-batch-close-warning')),
        findsNothing,
      );
      expect(find.byKey(const ValueKey('admin-qr-batch-dialog')), findsNothing);
      expect(find.byKey(const ValueKey('admin-route')), findsOneWidget);
      expect(find.byKey(const ValueKey('navigation-home')), findsNothing);
      expect(observer.pushCount, 0);
      expect(observer.popCount, 0);
      expect(observer.removeCount, 1);
      expect(qrPreparationCalls, 1);
      expect(qrBuildCalls, 1);
      expect(mailingPreparationCalls, 1);
      expect(mailingRetryCalls, 0);
      expect(mailingPreflightCalls, 1);
      expect(mailingBuildCalls, 1);
      expect(mailingDownloadCalls, 1);
      expect(markingCalls, 0);
    },
  );

  testWidgets(
    'one frozen worklist builds independent artifacts and mailing never marks',
    (tester) async {
      final ids = <String>['restaurant-b', 'restaurant-a'];
      final qrPreparation = _preparation(<AdminRestaurantQrRestaurantResult>[
        _readyRestaurant('restaurant-b', 'Beta'),
        _readyRestaurant('restaurant-a', 'Alpha'),
      ]);
      final mailingPreparation = _mailingPreparation(
        <AdminRestaurantMailingResult>[
          _mailingReady('restaurant-b', 'Beta'),
          _mailingReady('restaurant-a', 'Alpha'),
        ],
      );
      final download = Completer<RestaurantMailingLabelPdfExportResult>();
      final mailingRequests = <List<String>>[];
      final downloadedBytes = <Uint8List>[];
      var qrPrepareCalls = 0;
      var mailingBuildCalls = 0;
      var mailingDownloadCalls = 0;
      var markingCalls = 0;
      final dependencies = _dependenciesWithMailing(
        qrPreparation: qrPreparation,
        mailingPreparation: mailingPreparation,
        prepare: (value, _) async {
          qrPrepareCalls += 1;
          expect(value, ids);
          return qrPreparation;
        },
        prepareMailing: (value, _) async {
          mailingRequests.add(List<String>.of(value));
          return mailingPreparation;
        },
        buildMailingPdf: (preflight, approved) async {
          mailingBuildCalls += 1;
          expect(approved, isFalse);
          return _mailingArtifact(preflight);
        },
        downloadMailingPdf: (bytes, filename) {
          mailingDownloadCalls += 1;
          downloadedBytes.add(Uint8List.fromList(bytes));
          expect(filename, 'bitestar-mailing-labels-20260907-101112.pdf');
          return download.future;
        },
        markPrepared: (worklist, _) async {
          markingCalls += 1;
          return _markingResult(worklist);
        },
      );

      await _openDialog(tester, ids: ids, dependencies: dependencies);
      await tester.pumpAndSettle();

      expect(find.text('Generate QR & Mailing Label PDFs'), findsOneWidget);
      expect(find.text('QR Labels'), findsOneWidget);
      expect(find.text('Mailing Labels'), findsOneWidget);
      expect(find.text('PDF ready'), findsOneWidget);
      expect(find.text('Mailing-label PDF ready'), findsOneWidget);
      expect(mailingRequests, <List<String>>[ids]);
      expect(qrPrepareCalls, 1);
      expect(mailingBuildCalls, 1);

      final mailingButton = tester.widget<FilledButton>(
        find.byKey(const ValueKey('admin-mailing-batch-download')),
      );
      mailingButton.onPressed!();
      mailingButton.onPressed!();
      await tester.pump();
      expect(mailingDownloadCalls, 1);
      expect(markingCalls, 0);

      download.complete(
        const RestaurantMailingLabelPdfExportResult.initiated(),
      );
      await tester.pumpAndSettle();
      expect(
        find.text('Mailing-label PDF download initiated.'),
        findsOneWidget,
      );
      expect(markingCalls, 0);

      await _tapVisible(tester, const ValueKey('admin-mailing-batch-download'));
      await tester.pumpAndSettle();
      expect(mailingDownloadCalls, 2);
      expect(listEquals(downloadedBytes[0], downloadedBytes[1]), isTrue);
      expect(mailingBuildCalls, 1);
      expect(qrPrepareCalls, 1);
      expect(markingCalls, 0);

      await tester.tap(find.byKey(const ValueKey('admin-qr-batch-download')));
      await tester.pumpAndSettle();
      expect(markingCalls, 1);
      expect(mailingBuildCalls, 1);
    },
  );

  testWidgets(
    'QR-invalid restaurants are excluded and approvals remain separate',
    (tester) async {
      final qrPreparation = _preparation(<AdminRestaurantQrRestaurantResult>[
        _partiallyQrValidRestaurant('restaurant-a', 'Alpha'),
        AdminRestaurantQrProblemRestaurant(
          catalogRestaurantId: 'restaurant-b',
          outcome: AdminRestaurantQrProblemOutcome.unavailable,
          code: 'restaurant_unavailable',
          message: 'This restaurant is not currently available.',
        ),
      ]);
      final mailingPreparation = _mailingPreparation(
        <AdminRestaurantMailingResult>[
          _mailingReady('restaurant-a', 'Alpha'),
          _mailingReady('restaurant-b', 'Beta'),
        ],
      );
      List<String>? preflightIds;
      List<AdminRestaurantMailingPdfProblem>? correlatedProblems;
      var qrBuildCalls = 0;
      var mailingBuildCalls = 0;
      final dependencies = _dependenciesWithMailing(
        qrPreparation: qrPreparation,
        mailingPreparation: mailingPreparation,
        buildPdf: (preflight) async {
          qrBuildCalls += 1;
          return _artifact(preflight);
        },
        preflightMailing: (manifest, problems) async {
          preflightIds = manifest.entries
              .map((entry) => entry.catalogRestaurantId)
              .toList();
          correlatedProblems = List<AdminRestaurantMailingPdfProblem>.of(
            problems,
          );
          return _mailingPreflight(manifest, problems: problems);
        },
        buildMailingPdf: (preflight, approved) async {
          mailingBuildCalls += 1;
          expect(approved, isTrue);
          return _mailingArtifact(preflight);
        },
      );

      await _openDialog(
        tester,
        ids: const <String>['restaurant-a', 'restaurant-b'],
        dependencies: dependencies,
      );
      await tester.pumpAndSettle();

      expect(
        find.text('Waiting for the QR-valid restaurant set…'),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('admin-qr-batch-export-valid')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('admin-mailing-batch-export-valid')),
        findsNothing,
      );
      expect(qrBuildCalls, 0);
      expect(mailingBuildCalls, 0);

      await tester.tap(
        find.byKey(const ValueKey('admin-qr-batch-export-valid')),
      );
      await tester.pumpAndSettle();

      expect(qrBuildCalls, 1);
      expect(preflightIds, <String>['restaurant-a']);
      expect(correlatedProblems, hasLength(1));
      expect(
        correlatedProblems!.single.code,
        AdminRestaurantMailingPdfProblemCode.excludedNoQrValidArtifact,
      );
      expect(correlatedProblems!.single.catalogRestaurantId, 'restaurant-b');
      expect(
        find.byKey(const ValueKey('admin-mailing-batch-export-valid')),
        findsOneWidget,
      );
      expect(mailingBuildCalls, 0);

      await _tapVisible(
        tester,
        const ValueKey('admin-mailing-batch-export-valid'),
      );
      await tester.pumpAndSettle();
      expect(mailingBuildCalls, 1);
      expect(find.text('Included mailing labels: 1'), findsOneWidget);
      expect(find.text('Mailing problems: 1'), findsOneWidget);
    },
  );

  testWidgets(
    'mailing-invalid restaurant remains in QR PDF and mailing retry uses suffix',
    (tester) async {
      final qrPreparation = _preparation(<AdminRestaurantQrRestaurantResult>[
        _readyRestaurant('restaurant-a', 'Alpha'),
        _readyRestaurant('restaurant-b', 'Beta'),
      ]);
      final interrupted = AdminRestaurantMailingBatchRunResult(
        requestedCatalogRestaurantIds: const <String>[
          'restaurant-a',
          'restaurant-b',
        ],
        confirmedResults: <AdminRestaurantMailingResult>[
          _mailingReady('restaurant-a', 'Alpha'),
        ],
        interruption: AdminRestaurantMailingInterruption(
          kind: AdminRestaurantMailingInterruptionKind.unavailable,
          message: 'Restaurant mailing data could not be confirmed.',
          catalogRestaurantIds: const <String>['restaurant-b'],
        ),
      );
      var retryCalls = 0;
      var mailingBuildCalls = 0;
      final dependencies = _dependenciesWithMailing(
        qrPreparation: qrPreparation,
        mailingPreparation: interrupted,
        retryMailing: (previous, progress) async {
          retryCalls += 1;
          expect(previous.confirmedResults, hasLength(1));
          expect(previous.unconfirmedCatalogRestaurantIds, <String>[
            'restaurant-b',
          ]);
          progress(
            const AdminRestaurantMailingProgress(
              confirmedRestaurantCount: 2,
              totalRestaurantCount: 2,
            ),
          );
          return previous.mergeExplicitRetry(
            _mailingPreparation(<AdminRestaurantMailingResult>[
              AdminRestaurantMailingProblem(
                catalogRestaurantId: 'restaurant-b',
                outcome: AdminRestaurantMailingProblemOutcome.unavailable,
                restaurantName: 'Beta',
                code: AdminRestaurantMailingProblemCode.invalidZip,
                message: 'A valid mailing ZIP code is unavailable.',
              ),
            ]),
          );
        },
        buildMailingPdf: (preflight, approved) async {
          mailingBuildCalls += 1;
          expect(approved, isTrue);
          return _mailingArtifact(preflight);
        },
      );

      await _openDialog(
        tester,
        ids: const <String>['restaurant-a', 'restaurant-b'],
        dependencies: dependencies,
      );
      await tester.pumpAndSettle();

      expect(find.text('PDF ready'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('admin-mailing-batch-unconfirmed-suffix')),
        findsOneWidget,
      );
      expect(
        find.textContaining('1 restaurant remains unconfirmed'),
        findsOneWidget,
      );
      expect(retryCalls, 0);

      await _tapVisible(
        tester,
        const ValueKey('admin-mailing-batch-retry-preparation'),
      );
      await tester.pumpAndSettle();

      expect(retryCalls, 1);
      expect(
        find.byKey(
          const ValueKey(
            'admin-mailing-batch-problem-restaurant-b-authoritative_mailing_data',
          ),
        ),
        findsOneWidget,
      );
      expect(find.text('Included labels: 8'), findsOneWidget);
      expect(mailingBuildCalls, 0);

      await _tapVisible(
        tester,
        const ValueKey('admin-mailing-batch-export-valid'),
      );
      await tester.pumpAndSettle();
      expect(mailingBuildCalls, 1);
      expect(find.text('Included mailing labels: 1'), findsOneWidget);
    },
  );

  testWidgets('QR and mailing download failures stay independent', (
    tester,
  ) async {
    final qrPreparation = _preparation(<AdminRestaurantQrRestaurantResult>[
      _readyRestaurant('restaurant-a', 'Alpha'),
    ]);
    final mailingPreparation = _mailingPreparation(
      <AdminRestaurantMailingResult>[_mailingReady('restaurant-a', 'Alpha')],
    );
    var qrDownloads = 0;
    var mailingDownloads = 0;
    var markingCalls = 0;
    final dependencies = _dependenciesWithMailing(
      qrPreparation: qrPreparation,
      mailingPreparation: mailingPreparation,
      downloadPdf: (bytes, filename) async {
        qrDownloads += 1;
        if (qrDownloads == 1) {
          return const RestaurantQrPdfExportResult.failed(
            failure: RestaurantQrPdfExportFailure.initiationFailed,
            message: 'Could not initiate the PDF download.',
          );
        }
        return const RestaurantQrPdfExportResult.initiated();
      },
      downloadMailingPdf: (bytes, filename) async {
        mailingDownloads += 1;
        if (mailingDownloads == 1) {
          return const RestaurantMailingLabelPdfExportResult.failed(
            failure: RestaurantMailingLabelPdfExportFailure.initiationFailed,
            message: 'Could not initiate the mailing-label PDF download.',
          );
        }
        return const RestaurantMailingLabelPdfExportResult.initiated();
      },
      markPrepared: (worklist, progress) async {
        markingCalls += 1;
        return _markingResult(worklist);
      },
    );

    await _openDialog(
      tester,
      ids: const <String>['restaurant-a'],
      dependencies: dependencies,
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('admin-qr-batch-download')));
    await tester.pumpAndSettle();
    expect(qrDownloads, 1);
    expect(markingCalls, 0);
    expect(find.text('Could not initiate the PDF download.'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('admin-mailing-batch-download')),
      findsOneWidget,
    );

    await _tapVisible(tester, const ValueKey('admin-mailing-batch-download'));
    expect(mailingDownloads, 1);
    expect(markingCalls, 0);
    expect(
      find.text('Could not initiate the mailing-label PDF download.'),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('admin-qr-batch-download')),
      findsOneWidget,
    );

    await _tapVisible(tester, const ValueKey('admin-mailing-batch-download'));
    expect(mailingDownloads, 2);
    expect(markingCalls, 0);
    expect(find.text('Mailing-label PDF download initiated.'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('admin-qr-batch-download')));
    await tester.pumpAndSettle();
    expect(qrDownloads, 2);
    expect(markingCalls, 1);
    expect(
      find.byKey(const ValueKey('admin-mailing-batch-download')),
      findsOneWidget,
    );
  });

  testWidgets('all QR-invalid produces no empty mailing PDF', (tester) async {
    final ids = const <String>['restaurant-a', 'restaurant-b'];
    final dependencies = _dependenciesWithMailing(
      qrPreparation: _allProblems(ids),
      mailingPreparation: _mailingPreparation(<AdminRestaurantMailingResult>[
        _mailingReady('restaurant-a', 'Alpha'),
        _mailingReady('restaurant-b', 'Beta'),
      ]),
    );

    await _openDialog(tester, ids: ids, dependencies: dependencies);
    await tester.pumpAndSettle();

    expect(
      find.byKey(const ValueKey('admin-mailing-batch-no-valid-labels')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('admin-mailing-batch-download')),
      findsNothing,
    );
    expect(
      find.byKey(const ValueKey('admin-mailing-batch-export-valid')),
      findsNothing,
    );
  });

  testWidgets('all QR labels too dense excludes the correlated mailing label', (
    tester,
  ) async {
    final denseId = 'dense-${List<String>.filled(600, 'x').join()}';
    final dependencies = _dependenciesWithMailing(
      qrPreparation: _preparation(<AdminRestaurantQrRestaurantResult>[
        _allQrLabelsDense(denseId, 'Dense Restaurant'),
      ]),
      mailingPreparation: _mailingPreparation(<AdminRestaurantMailingResult>[
        _mailingReady(denseId, 'Dense Restaurant'),
      ]),
    );

    await _openDialog(
      tester,
      ids: <String>[denseId],
      dependencies: dependencies,
    );
    await tester.pumpAndSettle();

    expect(
      find.byKey(const ValueKey('admin-qr-batch-no-valid-labels')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('admin-mailing-batch-no-valid-labels')),
      findsOneWidget,
    );
    expect(
      find.byKey(
        ValueKey<String>(
          'admin-mailing-batch-problem-$denseId-'
          'excluded_no_qr_valid_artifact',
        ),
      ),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('admin-mailing-batch-download')),
      findsNothing,
    );
  });
}

AdminRestaurantQrBatchDialogDependencies _dependencies({
  required AdminRestaurantQrPreparationRunResult preparation,
  AdminRestaurantQrPrepareOperation? prepare,
  AdminRestaurantQrRetryPreparationOperation? retryPreparation,
  AdminRestaurantQrPdfPreflightOperation? preflight,
  AdminRestaurantQrPdfBuildOperation? buildPdf,
  AdminRestaurantQrPdfDownloadOperation? downloadPdf,
  AdminRestaurantQrMarkOperation? markPrepared,
}) {
  const pdfService = RestaurantQrPdfService();
  return AdminRestaurantQrBatchDialogDependencies(
    prepare: prepare ?? (ids, onProgress) async => preparation,
    retryPreparation:
        retryPreparation ??
        (previous, onProgress) async {
          final retry = await (prepare ?? (ids, progress) async => preparation)(
            previous.retryCatalogRestaurantIds,
            onProgress,
          );
          return previous.mergeExplicitRetry(retry);
        },
    preflight: preflight ?? pdfService.preflight,
    buildPdf: buildPdf ?? ((result) async => _artifact(result)),
    downloadPdf:
        downloadPdf ??
        (bytes, filename) async =>
            const RestaurantQrPdfExportResult.initiated(),
    markPrepared:
        markPrepared ??
        (worklist, onProgress) async => _markingResult(worklist),
  );
}

AdminRestaurantQrBatchDialogDependencies _dependenciesWithMailing({
  required AdminRestaurantQrPreparationRunResult qrPreparation,
  required AdminRestaurantMailingBatchRunResult mailingPreparation,
  AdminRestaurantQrPrepareOperation? prepare,
  AdminRestaurantQrPdfBuildOperation? buildPdf,
  AdminRestaurantQrPdfDownloadOperation? downloadPdf,
  AdminRestaurantQrMarkOperation? markPrepared,
  AdminRestaurantMailingPrepareOperation? prepareMailing,
  AdminRestaurantMailingRetryOperation? retryMailing,
  AdminRestaurantMailingPdfPreflightOperation? preflightMailing,
  AdminRestaurantMailingPdfBuildOperation? buildMailingPdf,
  AdminRestaurantMailingPdfDownloadOperation? downloadMailingPdf,
}) {
  const qrPdfService = RestaurantQrPdfService();
  return AdminRestaurantQrBatchDialogDependencies(
    prepare: prepare ?? (ids, progress) async => qrPreparation,
    retryPreparation: (previous, progress) async => previous,
    preflight: qrPdfService.preflight,
    buildPdf: buildPdf ?? ((preflight) async => _artifact(preflight)),
    downloadPdf:
        downloadPdf ??
        (bytes, filename) async =>
            const RestaurantQrPdfExportResult.initiated(),
    markPrepared:
        markPrepared ?? (worklist, progress) async => _markingResult(worklist),
    prepareMailing:
        prepareMailing ??
        (ids, progress) async {
          expect(ids, mailingPreparation.requestedCatalogRestaurantIds);
          return mailingPreparation;
        },
    retryMailing:
        retryMailing ??
        (previous, progress) async {
          expect(previous.canRetry, isFalse);
          return previous;
        },
    preflightMailing:
        preflightMailing ??
        (manifest, problems) async =>
            _mailingPreflight(manifest, problems: problems),
    buildMailingPdf:
        buildMailingPdf ??
        (preflight, approved) async => _mailingArtifact(preflight),
    downloadMailingPdf:
        downloadMailingPdf ??
        (bytes, filename) async =>
            const RestaurantMailingLabelPdfExportResult.initiated(),
  );
}

AdminRestaurantMailingBatchRunResult _mailingPreparation(
  List<AdminRestaurantMailingResult> results,
) => AdminRestaurantMailingBatchRunResult(
  requestedCatalogRestaurantIds: results.map(
    (result) => result.catalogRestaurantId,
  ),
  confirmedResults: results,
);

AdminRestaurantMailingReady _mailingReady(String id, String name) =>
    AdminRestaurantMailingReady(
      catalogRestaurantId: id,
      restaurantName: name,
      streetAddress: '123 Main St Suite 4',
      city: 'Albany',
      state: 'NY',
      zipCode: '12207',
    );

AdminRestaurantMailingPdfPreflightResult _mailingPreflight(
  AdminRestaurantMailingManifest manifest, {
  Iterable<AdminRestaurantMailingPdfProblem> problems = const [],
}) => AdminRestaurantMailingPdfPreflightResult(
  validLayouts: manifest.entries.map(
    (entry) => AdminRestaurantMailingLayoutEntry(
      entry: entry,
      fontSizePoints: 9,
      lineHeightPoints: 11,
    ),
  ),
  problems: problems,
);

AdminRestaurantMailingPdfArtifact _mailingArtifact(
  AdminRestaurantMailingPdfPreflightResult preflight,
) => AdminRestaurantMailingPdfArtifact(
  bytes: Uint8List.fromList('%PDF-synthetic-mailing-artifact'.codeUnits),
  summary: AdminRestaurantMailingPdfArtifactSummary(
    filename: 'bitestar-mailing-labels-20260907-101112.pdf',
    includedCatalogRestaurantIds: preflight.validLayouts.map(
      (layout) => layout.entry.catalogRestaurantId,
    ),
    pageCount: (preflight.validLayouts.length + 29) ~/ 30,
    problems: preflight.problems,
  ),
);

Future<void> _openDialog(
  WidgetTester tester, {
  required List<String> ids,
  required AdminRestaurantQrBatchDialogDependencies dependencies,
  AdminRestaurantQrBatchReconciledCallback? onReconciled,
  double textScale = 1,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Builder(
        builder: (context) => MediaQuery(
          data: MediaQuery.of(
            context,
          ).copyWith(textScaler: TextScaler.linear(textScale)),
          child: Scaffold(
            body: FilledButton(
              key: const ValueKey('open-batch-dialog'),
              onPressed: () => showAdminRestaurantQrBatchDialog(
                context: context,
                frozenCatalogRestaurantIds: ids,
                dependencies: dependencies,
                onReconciled: onReconciled,
              ),
              child: const Text('Open'),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.byKey(const ValueKey('open-batch-dialog')));
  await tester.pump();
}

Future<void> _tapVisible(WidgetTester tester, Key key) async {
  final finder = find.byKey(key);
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

Future<void> _openDialogOverAdminRoute(
  WidgetTester tester, {
  required List<String> ids,
  required AdminRestaurantQrBatchDialogDependencies dependencies,
  required _RouteAccountingObserver observer,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      navigatorObservers: <NavigatorObserver>[observer],
      home: Builder(
        builder: (homeContext) => Scaffold(
          key: const ValueKey('navigation-home'),
          body: FilledButton(
            key: const ValueKey('open-admin-route'),
            onPressed: () {
              Navigator.of(homeContext).push(
                MaterialPageRoute<void>(
                  settings: const RouteSettings(name: 'admin-route'),
                  builder: (_) => Builder(
                    builder: (adminContext) => Scaffold(
                      key: const ValueKey('admin-route'),
                      body: FilledButton(
                        key: const ValueKey('open-batch-dialog'),
                        onPressed: () => showAdminRestaurantQrBatchDialog(
                          context: adminContext,
                          frozenCatalogRestaurantIds: ids,
                          dependencies: dependencies,
                        ),
                        child: const Text('Open batch'),
                      ),
                    ),
                  ),
                ),
              );
            },
            child: const Text('Open Admin'),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.byKey(const ValueKey('open-admin-route')));
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(const ValueKey('open-batch-dialog')));
  await tester.pumpAndSettle();
}

Future<void> _downloadIntoUnresolvedStatus(WidgetTester tester) async {
  await tester.tap(find.byKey(const ValueKey('admin-qr-batch-download')));
  await tester.pumpAndSettle();
  expect(find.text('Status saving incomplete'), findsOneWidget);
}

class _RouteAccountingObserver extends NavigatorObserver {
  int pushCount = 0;
  int popCount = 0;
  int removeCount = 0;

  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) {
    pushCount += 1;
    super.didPush(route, previousRoute);
  }

  @override
  void didPop(Route<dynamic> route, Route<dynamic>? previousRoute) {
    popCount += 1;
    super.didPop(route, previousRoute);
  }

  @override
  void didRemove(Route<dynamic> route, Route<dynamic>? previousRoute) {
    removeCount += 1;
    super.didRemove(route, previousRoute);
  }

  void reset() {
    pushCount = 0;
    popCount = 0;
    removeCount = 0;
  }
}

AdminRestaurantQrPreparationRunResult _preparation(
  List<AdminRestaurantQrRestaurantResult> results,
) => AdminRestaurantQrPreparationRunResult(
  requestedCatalogRestaurantIds: results.map(
    (result) => result.catalogRestaurantId,
  ),
  results: results,
);

AdminRestaurantQrPreparationRunResult _allProblems(List<String> ids) =>
    _preparation([
      for (final id in ids)
        AdminRestaurantQrProblemRestaurant(
          catalogRestaurantId: id,
          outcome: AdminRestaurantQrProblemOutcome.unavailable,
          code: 'restaurant_unavailable',
          message: 'This restaurant is not currently available.',
        ),
    ]);

AdminRestaurantQrReadyRestaurant _readyRestaurant(
  String catalogRestaurantId,
  String restaurantName,
) => AdminRestaurantQrReadyRestaurant(
  catalogRestaurantId: catalogRestaurantId,
  restaurantName: restaurantName,
  labels: [
    AdminRestaurantQrLabelEntry(
      type: AdminRestaurantQrLabelType.ownerInvite,
      payloadUrl: 'https://go.bitestar.app/invite/coupon/synthetic-owner-token',
      invitationId: 'synthetic-owner-invitation',
      invitationExpiresAtMillis: 1800000000000,
    ),
    AdminRestaurantQrLabelEntry(
      type: AdminRestaurantQrLabelType.claimInvite,
      payloadUrl:
          'https://go.bitestar.app/invite/bitescore/synthetic-claim-token',
      invitationId: 'synthetic-claim-invitation',
      invitationExpiresAtMillis: 1800000000000,
    ),
    AdminRestaurantQrLabelEntry(
      type: AdminRestaurantQrLabelType.biteSaverCustomer,
      payloadUrl: 'https://go.bitestar.app/r/coupons/$catalogRestaurantId',
    ),
    AdminRestaurantQrLabelEntry(
      type: AdminRestaurantQrLabelType.biteScoreCustomer,
      payloadUrl: 'https://go.bitestar.app/r/bitescore/$catalogRestaurantId',
    ),
  ],
);

AdminRestaurantQrReadyRestaurant _partiallyQrValidRestaurant(
  String catalogRestaurantId,
  String restaurantName,
) {
  final base = _readyRestaurant(catalogRestaurantId, restaurantName);
  return AdminRestaurantQrReadyRestaurant(
    catalogRestaurantId: catalogRestaurantId,
    restaurantName: restaurantName,
    labels: <AdminRestaurantQrLabelEntry>[
      AdminRestaurantQrLabelEntry(
        type: AdminRestaurantQrLabelType.ownerInvite,
        payloadUrl:
            'https://go.bitestar.app/invite/coupon/'
            '${List<String>.filled(300, 'x').join()}',
        invitationId: 'synthetic-dense-owner-invitation',
        invitationExpiresAtMillis: 1800000000000,
      ),
      ...base.labels.skip(1),
    ],
  );
}

AdminRestaurantQrReadyRestaurant _allQrLabelsDense(
  String catalogRestaurantId,
  String restaurantName,
) {
  final token = List<String>.filled(600, 'x').join();
  return AdminRestaurantQrReadyRestaurant(
    catalogRestaurantId: catalogRestaurantId,
    restaurantName: restaurantName,
    labels: <AdminRestaurantQrLabelEntry>[
      AdminRestaurantQrLabelEntry(
        type: AdminRestaurantQrLabelType.ownerInvite,
        payloadUrl: 'https://go.bitestar.app/invite/coupon/$token',
        invitationId: 'synthetic-dense-owner-invitation',
        invitationExpiresAtMillis: 1800000000000,
      ),
      AdminRestaurantQrLabelEntry(
        type: AdminRestaurantQrLabelType.claimInvite,
        payloadUrl: 'https://go.bitestar.app/invite/bitescore/$token',
        invitationId: 'synthetic-dense-claim-invitation',
        invitationExpiresAtMillis: 1800000000000,
      ),
      AdminRestaurantQrLabelEntry(
        type: AdminRestaurantQrLabelType.biteSaverCustomer,
        payloadUrl: 'https://go.bitestar.app/r/coupons/$catalogRestaurantId',
      ),
      AdminRestaurantQrLabelEntry(
        type: AdminRestaurantQrLabelType.biteScoreCustomer,
        payloadUrl: 'https://go.bitestar.app/r/bitescore/$catalogRestaurantId',
      ),
    ],
  );
}

RestaurantQrPdfArtifact _artifact(RestaurantQrPdfPreflightResult preflight) =>
    RestaurantQrPdfArtifact(
      bytes: Uint8List.fromList('%PDF-synthetic-immutable-artifact'.codeUnits),
      summary: AdminRestaurantQrPdfArtifactSummary(
        filename: 'bitestar-qr-labels-20260829-205400.pdf',
        pageCount: preflight.pageCount,
        includedManifest: preflight.validManifest,
      ),
    );

AdminRestaurantQrMarkingRunResult _markingResult(
  AdminRestaurantQrMarkingWorklist worklist, {
  Set<AdminRestaurantQrLabelType> failedTypes = const {},
}) {
  final request = AdminRestaurantQrMarkingRequest(worklist.restaurants);
  final rawRestaurants = <Map<String, Object?>>[];
  var hasAnyFailure = false;
  for (final restaurant in worklist.restaurants) {
    final labels = <Map<String, Object?>>[];
    var restaurantHasFailure = false;
    for (final label in restaurant.labels) {
      if (failedTypes.contains(label.type)) {
        restaurantHasFailure = true;
        hasAnyFailure = true;
        labels.add({
          'type': label.type.wireName,
          'status': 'failed',
          'code': 'status_unavailable',
          'message': 'Preparation status could not be confirmed.',
        });
      } else if (label.type == AdminRestaurantQrLabelType.claimInvite) {
        labels.add({'type': label.type.wireName, 'status': 'notRequired'});
      } else {
        labels.add({
          'type': label.type.wireName,
          'status': 'saved',
          'alreadySaved':
              label.type == AdminRestaurantQrLabelType.biteSaverCustomer,
        });
      }
    }
    rawRestaurants.add({
      'catalogRestaurantId': restaurant.catalogRestaurantId,
      'outcome': restaurantHasFailure ? 'partialFailure' : 'processed',
      'labels': labels,
      'preparation': {
        'canonicalCatalogRestaurantId': restaurant.catalogRestaurantId,
        'i': 'prepared',
        'c': 'notRequired',
        'sa': 'prepared',
        'sr': 'prepared',
      },
    });
  }
  final chunk = AdminRestaurantQrMarkingChunkResult.fromCallableData({
    'schemaVersion': 1,
    'outcome': hasAnyFailure ? 'partialFailure' : 'complete',
    'results': rawRestaurants,
  }, expectedRequest: request);
  return AdminRestaurantQrMarkingRunResult(
    requestedWorklist: worklist,
    results: chunk.results,
  );
}
