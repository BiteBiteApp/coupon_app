import 'dart:async';

import 'package:coupon_app/models/admin_restaurant_qr_batch.dart';
import 'package:coupon_app/services/admin_restaurant_qr_batch_service.dart';
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
        dependencies: _dependencies(preparation: preparation),
        textScale: size.width == 320 ? 2 : 1,
      );
      await tester.pumpAndSettle();
      expect(find.text('PDF ready'), findsOneWidget, reason: '$size');
      expect(
        find.byKey(const ValueKey('admin-qr-batch-download')),
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

  void reset() {
    pushCount = 0;
    popCount = 0;
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
