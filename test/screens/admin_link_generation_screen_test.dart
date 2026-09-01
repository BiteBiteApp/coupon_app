import 'dart:async';
import 'dart:convert';
import 'dart:ui' as ui;

import 'package:coupon_app/models/admin_restaurant_link_record.dart';
import 'package:coupon_app/models/admin_restaurant_qr_batch.dart';
import 'package:coupon_app/models/pagination/paged_models.dart';
import 'package:coupon_app/screens/admin_link_generation_screen.dart';
import 'package:coupon_app/services/admin_link_generation_service.dart';
import 'package:coupon_app/services/restaurant_invite_service.dart';
import 'package:coupon_app/services/restaurant_qr_export.dart';
import 'package:coupon_app/services/restaurant_qr_image_service.dart';
import 'package:coupon_app/services/restaurant_qr_pdf_export.dart';
import 'package:coupon_app/services/restaurant_qr_pdf_service.dart';
import 'package:coupon_app/widgets/admin_restaurant_qr_batch_dialog.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test(
    'batch selection accepts valid selected rows and ignores valid unselected duplicates',
    () {
      final first = _selectableOrderedRecord('first', 0);
      final second = _selectableOrderedRecord('second', 1);
      final unselected = _selectableOrderedRecord('not-selected', 2);
      final selectableChecks = <String>[];
      final frozen = freezeAdminRestaurantQrBatchSelection(
        selectedCatalogRestaurantIds: <String>{'second', 'first'},
        displayedRecords: <AdminRestaurantLinkRecord>[
          unselected,
          first,
          unselected,
          second,
        ],
        isCurrentlySelectable: (record) {
          selectableChecks.add(record.documentId);
          return true;
        },
      );

      expect(frozen, <String>['first', 'second']);
      expect(selectableChecks, <String>['first', 'second']);
      expect(() => frozen.add('later'), throwsUnsupportedError);
    },
  );

  test(
    'batch selection reaches the duplicate-count guard for adjacent and separated rows',
    () {
      final duplicate = _selectableOrderedRecord('duplicate', 0);
      final selected = <String>{'duplicate'};
      expect(
        freezeAdminRestaurantQrBatchSelection(
          selectedCatalogRestaurantIds: selected,
          displayedRecords: <AdminRestaurantLinkRecord>[duplicate],
          isCurrentlySelectable: (_) => true,
        ),
        <String>['duplicate'],
      );

      final cases = <List<AdminRestaurantLinkRecord>>[
        <AdminRestaurantLinkRecord>[duplicate, duplicate],
        <AdminRestaurantLinkRecord>[
          duplicate,
          _selectableOrderedRecord('unselected-between', 1),
          duplicate,
        ],
      ];

      for (final displayedRecords in cases) {
        var selectableChecks = 0;
        expect(
          () => freezeAdminRestaurantQrBatchSelection(
            selectedCatalogRestaurantIds: selected,
            displayedRecords: displayedRecords,
            isCurrentlySelectable: (record) {
              selectableChecks += 1;
              expect(record, same(duplicate));
              return true;
            },
          ),
          throwsA(
            isA<AdminRestaurantQrBatchSelectionException>().having(
              (error) => error.message,
              'message',
              'The selected restaurants changed unexpectedly. Run a fresh Search.',
            ),
          ),
        );
        expect(
          selectableChecks,
          1,
          reason:
              'The first valid row passes before occurrence two is rejected.',
        );
        expect(selected, <String>{'duplicate'});
      }
    },
  );

  test(
    'batch selection rejects conflicting duplicate rows only after each row can pass alone',
    () {
      final first = _selectableOrderedRecord(
        'duplicate',
        0,
        name: 'First Display',
      );
      final second = _biteScoreRecord(
        documentId: 'duplicate',
        name: 'Conflicting Display',
        preparation: _preparationState(
          'duplicate',
          ownerInvite: AdminRestaurantPreparationStatus.prepared,
        ),
        orderDistanceMillimeters: 1,
      );
      final selected = <String>{'duplicate'};

      for (final row in <AdminRestaurantLinkRecord>[first, second]) {
        expect(row.isBiteScore, isTrue);
        expect(row.isActive, isTrue);
        expect(row.actionId, row.documentId);
        expect(row.preparation.canonicalCatalogRestaurantId, row.documentId);
        expect(
          row.preparation.isValidForParticipation(
            biteSaverCatalogBindingState: row.biteSaverCatalogBindingState,
            claimState: row.claimState,
          ),
          isTrue,
        );
        expect(
          freezeAdminRestaurantQrBatchSelection(
            selectedCatalogRestaurantIds: selected,
            displayedRecords: <AdminRestaurantLinkRecord>[row],
            isCurrentlySelectable: (candidate) => identical(candidate, row),
          ),
          <String>['duplicate'],
        );
      }

      var selectableChecks = 0;
      expect(
        () => freezeAdminRestaurantQrBatchSelection(
          selectedCatalogRestaurantIds: selected,
          displayedRecords: <AdminRestaurantLinkRecord>[first, second],
          isCurrentlySelectable: (record) {
            selectableChecks += 1;
            return true;
          },
        ),
        throwsA(
          isA<AdminRestaurantQrBatchSelectionException>().having(
            (error) => error.message,
            'message',
            'The selected restaurants changed unexpectedly. Run a fresh Search.',
          ),
        ),
      );
      expect(selectableChecks, 1);
      expect(selected, <String>{'duplicate'});
    },
  );

  test(
    'batch selection reaches the zero-occurrence guard for a missing selected row',
    () {
      final selected = <String>{'missing'};
      final selectedRow = _selectableOrderedRecord('missing', 0);
      final remainingRow = _selectableOrderedRecord('displayed', 1);
      expect(
        freezeAdminRestaurantQrBatchSelection(
          selectedCatalogRestaurantIds: selected,
          displayedRecords: <AdminRestaurantLinkRecord>[selectedRow],
          isCurrentlySelectable: (_) => true,
        ),
        <String>['missing'],
      );

      var selectableChecks = 0;
      expect(
        () => freezeAdminRestaurantQrBatchSelection(
          selectedCatalogRestaurantIds: selected,
          displayedRecords: <AdminRestaurantLinkRecord>[remainingRow],
          isCurrentlySelectable: (_) {
            selectableChecks += 1;
            return true;
          },
        ),
        throwsA(
          isA<AdminRestaurantQrBatchSelectionException>().having(
            (error) => error.message,
            'message',
            'The selected restaurants changed unexpectedly. Run a fresh Search.',
          ),
        ),
      );
      expect(selectableChecks, 0);
      expect(selected, <String>{'missing'});
    },
  );

  test(
    'batch selection reaches selectability after exactly one valid occurrence',
    () {
      final selected = <String>{'stale-selection'};
      final row = _selectableOrderedRecord('stale-selection', 0);
      expect(
        freezeAdminRestaurantQrBatchSelection(
          selectedCatalogRestaurantIds: selected,
          displayedRecords: <AdminRestaurantLinkRecord>[row],
          isCurrentlySelectable: (_) => true,
        ),
        <String>['stale-selection'],
      );

      var selectableChecks = 0;
      expect(
        () => freezeAdminRestaurantQrBatchSelection(
          selectedCatalogRestaurantIds: selected,
          displayedRecords: <AdminRestaurantLinkRecord>[row],
          isCurrentlySelectable: (candidate) {
            selectableChecks += 1;
            expect(candidate, same(row));
            return false;
          },
        ),
        throwsA(
          isA<AdminRestaurantQrBatchSelectionException>().having(
            (error) => error.message,
            'message',
            'The selected restaurants are inconsistent. Run a fresh Search.',
          ),
        ),
      );
      expect(selectableChecks, 1);
      expect(selected, <String>{'stale-selection'});
    },
  );

  testWidgets(
    'Generate freezes selected canonical IDs in displayed order and double taps once',
    (tester) async {
      final pending = Completer<AdminRestaurantQrPreparationRunResult>();
      var prepareCalls = 0;
      var frozenIds = const <String>[];
      final dependencies = AdminRestaurantQrBatchDialogDependencies(
        prepare: (catalogRestaurantIds, _) {
          prepareCalls += 1;
          frozenIds = List<String>.of(catalogRestaurantIds);
          return pending.future;
        },
        retryPreparation: (_, _) async => throw UnimplementedError(),
        preflight: (_) async => throw UnimplementedError(),
        buildPdf: (_) async => throw UnimplementedError(),
        downloadPdf: (_, _) async => throw UnimplementedError(),
        markPrepared: (_, _) async => throw UnimplementedError(),
      );
      await _pumpScreen(
        tester,
        search:
            ({
              required locationQuery,
              required radiusMiles,
              required restaurantName,
              required sources,
            }) async => _result(
              records: <AdminRestaurantLinkRecord>[
                _selectableOrderedRecord('display-a', 0, name: 'Display A'),
                _selectableOrderedRecord('display-b', 1, name: 'Display B'),
                _selectableOrderedRecord('display-c', 2, name: 'Display C'),
              ],
            ),
        qrBatchDependencies: dependencies,
      );
      await _submitSearch(tester);
      for (final id in <String>['display-c', 'display-a']) {
        final checkbox = await _scrollToAdminKey(
          tester,
          ValueKey<String>('biteScore:$id:batch-selection'),
        );
        await tester.tap(checkbox);
        await tester.pump();
      }

      final generate = await _scrollToAdminKey(
        tester,
        const ValueKey('admin-link-generate-qr-label-pdf'),
        delta: -600,
      );
      await tester.tap(generate);
      await tester.tap(generate, warnIfMissed: false);
      await tester.pump();
      await tester.pump();

      expect(prepareCalls, 1);
      expect(frozenIds, <String>['display-a', 'display-c']);
      expect(
        find.byKey(const ValueKey('admin-qr-batch-dialog')),
        findsOneWidget,
      );

      pending.complete(
        AdminRestaurantQrPreparationRunResult(
          requestedCatalogRestaurantIds: frozenIds,
          results: <AdminRestaurantQrRestaurantResult>[
            for (final id in frozenIds)
              AdminRestaurantQrProblemRestaurant(
                catalogRestaurantId: id,
                outcome: AdminRestaurantQrProblemOutcome.unavailable,
                code: 'restaurant_unavailable',
                message: 'This restaurant is not currently available.',
              ),
          ],
        ),
      );
      const cancelKey = ValueKey('admin-qr-batch-cancel');
      for (
        var pump = 0;
        pump < 100 && find.byKey(cancelKey).evaluate().isEmpty;
        pump += 1
      ) {
        await tester.pump(const Duration(milliseconds: 10));
      }
      expect(find.byKey(cancelKey), findsOneWidget);
      await tester.tap(find.byKey(cancelKey));
      for (
        var pump = 0;
        pump < 100 &&
            find
                .byKey(const ValueKey('admin-qr-batch-dialog'))
                .evaluate()
                .isNotEmpty;
        pump += 1
      ) {
        await tester.pump(const Duration(milliseconds: 10));
      }
      expect(find.byKey(const ValueKey('admin-qr-batch-dialog')), findsNothing);
    },
  );

  testWidgets(
    'exactly one valid selected canonical row reaches the real batch workflow',
    (tester) async {
      const catalogId = 'positive-control';
      final pending = Completer<AdminRestaurantQrPreparationRunResult>();
      var preparationCalls = 0;
      var retryPreparationCalls = 0;
      var preflightCalls = 0;
      var buildCalls = 0;
      var downloadCalls = 0;
      var markingCalls = 0;
      final dependencies = AdminRestaurantQrBatchDialogDependencies(
        prepare: (catalogRestaurantIds, _) {
          preparationCalls += 1;
          expect(catalogRestaurantIds, <String>[catalogId]);
          return pending.future;
        },
        retryPreparation: (_, _) async {
          retryPreparationCalls += 1;
          throw StateError('Positive control must not retry preparation.');
        },
        preflight: (_) async {
          preflightCalls += 1;
          throw StateError('Preparation remains pending in this assertion.');
        },
        buildPdf: (_) async {
          buildCalls += 1;
          throw StateError('Preparation remains pending in this assertion.');
        },
        downloadPdf: (_, _) async {
          downloadCalls += 1;
          throw StateError('Preparation remains pending in this assertion.');
        },
        markPrepared: (_, _) async {
          markingCalls += 1;
          throw StateError('Preparation remains pending in this assertion.');
        },
      );
      await _pumpScreen(
        tester,
        qrBatchDependencies: dependencies,
        search:
            ({
              required locationQuery,
              required radiusMiles,
              required restaurantName,
              required sources,
            }) async => _result(
              records: <AdminRestaurantLinkRecord>[
                _selectableOrderedRecord(catalogId, 0),
              ],
            ),
      );
      await _submitSearch(tester);
      final checkbox = find.byKey(
        const ValueKey('biteScore:positive-control:batch-selection'),
      );
      expect(tester.widget<Checkbox>(checkbox).onChanged, isNotNull);
      await tester.tap(checkbox);
      await tester.pump();
      expect(find.text('1 selected'), findsOneWidget);

      await tester.tap(
        find.byKey(const ValueKey('admin-link-generate-qr-label-pdf')),
      );
      await tester.pump();
      await tester.pump();

      expect(preparationCalls, 1);
      expect(retryPreparationCalls, 0);
      expect(preflightCalls, 0);
      expect(buildCalls, 0);
      expect(downloadCalls, 0);
      expect(markingCalls, 0);
      expect(
        find.byKey(const ValueKey('admin-qr-batch-dialog')),
        findsOneWidget,
      );

      pending.complete(
        AdminRestaurantQrPreparationRunResult(
          requestedCatalogRestaurantIds: const <String>[catalogId],
          results: <AdminRestaurantQrRestaurantResult>[
            AdminRestaurantQrProblemRestaurant(
              catalogRestaurantId: catalogId,
              outcome: AdminRestaurantQrProblemOutcome.unavailable,
              code: 'restaurant_unavailable',
              message: 'This restaurant is not currently available.',
            ),
          ],
        ),
      );
      const cancelKey = ValueKey('admin-qr-batch-cancel');
      for (
        var pump = 0;
        pump < 100 && find.byKey(cancelKey).evaluate().isEmpty;
        pump += 1
      ) {
        await tester.pump(const Duration(milliseconds: 10));
      }
      expect(find.byKey(cancelKey), findsOneWidget);
      await tester.tap(find.byKey(cancelKey));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('admin-qr-batch-dialog')), findsNothing);
    },
  );

  testWidgets(
    'invalid frozen shapes reach their real guard with zero batch side effects',
    (tester) async {
      for (final shape in <String>[
        'separated-duplicate',
        'conflicting-duplicate',
        'missing',
        'no-longer-selectable',
      ]) {
        final catalogId = 'fixture-$shape';
        final selectedRow = _selectableOrderedRecord(catalogId, 0);
        final records = <AdminRestaurantLinkRecord>[
          selectedRow,
          _selectableOrderedRecord('unselected-$shape', 1),
        ];
        var preparationCalls = 0;
        var retryPreparationCalls = 0;
        var preflightCalls = 0;
        var buildCalls = 0;
        var downloadCalls = 0;
        var markingCalls = 0;
        final dependencies = AdminRestaurantQrBatchDialogDependencies(
          prepare: (_, _) async {
            preparationCalls += 1;
            throw StateError('$shape must fail before preparation.');
          },
          retryPreparation: (_, _) async {
            retryPreparationCalls += 1;
            throw StateError('$shape must fail before a preparation retry.');
          },
          preflight: (_) async {
            preflightCalls += 1;
            throw StateError('$shape must fail before preflight.');
          },
          buildPdf: (_) async {
            buildCalls += 1;
            throw StateError('$shape must fail before PDF build.');
          },
          downloadPdf: (_, _) async {
            downloadCalls += 1;
            throw StateError('$shape must fail before download.');
          },
          markPrepared: (_, _) async {
            markingCalls += 1;
            throw StateError('$shape must fail before marking.');
          },
        );
        await _pumpScreen(
          tester,
          qrBatchDependencies: dependencies,
          search:
              ({
                required locationQuery,
                required radiusMiles,
                required restaurantName,
                required sources,
              }) async => _result(records: records),
        );
        await _submitSearch(tester);
        final checkbox = find.byKey(
          ValueKey<String>('biteScore:$catalogId:batch-selection'),
        );
        expect(
          tester.widget<Checkbox>(checkbox).onChanged,
          isNotNull,
          reason: '$shape must begin from a selectable row.',
        );
        await tester.tap(checkbox);
        await tester.pump();
        expect(find.text('1 selected'), findsOneWidget, reason: shape);
        expect(tester.widget<Checkbox>(checkbox).value, isTrue, reason: shape);

        switch (shape) {
          case 'separated-duplicate':
            records.add(
              _selectableOrderedRecord(catalogId, 2, name: 'Duplicate Display'),
            );
            break;
          case 'conflicting-duplicate':
            records.add(
              _biteScoreRecord(
                documentId: catalogId,
                name: 'Conflicting Display and Preparation',
                preparation: _preparationState(
                  catalogId,
                  ownerInvite: AdminRestaurantPreparationStatus.prepared,
                ),
                orderDistanceMillimeters: 2,
              ),
            );
            break;
          case 'missing':
            records.removeWhere((record) => record.documentId == catalogId);
            break;
          case 'no-longer-selectable':
            records[0] = _biteScoreRecord(
              documentId: catalogId,
              isActive: false,
              preparation: _availablePreparation(catalogId),
              orderDistanceMillimeters: 0,
            );
            break;
        }

        final matchingRows = records
            .where((record) => record.documentId == catalogId)
            .toList(growable: false);
        final expectedOccurrences = switch (shape) {
          'separated-duplicate' || 'conflicting-duplicate' => 2,
          'missing' => 0,
          'no-longer-selectable' => 1,
          _ => throw StateError('Unexpected test shape.'),
        };
        expect(matchingRows, hasLength(expectedOccurrences), reason: shape);
        if (shape.contains('duplicate')) {
          for (final row in matchingRows) {
            expect(row.isBiteScore, isTrue, reason: shape);
            expect(row.isActive, isTrue, reason: shape);
            expect(row.actionId, catalogId, reason: shape);
            expect(
              row.preparation.canonicalCatalogRestaurantId,
              catalogId,
              reason: shape,
            );
            expect(
              row.preparation.isValidForParticipation(
                biteSaverCatalogBindingState: row.biteSaverCatalogBindingState,
                claimState: row.claimState,
              ),
              isTrue,
              reason: shape,
            );
          }
        }
        if (shape == 'no-longer-selectable') {
          expect(matchingRows.single.isActive, isFalse);
          expect(
            matchingRows.single.preparation.canonicalCatalogRestaurantId,
            catalogId,
          );
        }

        final generate = find.byKey(
          const ValueKey('admin-link-generate-qr-label-pdf'),
        );
        expect(tester.widget<FilledButton>(generate).onPressed, isNotNull);
        await tester.tap(generate);
        await tester.pump();

        expect(preparationCalls, 0, reason: shape);
        expect(retryPreparationCalls, 0, reason: shape);
        expect(preflightCalls, 0, reason: shape);
        expect(buildCalls, 0, reason: shape);
        expect(downloadCalls, 0, reason: shape);
        expect(markingCalls, 0, reason: shape);
        expect(
          find.byKey(const ValueKey('admin-qr-batch-dialog')),
          findsNothing,
          reason: shape,
        );
        final expectedMessage = shape == 'no-longer-selectable'
            ? 'The selected restaurants are inconsistent. Run a fresh Search.'
            : 'The selected restaurants changed unexpectedly. Run a fresh Search.';
        expect(find.text(expectedMessage), findsOneWidget, reason: shape);
        expect(find.text('1 selected'), findsOneWidget, reason: shape);
        expect(tester.widget<Checkbox>(checkbox).value, isTrue, reason: shape);
        expect(
          tester.widget<FilledButton>(generate).onPressed,
          isNotNull,
          reason: '$shape must not leave the batch-active lock set.',
        );
        tester
            .state<ScaffoldMessengerState>(find.byType(ScaffoldMessenger))
            .clearSnackBars();
        await tester.pumpAndSettle();
      }
    },
  );

  testWidgets(
    'paged search prepares explicitly and returns page one on continue',
    (tester) async {
      final calls = <({String instance, String request, String? cursor})>[];
      await _pumpPagedScreen(
        tester,
        search:
            ({
              required locationQuery,
              required radiusMiles,
              required restaurantName,
              required sources,
              required searchInstanceId,
              required clientRequestId,
              required needsQrPreparation,
              cursor,
              resolvedSearchCenter,
            }) async {
              calls.add((
                instance: searchInstanceId,
                request: clientRequestId,
                cursor: cursor,
              ));
              return calls.length == 1
                  ? _pagedResult(
                      preparing: true,
                      hasNext: true,
                      nextCursor: _pageCursor('preparation-cursor'),
                    )
                  : _pagedResult(
                      records: [_biteScoreRecord(documentId: 'ready')],
                    );
            },
      );

      await _submitSearch(tester);
      expect(
        find.byKey(const ValueKey('admin-link-preparing-state')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('admin-link-no-results-state')),
        findsNothing,
      );
      expect(find.text('Preparing complete nearby results…'), findsOneWidget);

      await tester.tap(
        find.byKey(const ValueKey('admin-link-continue-search-button')),
      );
      await tester.pumpAndSettle();

      expect(find.text('River Grill'), findsOneWidget);
      expect(calls, hasLength(2));
      expect(calls[1].instance, calls[0].instance);
      expect(calls[1].request, isNot(calls[0].request));
      expect(calls[1].cursor, _pageCursor('preparation-cursor'));
    },
  );

  testWidgets(
    'canonical selection is exact deduplicated accessible and excludes unsafe rows',
    (tester) async {
      final semantics = tester.ensureSemantics();
      var preparationCalls = 0;
      var preflightCalls = 0;
      var buildCalls = 0;
      var downloadCalls = 0;
      var markingCalls = 0;
      final qrBatchDependencies = AdminRestaurantQrBatchDialogDependencies(
        prepare: (_, _) async {
          preparationCalls += 1;
          throw StateError('Duplicate selection must fail before preparation.');
        },
        retryPreparation: (_, _) async => throw UnimplementedError(),
        preflight: (_) async {
          preflightCalls += 1;
          throw StateError('Duplicate selection must fail before preflight.');
        },
        buildPdf: (_) async {
          buildCalls += 1;
          throw StateError('Duplicate selection must fail before PDF build.');
        },
        downloadPdf: (_, _) async {
          downloadCalls += 1;
          throw StateError('Duplicate selection must fail before download.');
        },
        markPrepared: (_, _) async {
          markingCalls += 1;
          throw StateError('Duplicate selection must fail before marking.');
        },
      );
      final canonical = _biteScoreRecord(
        documentId: 'canonical-id',
        name: 'Canonical Cafe',
        preparation: _availablePreparation('canonical-id'),
      );
      final complete = _biteScoreRecord(
        documentId: 'complete-id',
        name: 'Prepared Place',
        preparation: _preparationState(
          'complete-id',
          ownerInvite: AdminRestaurantPreparationStatus.prepared,
          claimInvite: AdminRestaurantPreparationStatus.prepared,
          biteSaverCustomer: AdminRestaurantPreparationStatus.prepared,
          biteScoreCustomer: AdminRestaurantPreparationStatus.prepared,
        ),
      );
      await _pumpScreen(
        tester,
        qrBatchDependencies: qrBatchDependencies,
        search:
            ({
              required locationQuery,
              required radiusMiles,
              required restaurantName,
              required sources,
            }) async => _result(
              records: [
                canonical,
                canonical,
                complete,
                _biteScoreRecord(
                  documentId: 'inactive-id',
                  isActive: false,
                  preparation: _availablePreparation('inactive-id'),
                ),
                _biteScoreRecord(documentId: 'unavailable-id'),
                _biteScoreRecord(
                  documentId: ' invalid-id',
                  preparation: _availablePreparation(' invalid-id'),
                ),
                _biteScoreRecord(
                  documentId: 'mismatched-action',
                  actionId: 'different-action',
                  preparation: _availablePreparation('mismatched-action'),
                ),
                _biteSaverRecord(
                  documentId: 'bound-duplicate',
                  actionId: 'bound-account',
                  linkedBiteScoreRestaurantId: 'canonical-id',
                ),
                _biteSaverRecord(
                  documentId: 'standalone-saver',
                  actionId: 'standalone-account',
                ),
              ],
            ),
      );
      await _submitSearch(tester);

      expect(find.text('0 selected'), findsOneWidget);
      expect(
        tester
            .widget<FilledButton>(
              find.byKey(const ValueKey('admin-link-generate-qr-label-pdf')),
            )
            .onPressed,
        isNull,
      );
      expect(find.text('2 selectable of 9 loaded'), findsOneWidget);
      expect(
        find.bySemanticsLabel('Select Canonical Cafe for batch work'),
        findsNWidgets(2),
      );
      expect(
        find.bySemanticsLabel('Select Prepared Place for batch work'),
        findsOneWidget,
      );
      expect(
        find.byKey(
          const ValueKey('biteScore:inactive-id:batch-selection-unavailable'),
        ),
        findsOneWidget,
      );
      expect(
        find.byKey(
          const ValueKey(
            'biteScore:unavailable-id:batch-selection-unavailable',
          ),
        ),
        findsOneWidget,
      );
      expect(
        find.bySemanticsLabel('Batch selection unavailable'),
        findsNWidgets(4),
      );

      final saverCards = [
        find.byKey(
          const ValueKey('admin-link-record-biteSaver:bound-duplicate'),
        ),
        find.byKey(
          const ValueKey('admin-link-record-biteSaver:standalone-saver'),
        ),
      ];
      for (final card in saverCards) {
        expect(
          find.descendant(of: card, matching: find.byType(Checkbox)),
          findsNothing,
        );
      }

      final duplicateCheckboxes = find.byWidgetPredicate(
        (widget) =>
            widget is Checkbox &&
            widget.key is ValueKey<String> &&
            (widget.key! as ValueKey<String>).value.startsWith(
              'biteScore:canonical-id:batch-selection',
            ),
      );
      expect(duplicateCheckboxes, findsNWidgets(2));
      await tester.tap(duplicateCheckboxes.first);
      await tester.pump();
      expect(find.text('1 selected'), findsOneWidget);
      expect(
        tester
            .widget<FilledButton>(
              find.byKey(const ValueKey('admin-link-generate-qr-label-pdf')),
            )
            .onPressed,
        isNotNull,
      );
      expect(
        tester
            .widgetList<Checkbox>(duplicateCheckboxes)
            .map((box) => box.value),
        everyElement(isTrue),
      );
      await tester.tap(
        find.byKey(const ValueKey('admin-link-generate-qr-label-pdf')),
      );
      await tester.pump();
      expect(preparationCalls, 0);
      expect(preflightCalls, 0);
      expect(buildCalls, 0);
      expect(downloadCalls, 0);
      expect(markingCalls, 0);
      expect(find.byKey(const ValueKey('admin-qr-batch-dialog')), findsNothing);
      expect(find.textContaining('fresh Search'), findsOneWidget);

      await tester.tap(duplicateCheckboxes.last);
      await tester.pump();
      expect(find.text('0 selected'), findsOneWidget);
      expect(
        tester
            .widget<FilledButton>(
              find.byKey(const ValueKey('admin-link-generate-qr-label-pdf')),
            )
            .onPressed,
        isNull,
      );
      expect(
        tester
            .widgetList<Checkbox>(duplicateCheckboxes)
            .map((box) => box.value),
        everyElement(isFalse),
      );
      semantics.dispose();
    },
  );

  testWidgets('selection checkbox supports semantic tap in both states', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();
    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
          }) async => _result(
            records: [
              _biteScoreRecord(
                documentId: 'semantic-selection',
                name: 'Semantic Cafe',
                preparation: _availablePreparation('semantic-selection'),
              ),
            ],
          ),
    );
    await _submitSearch(tester);
    final selectionSemantics = find.semantics.byLabel(
      'Select Semantic Cafe for batch work',
    );
    expect(selectionSemantics, findsOneWidget);
    expect(
      selectionSemantics.evaluate().single,
      matchesSemantics(
        label: 'Select Semantic Cafe for batch work',
        hasCheckedState: true,
        hasEnabledState: true,
        isEnabled: true,
        hasTapAction: true,
      ),
    );

    tester.semantics.tap(selectionSemantics);
    await tester.pump();
    expect(find.text('1 selected'), findsOneWidget);
    expect(
      selectionSemantics.evaluate().single,
      matchesSemantics(
        label: 'Select Semantic Cafe for batch work',
        hasCheckedState: true,
        isChecked: true,
        hasEnabledState: true,
        isEnabled: true,
        hasTapAction: true,
      ),
    );

    tester.semantics.performAction(selectionSemantics, ui.SemanticsAction.tap);
    await tester.pump();
    expect(find.text('0 selected'), findsOneWidget);
    expect(
      selectionSemantics.evaluate().single,
      matchesSemantics(
        label: 'Select Semantic Cafe for batch work',
        hasCheckedState: true,
        hasEnabledState: true,
        isEnabled: true,
        hasTapAction: true,
      ),
    );
    semantics.dispose();
  });

  testWidgets(
    'Select All Loaded handles hundreds lazily without backend selection calls',
    (tester) async {
      var searchCalls = 0;
      var couponInviteCalls = 0;
      var claimInviteCalls = 0;
      var clipboardWrites = 0;
      var qrRenderCalls = 0;
      var qrCopyExports = 0;
      var qrDownloadExports = 0;
      var preparationCalls = 0;
      final records = <AdminRestaurantLinkRecord>[
        ...List.generate(
          205,
          (index) => _biteScoreRecord(
            documentId: 'bulk-${index.toString().padLeft(3, '0')}',
            name: 'Bulk Restaurant $index',
            preparation: _availablePreparation(
              'bulk-${index.toString().padLeft(3, '0')}',
            ),
            orderDistanceMillimeters: index,
          ),
        ),
        _biteScoreRecord(
          documentId: 'bulk-inactive',
          isActive: false,
          preparation: _availablePreparation('bulk-inactive'),
        ),
        _biteSaverRecord(
          documentId: 'bulk-saver',
          actionId: 'bulk-saver-account',
        ),
      ];
      await _pumpScreen(
        tester,
        search:
            ({
              required locationQuery,
              required radiusMiles,
              required restaurantName,
              required sources,
            }) async {
              searchCalls += 1;
              return _result(records: records);
            },
        createCouponInvite:
            ({
              required restaurantName,
              required restaurantId,
              required biteScoreCatalogRestaurantId,
              required streetAddress,
              required city,
              required state,
              required zipCode,
              required phone,
              required website,
              required latitude,
              required longitude,
            }) async {
              couponInviteCalls += 1;
              return _invite('https://go.bitestar.app/invite/coupon/unused');
            },
        createClaimInvite: ({required restaurantId}) async {
          claimInviteCalls += 1;
          return _invite('https://go.bitestar.app/invite/bitescore/unused');
        },
        writeClipboard: (_) async {
          clipboardWrites += 1;
        },
        renderQrImage:
            ({required restaurantName, required url, required linkType}) async {
              qrRenderCalls += 1;
              return _qrImage(restaurantName, linkType);
            },
        qrExporter: RestaurantQrExporter(
          capabilities: const RestaurantQrExportCapabilities(
            canCopyImage: true,
            canDownloadPng: true,
          ),
          copyPng: (_) async {
            qrCopyExports += 1;
          },
          downloadPng: (_, _) async {
            qrDownloadExports += 1;
          },
        ),
        updatePreparation:
            ({
              required catalogRestaurantId,
              required type,
              required prepared,
              required biteSaverCatalogBindingState,
              required claimState,
              expectedInviteId,
            }) async {
              preparationCalls += 1;
              return _availablePreparation(catalogRestaurantId);
            },
      );
      await _submitSearch(tester);

      final builtCards = find.byWidgetPredicate((widget) {
        final key = widget.key;
        return key is ValueKey<String> &&
            key.value.startsWith('admin-link-record-');
      });
      expect(builtCards.evaluate().length, lessThan(25));
      expect(find.text('205 selectable of 207 loaded'), findsOneWidget);

      final individual = find.byKey(
        const ValueKey('biteScore:bulk-000:batch-selection'),
      );
      await tester.tap(individual);
      await tester.pump();
      expect(find.text('1 selected'), findsOneWidget);
      await tester.tap(individual);
      await tester.pump();
      expect(find.text('0 selected'), findsOneWidget);

      await tester.tap(
        find.byKey(const ValueKey('admin-link-select-all-loaded')),
      );
      await tester.pump();
      expect(find.text('205 selected'), findsOneWidget);
      expect(searchCalls, 1);

      await tester.tap(find.byKey(const ValueKey('admin-link-deselect-all')));
      await tester.pump();
      expect(find.text('0 selected'), findsOneWidget);
      expect(
        (
          search: searchCalls,
          couponInvite: couponInviteCalls,
          claimInvite: claimInviteCalls,
          clipboard: clipboardWrites,
          qrRender: qrRenderCalls,
          qrCopyExport: qrCopyExports,
          qrDownloadExport: qrDownloadExports,
          preparation: preparationCalls,
        ),
        (
          search: 1,
          couponInvite: 0,
          claimInvite: 0,
          clipboard: 0,
          qrRender: 0,
          qrCopyExport: 0,
          qrDownloadExport: 0,
          preparation: 0,
        ),
      );
    },
  );

  testWidgets(
    'Load More keeps selection and Select All Loaded adds only new loaded IDs',
    (tester) async {
      var calls = 0;
      await _pumpPagedScreen(
        tester,
        search:
            ({
              required locationQuery,
              required radiusMiles,
              required restaurantName,
              required sources,
              required searchInstanceId,
              required clientRequestId,
              required needsQrPreparation,
              cursor,
              resolvedSearchCenter,
            }) async {
              calls += 1;
              return calls == 1
                  ? _pagedResult(
                      records: [
                        _selectableOrderedRecord('loaded-a', 0),
                        _selectableOrderedRecord('loaded-b', 1),
                      ],
                      hasNext: true,
                      nextCursor: _pageCursor('selection-next'),
                    )
                  : _pagedResult(
                      records: [
                        _selectableOrderedRecord('loaded-c', 2),
                        _selectableOrderedRecord('loaded-d', 3),
                      ],
                    );
            },
      );
      await _submitSearch(tester);
      await tester.tap(
        find.byKey(const ValueKey('admin-link-select-all-loaded')),
      );
      await tester.pump();
      expect(find.text('2 selected'), findsOneWidget);

      final loadMore = await _scrollToAdminKey(
        tester,
        const ValueKey('admin-link-load-more-button'),
      );
      await tester.tap(loadMore);
      await tester.pumpAndSettle();
      await _scrollToAdminKey(
        tester,
        const ValueKey('admin-link-selected-count'),
        delta: -700,
      );
      expect(find.text('2 selected'), findsOneWidget);
      final appended = await _scrollToAdminKey(
        tester,
        const ValueKey('biteScore:loaded-c:batch-selection'),
      );
      expect(tester.widget<Checkbox>(appended).value, isFalse);

      await _scrollToAdminKey(
        tester,
        const ValueKey('admin-link-select-all-loaded'),
        delta: -700,
      );
      await tester.tap(
        find.byKey(const ValueKey('admin-link-select-all-loaded')),
      );
      await tester.pump();
      expect(find.text('4 selected'), findsOneWidget);
      expect(calls, 2);
    },
  );

  testWidgets(
    'completed frozen marking reconciles selection and filtered rows after all work',
    (tester) async {
      var pageCalls = 0;
      final initialRecords = List<AdminRestaurantLinkRecord>.generate(
        30,
        (index) => _selectableOrderedRecord(
          'reconcile-${index.toString().padLeft(2, '0')}',
          index,
          name: 'Reconcile Restaurant $index',
        ),
      );
      final fontBytes = await rootBundle.load(
        RestaurantQrPdfService.fontAssetPath,
      );
      final pdfService = RestaurantQrPdfService(
        loadAsset: (_) async => fontBytes,
      );
      final dependencies = AdminRestaurantQrBatchDialogDependencies(
        prepare: (ids, onProgress) async => _batchPreparation(ids),
        retryPreparation: (previous, onProgress) async => previous,
        preflight: pdfService.preflight,
        buildPdf: (preflight) async => _batchPdfArtifact(preflight),
        downloadPdf: (bytes, filename) async =>
            const RestaurantQrPdfExportResult.initiated(),
        markPrepared: (worklist, onProgress) async =>
            _resolvedBatchMarking(worklist),
      );
      await _pumpPagedScreen(
        tester,
        qrBatchDependencies: dependencies,
        search:
            ({
              required locationQuery,
              required radiusMiles,
              required restaurantName,
              required sources,
              required searchInstanceId,
              required clientRequestId,
              required needsQrPreparation,
              cursor,
              resolvedSearchCenter,
            }) async {
              pageCalls += 1;
              expect(needsQrPreparation, isTrue);
              if (pageCalls == 1) {
                return _pagedResult(
                  records: initialRecords,
                  hasNext: true,
                  nextCursor: _pageCursor('reconcile-next'),
                  needsQrPreparation: true,
                );
              }
              return _pagedResult(
                records: <AdminRestaurantLinkRecord>[
                  _selectableOrderedRecord(
                    'reconcile-appended',
                    30,
                    name: 'Reconcile Appended',
                  ),
                ],
                needsQrPreparation: true,
              );
            },
      );
      final filter = await _scrollToAdminKey(
        tester,
        const ValueKey('admin-link-filter-needs-qr-preparation'),
        delta: -600,
      );
      await tester.tap(filter);
      await tester.pump();
      await _submitSearch(tester);

      for (final id in <String>['reconcile-20', 'reconcile-21']) {
        final checkbox = await _scrollToAdminKey(
          tester,
          ValueKey<String>('biteScore:$id:batch-selection'),
        );
        await tester.tap(checkbox);
        await tester.pump();
      }
      final generate = await _scrollToAdminKey(
        tester,
        const ValueKey('admin-link-generate-qr-label-pdf'),
        delta: -700,
      );
      final listState = tester.state<ScrollableState>(
        find
            .descendant(
              of: find.byKey(
                const ValueKey('admin-link-generation-scroll-view'),
              ),
              matching: find.byType(Scrollable),
            )
            .first,
      );
      final offsetBeforeBatch = listState.position.pixels;
      expect(offsetBeforeBatch, greaterThan(0));

      await tester.tap(generate);
      for (
        var pump = 0;
        pump < 100 && find.text('PDF ready').evaluate().isEmpty;
        pump += 1
      ) {
        await tester.pump(const Duration(milliseconds: 10));
      }
      expect(find.text('PDF ready'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('admin-qr-batch-download')));
      for (
        var pump = 0;
        pump < 100 && find.text('Completed').evaluate().isEmpty;
        pump += 1
      ) {
        await tester.pump(const Duration(milliseconds: 10));
      }
      expect(find.text('Completed'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('admin-qr-batch-close')));
      await tester.pumpAndSettle();

      expect(listState.position.pixels, closeTo(offsetBeforeBatch, 0.1));
      await _scrollToAdminKey(
        tester,
        const ValueKey('admin-link-selected-count'),
        delta: -700,
      );
      expect(find.text('0 selected'), findsOneWidget);
      expect(find.textContaining('28 restaurant records near'), findsOneWidget);

      final loadMore = await _scrollToAdminKey(
        tester,
        const ValueKey('admin-link-load-more-button'),
      );
      await tester.tap(loadMore);
      await tester.pumpAndSettle();
      expect(pageCalls, 2);
      expect(find.text('Reconcile Appended'), findsOneWidget);
    },
  );

  testWidgets(
    'complete unresolved projection stays visible and selected until resolved',
    (tester) async {
      final preparedIdsByCall = <List<String>>[];
      final prepared = _batchPreparation(const ['mixed-a', 'mixed-b']);
      final preparation = AdminRestaurantQrPreparationRunResult(
        requestedCatalogRestaurantIds: const ['mixed-a', 'mixed-b', 'mixed-c'],
        results: <AdminRestaurantQrRestaurantResult>[
          ...prepared.results,
          AdminRestaurantQrProblemRestaurant(
            catalogRestaurantId: 'mixed-c',
            outcome: AdminRestaurantQrProblemOutcome.unavailable,
            code: 'restaurant_unavailable',
            message: 'This restaurant is not currently available.',
          ),
        ],
      );
      final fontBytes = await rootBundle.load(
        RestaurantQrPdfService.fontAssetPath,
      );
      final pdfService = RestaurantQrPdfService(
        loadAsset: (_) async => fontBytes,
      );
      final dependencies = AdminRestaurantQrBatchDialogDependencies(
        prepare: (ids, onProgress) async {
          final frozenIds = List<String>.unmodifiable(ids);
          preparedIdsByCall.add(frozenIds);
          if (preparedIdsByCall.length == 1) {
            return preparation;
          }
          return AdminRestaurantQrPreparationRunResult(
            requestedCatalogRestaurantIds: frozenIds,
            results: <AdminRestaurantQrRestaurantResult>[
              for (final id in frozenIds)
                AdminRestaurantQrProblemRestaurant(
                  catalogRestaurantId: id,
                  outcome: AdminRestaurantQrProblemOutcome.unavailable,
                  code: 'restaurant_unavailable',
                  message: 'This restaurant is not currently available.',
                ),
            ],
          );
        },
        retryPreparation: (previous, onProgress) async => previous,
        preflight: pdfService.preflight,
        buildPdf: (preflight) async => _batchPdfArtifact(preflight),
        downloadPdf: (bytes, filename) async =>
            const RestaurantQrPdfExportResult.initiated(),
        markPrepared: (worklist, onProgress) async => _resolvedBatchMarking(
          worklist,
          failedCatalogRestaurantIds: const {'mixed-a'},
          completeProjectionForFailedCatalogRestaurantIds: const {'mixed-a'},
          incompatibleNotRequiredProjectionForFailedCatalogRestaurantIds:
              const {'mixed-a'},
        ),
      );
      await _pumpScreen(
        tester,
        qrBatchDependencies: dependencies,
        search:
            ({
              required locationQuery,
              required radiusMiles,
              required restaurantName,
              required sources,
            }) async => _result(
              records: <AdminRestaurantLinkRecord>[
                _selectableOrderedRecord('mixed-a', 0, name: 'Mixed A'),
                _selectableOrderedRecord('mixed-b', 1, name: 'Mixed B'),
                _selectableOrderedRecord('mixed-c', 2, name: 'Mixed C'),
              ],
            ),
      );
      await tester.tap(
        find.byKey(const ValueKey('admin-link-filter-needs-qr-preparation')),
      );
      await tester.pump();
      await _submitSearch(tester);
      await tester.tap(
        find.byKey(const ValueKey('admin-link-select-all-loaded')),
      );
      await tester.pump();
      expect(find.text('3 selected'), findsOneWidget);

      await tester.tap(
        find.byKey(const ValueKey('admin-link-generate-qr-label-pdf')),
      );
      for (
        var pump = 0;
        pump < 100 &&
            find
                .byKey(const ValueKey('admin-qr-batch-export-valid'))
                .evaluate()
                .isEmpty;
        pump += 1
      ) {
        await tester.pump(const Duration(milliseconds: 10));
      }
      await tester.tap(
        find.byKey(const ValueKey('admin-qr-batch-export-valid')),
      );
      for (
        var pump = 0;
        pump < 100 && find.text('PDF ready').evaluate().isEmpty;
        pump += 1
      ) {
        await tester.pump(const Duration(milliseconds: 10));
      }
      await tester.tap(find.byKey(const ValueKey('admin-qr-batch-download')));
      for (
        var pump = 0;
        pump < 100 && find.text('Status saving incomplete').evaluate().isEmpty;
        pump += 1
      ) {
        await tester.pump(const Duration(milliseconds: 10));
      }
      expect(find.text('Status saving incomplete'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('admin-qr-batch-close')));
      for (
        var pump = 0;
        pump < 100 &&
            find
                .byKey(const ValueKey('admin-qr-batch-close-warning'))
                .evaluate()
                .isEmpty;
        pump += 1
      ) {
        await tester.pump(const Duration(milliseconds: 10));
      }
      expect(
        find.byKey(const ValueKey('admin-qr-batch-close-warning')),
        findsOneWidget,
      );
      await tester.tap(
        find.byKey(const ValueKey('admin-qr-batch-close-anyway')),
      );
      for (
        var pump = 0;
        pump < 100 &&
            find
                .byKey(const ValueKey('admin-qr-batch-dialog'))
                .evaluate()
                .isNotEmpty;
        pump += 1
      ) {
        await tester.pump(const Duration(milliseconds: 10));
      }
      expect(find.byKey(const ValueKey('admin-qr-batch-dialog')), findsNothing);

      expect(find.text('2 selected'), findsOneWidget);
      expect(find.textContaining('2 restaurant records near'), findsOneWidget);
      final retainedMixedA = tester.widget<Checkbox>(
        find.byKey(const ValueKey('biteScore:mixed-a:batch-selection')),
      );
      expect(retainedMixedA.value, isTrue);
      expect(retainedMixedA.onChanged, isNotNull);
      final retainedMixedACard = find.byKey(
        const ValueKey('admin-link-record-biteScore:mixed-a'),
      );
      expect(
        find.descendant(
          of: retainedMixedACard,
          matching: find.text('I · Unprepared'),
        ),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: retainedMixedACard,
          matching: find.text('C · Unprepared'),
        ),
        findsOneWidget,
      );
      expect(
        find.descendant(of: retainedMixedACard, matching: find.text('I · N/R')),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('biteScore:mixed-b:batch-selection')),
        findsNothing,
      );
      expect(
        tester
            .widget<Checkbox>(
              find.byKey(const ValueKey('biteScore:mixed-c:batch-selection')),
            )
            .value,
        isTrue,
      );
      expect(preparedIdsByCall, <List<String>>[
        <String>['mixed-a', 'mixed-b', 'mixed-c'],
      ]);

      final generate = find.byKey(
        const ValueKey('admin-link-generate-qr-label-pdf'),
      );
      expect(tester.widget<FilledButton>(generate).onPressed, isNotNull);
      await tester.tap(generate);
      for (
        var pump = 0;
        pump < 100 &&
            find
                .byKey(const ValueKey('admin-qr-batch-cancel'))
                .evaluate()
                .isEmpty;
        pump += 1
      ) {
        await tester.pump(const Duration(milliseconds: 10));
      }
      expect(preparedIdsByCall, <List<String>>[
        <String>['mixed-a', 'mixed-b', 'mixed-c'],
        <String>['mixed-a', 'mixed-c'],
      ]);
      expect(
        tester
            .widget<Checkbox>(
              find.byKey(const ValueKey('biteScore:mixed-a:batch-selection')),
            )
            .value,
        isTrue,
      );
      expect(
        tester
            .widget<Checkbox>(
              find.byKey(const ValueKey('biteScore:mixed-c:batch-selection')),
            )
            .value,
        isTrue,
      );
      await tester.tap(find.byKey(const ValueKey('admin-qr-batch-cancel')));
      for (
        var pump = 0;
        pump < 100 &&
            find
                .byKey(const ValueKey('admin-qr-batch-dialog'))
                .evaluate()
                .isNotEmpty;
        pump += 1
      ) {
        await tester.pump(const Duration(milliseconds: 10));
      }
      expect(find.byKey(const ValueKey('admin-qr-batch-dialog')), findsNothing);
    },
  );

  testWidgets(
    'successful status retry suppresses the previously unresolved complete row',
    (tester) async {
      var markingCalls = 0;
      final markingWorklists = <AdminRestaurantQrMarkingWorklist>[];
      final fontBytes = await rootBundle.load(
        RestaurantQrPdfService.fontAssetPath,
      );
      final pdfService = RestaurantQrPdfService(
        loadAsset: (_) async => fontBytes,
      );
      final dependencies = AdminRestaurantQrBatchDialogDependencies(
        prepare: (ids, onProgress) async => _batchPreparation(ids),
        retryPreparation: (previous, onProgress) async => previous,
        preflight: pdfService.preflight,
        buildPdf: (preflight) async => _batchPdfArtifact(preflight),
        downloadPdf: (bytes, filename) async =>
            const RestaurantQrPdfExportResult.initiated(),
        markPrepared: (worklist, onProgress) async {
          markingCalls += 1;
          markingWorklists.add(worklist);
          if (markingCalls == 1) {
            return _resolvedBatchMarking(
              worklist,
              failedCatalogRestaurantIds: const {'retry-status-a'},
              completeProjectionForFailedCatalogRestaurantIds: const {
                'retry-status-a',
              },
              incompatibleNotRequiredProjectionForFailedCatalogRestaurantIds:
                  const {'retry-status-a'},
            );
          }
          return _resolvedBatchMarking(worklist);
        },
      );
      await _pumpScreen(
        tester,
        qrBatchDependencies: dependencies,
        search:
            ({
              required locationQuery,
              required radiusMiles,
              required restaurantName,
              required sources,
            }) async => _result(
              records: <AdminRestaurantLinkRecord>[
                _selectableOrderedRecord(
                  'retry-status-a',
                  0,
                  name: 'Retry Status A',
                ),
                _selectableOrderedRecord(
                  'retry-status-b',
                  1,
                  name: 'Retry Status B',
                ),
                _selectableOrderedRecord(
                  'retry-status-peer',
                  2,
                  name: 'Retry Status Peer',
                ),
              ],
            ),
      );
      await tester.tap(
        find.byKey(const ValueKey('admin-link-filter-needs-qr-preparation')),
      );
      await tester.pump();
      await _submitSearch(tester);
      for (final id in const ['retry-status-a', 'retry-status-b']) {
        await tester.tap(find.byKey(ValueKey('biteScore:$id:batch-selection')));
        await tester.pump();
      }
      expect(find.text('2 selected'), findsOneWidget);

      await tester.tap(
        find.byKey(const ValueKey('admin-link-generate-qr-label-pdf')),
      );
      for (
        var pump = 0;
        pump < 100 && find.text('PDF ready').evaluate().isEmpty;
        pump += 1
      ) {
        await tester.pump(const Duration(milliseconds: 10));
      }
      expect(find.text('PDF ready'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('admin-qr-batch-download')));
      for (
        var pump = 0;
        pump < 100 && find.text('Status saving incomplete').evaluate().isEmpty;
        pump += 1
      ) {
        await tester.pump(const Duration(milliseconds: 10));
      }
      expect(find.text('Status saving incomplete'), findsOneWidget);
      expect(markingCalls, 1);

      await tester.tap(
        find.byKey(const ValueKey('admin-qr-batch-retry-status')),
      );
      for (
        var pump = 0;
        pump < 100 && find.text('Completed').evaluate().isEmpty;
        pump += 1
      ) {
        await tester.pump(const Duration(milliseconds: 10));
      }
      expect(find.text('Completed'), findsOneWidget);
      expect(markingCalls, 2);
      expect(markingWorklists.last.restaurantCount, 1);
      expect(
        markingWorklists.last.restaurants.single.catalogRestaurantId,
        'retry-status-a',
      );
      expect(markingWorklists.last.labelCount, 1);

      await tester.tap(find.byKey(const ValueKey('admin-qr-batch-close')));
      await tester.pumpAndSettle();

      expect(find.text('0 selected'), findsOneWidget);
      expect(find.textContaining('1 restaurant record near'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('biteScore:retry-status-a:batch-selection')),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('biteScore:retry-status-b:batch-selection')),
        findsNothing,
      );
      expect(
        tester
            .widget<Checkbox>(
              find.byKey(
                const ValueKey('biteScore:retry-status-peer:batch-selection'),
              ),
            )
            .value,
        isFalse,
      );
    },
  );

  testWidgets(
    'unresolved reconciliation preserves paging warning boundary and scroll',
    (tester) async {
      const unresolvedId = 'continuity-20';
      const resolvedId = 'continuity-21';
      final continuationCursor = _pageCursor('batch-reconciliation-next');
      final receivedCursors = <String?>[];
      final initialRecords = List<AdminRestaurantLinkRecord>.generate(
        50,
        (index) => _selectableOrderedRecord(
          'continuity-${index.toString().padLeft(2, '0')}',
          index,
          name: 'Continuity Restaurant $index',
        ),
      );
      final initialBoundary = initialRecords.last.materializedOrder!;
      final fontBytes = await rootBundle.load(
        RestaurantQrPdfService.fontAssetPath,
      );
      final pdfService = RestaurantQrPdfService(
        loadAsset: (_) async => fontBytes,
      );
      final dependencies = AdminRestaurantQrBatchDialogDependencies(
        prepare: (ids, onProgress) async => _batchPreparation(ids),
        retryPreparation: (previous, onProgress) async => previous,
        preflight: pdfService.preflight,
        buildPdf: (preflight) async => _batchPdfArtifact(preflight),
        downloadPdf: (bytes, filename) async =>
            const RestaurantQrPdfExportResult.initiated(),
        markPrepared: (worklist, onProgress) async => _resolvedBatchMarking(
          worklist,
          failedCatalogRestaurantIds: const {unresolvedId},
          completeProjectionForFailedCatalogRestaurantIds: const {unresolvedId},
        ),
      );
      await _pumpPagedScreen(
        tester,
        qrBatchDependencies: dependencies,
        search:
            ({
              required locationQuery,
              required radiusMiles,
              required restaurantName,
              required sources,
              required searchInstanceId,
              required clientRequestId,
              required needsQrPreparation,
              cursor,
              resolvedSearchCenter,
            }) async {
              receivedCursors.add(cursor);
              expect(needsQrPreparation, isTrue);
              if (receivedCursors.length == 1) {
                expect(cursor, isNull);
                expect(resolvedSearchCenter, isNull);
                return _pagedResult(
                  records: initialRecords,
                  hasNext: true,
                  nextCursor: continuationCursor,
                  needsQrPreparation: true,
                  preparationUnavailableEncountered: true,
                );
              }
              expect(cursor, continuationCursor);
              expect(resolvedSearchCenter?.displayName, 'Crystal River, FL');
              final appended = _selectableOrderedRecord(
                'continuity-appended',
                50,
                name: 'Continuity Appended',
              );
              expect(
                appended.materializedOrder!.compareTo(initialBoundary),
                greaterThan(0),
              );
              return _pagedResult(
                records: <AdminRestaurantLinkRecord>[appended],
                needsQrPreparation: true,
              );
            },
      );
      await tester.tap(
        find.byKey(const ValueKey('admin-link-filter-needs-qr-preparation')),
      );
      await tester.pump();
      await _submitSearch(tester);
      expect(
        find.byKey(
          const ValueKey('admin-link-preparation-unavailable-warning'),
        ),
        findsOneWidget,
      );

      for (final id in const [unresolvedId, resolvedId]) {
        final checkbox = await _scrollToAdminKey(
          tester,
          ValueKey<String>('biteScore:$id:batch-selection'),
        );
        await tester.tap(checkbox);
        await tester.pump();
      }
      final generate = await _scrollToAdminKey(
        tester,
        const ValueKey('admin-link-generate-qr-label-pdf'),
        delta: -700,
      );
      final listFinder = find.byKey(
        const ValueKey('admin-link-generation-scroll-view'),
      );
      final controller = tester.widget<ListView>(listFinder).controller!;
      final offsetBeforeBatch = controller.offset;
      expect(offsetBeforeBatch, greaterThan(0));

      await tester.tap(generate);
      for (
        var pump = 0;
        pump < 100 && find.text('PDF ready').evaluate().isEmpty;
        pump += 1
      ) {
        await tester.pump(const Duration(milliseconds: 10));
      }
      expect(find.text('PDF ready'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('admin-qr-batch-download')));
      for (
        var pump = 0;
        pump < 100 && find.text('Status saving incomplete').evaluate().isEmpty;
        pump += 1
      ) {
        await tester.pump(const Duration(milliseconds: 10));
      }
      expect(find.text('Status saving incomplete'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('admin-qr-batch-close')));
      for (
        var pump = 0;
        pump < 100 &&
            find
                .byKey(const ValueKey('admin-qr-batch-close-warning'))
                .evaluate()
                .isEmpty;
        pump += 1
      ) {
        await tester.pump(const Duration(milliseconds: 10));
      }
      await tester.tap(
        find.byKey(const ValueKey('admin-qr-batch-close-anyway')),
      );
      for (
        var pump = 0;
        pump < 100 &&
            find
                .byKey(const ValueKey('admin-qr-batch-dialog'))
                .evaluate()
                .isNotEmpty;
        pump += 1
      ) {
        await tester.pump(const Duration(milliseconds: 10));
      }
      expect(find.byKey(const ValueKey('admin-qr-batch-dialog')), findsNothing);

      expect(tester.widget<ListView>(listFinder).controller, same(controller));
      expect(controller.offset, closeTo(offsetBeforeBatch, 0.5));
      expect(find.text('1 selected'), findsOneWidget);
      expect(
        find.byKey(
          const ValueKey('admin-link-preparation-unavailable-warning'),
        ),
        findsOneWidget,
      );
      final unresolved = await _scrollToAdminKey(
        tester,
        const ValueKey('biteScore:continuity-20:batch-selection'),
      );
      expect(tester.widget<Checkbox>(unresolved).value, isTrue);
      expect(
        find.byKey(const ValueKey('biteScore:continuity-21:batch-selection')),
        findsNothing,
      );

      final loadMore = await _scrollToAdminKey(
        tester,
        const ValueKey('admin-link-load-more-button'),
      );
      expect(find.text('Load More'), findsOneWidget);
      expect(tester.widget<OutlinedButton>(loadMore).onPressed, isNotNull);
      await tester.tap(loadMore);
      await tester.pumpAndSettle();

      expect(receivedCursors, <String?>[null, continuationCursor]);
      expect(find.textContaining('invalid continuation'), findsNothing);
      expect(find.text('Continuity Appended'), findsOneWidget);
      await _scrollToAdminKey(
        tester,
        const ValueKey('admin-link-preparation-unavailable-warning'),
        delta: -700,
      );
      expect(find.text('1 selected'), findsOneWidget);
    },
  );

  testWidgets(
    'older batch reconciliation is ignored after a newer search starts',
    (tester) async {
      const sharedId = 'generation-shared';
      final searchedLocations = <String>[];
      final fontBytes = await rootBundle.load(
        RestaurantQrPdfService.fontAssetPath,
      );
      final pdfService = RestaurantQrPdfService(
        loadAsset: (_) async => fontBytes,
      );
      final dependencies = AdminRestaurantQrBatchDialogDependencies(
        prepare: (ids, onProgress) async => _batchPreparation(ids),
        retryPreparation: (previous, onProgress) async => previous,
        preflight: pdfService.preflight,
        buildPdf: (preflight) async => _batchPdfArtifact(preflight),
        downloadPdf: (bytes, filename) async =>
            const RestaurantQrPdfExportResult.initiated(),
        markPrepared: (worklist, onProgress) async =>
            _resolvedBatchMarking(worklist),
      );
      await _pumpScreen(
        tester,
        qrBatchDependencies: dependencies,
        search:
            ({
              required locationQuery,
              required radiusMiles,
              required restaurantName,
              required sources,
            }) async {
              searchedLocations.add(locationQuery);
              return _result(
                records: <AdminRestaurantLinkRecord>[
                  _selectableOrderedRecord(
                    sharedId,
                    0,
                    name: searchedLocations.length == 1
                        ? 'Old Generation Restaurant'
                        : 'New Generation Restaurant',
                  ),
                ],
              );
            },
      );
      await tester.tap(
        find.byKey(const ValueKey('admin-link-filter-needs-qr-preparation')),
      );
      await tester.pump();
      await _submitSearch(tester);
      await tester.tap(
        find.byKey(const ValueKey('biteScore:$sharedId:batch-selection')),
      );
      await tester.pump();
      await tester.tap(
        find.byKey(const ValueKey('admin-link-generate-qr-label-pdf')),
      );
      for (
        var pump = 0;
        pump < 100 && find.text('PDF ready').evaluate().isEmpty;
        pump += 1
      ) {
        await tester.pump(const Duration(milliseconds: 10));
      }
      await tester.tap(find.byKey(const ValueKey('admin-qr-batch-download')));
      for (
        var pump = 0;
        pump < 100 && find.text('Completed').evaluate().isEmpty;
        pump += 1
      ) {
        await tester.pump(const Duration(milliseconds: 10));
      }
      expect(find.text('Completed'), findsOneWidget);

      final locationField = tester.widget<TextFormField>(
        find.byKey(const ValueKey('admin-link-location-field')),
      );
      final searchButton = tester.widget<FilledButton>(
        find.byKey(const ValueKey('admin-link-search-button')),
      );
      final closeButton = tester.widget<TextButton>(
        find.byKey(const ValueKey('admin-qr-batch-close')),
      );
      closeButton.onPressed!();
      locationField.controller!.text = '10001';
      locationField.onChanged!('10001');
      searchButton.onPressed!();
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('admin-qr-batch-dialog')), findsNothing);
      expect(searchedLocations, <String>['34428', '10001']);
      expect(find.text('Old Generation Restaurant'), findsNothing);
      expect(find.text('New Generation Restaurant'), findsOneWidget);
      expect(find.text('0 selected'), findsOneWidget);
      final freshSelection = find.byKey(
        const ValueKey('biteScore:generation-shared:batch-selection'),
      );
      expect(tester.widget<Checkbox>(freshSelection).value, isFalse);
      expect(tester.widget<Checkbox>(freshSelection).onChanged, isNotNull);
      expect(
        tester
            .widget<FilterChip>(
              find.byKey(
                const ValueKey('biteScore:generation-shared:preparation-I'),
              ),
            )
            .selected,
        isFalse,
      );
    },
  );

  testWidgets('append failure and exact retry preserve existing selection', (
    tester,
  ) async {
    var calls = 0;
    await _pumpPagedScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
            required searchInstanceId,
            required clientRequestId,
            required needsQrPreparation,
            cursor,
            resolvedSearchCenter,
          }) async {
            calls += 1;
            if (calls == 1) {
              return _pagedResult(
                records: [_selectableOrderedRecord('retry-selected', 0)],
                hasNext: true,
                nextCursor: _pageCursor('selection-retry'),
              );
            }
            if (calls == 2) {
              throw const AdminLinkGenerationException('Append failed.');
            }
            return _pagedResult(
              records: [_selectableOrderedRecord('retry-appended', 1)],
            );
          },
    );
    await _submitSearch(tester);
    await tester.tap(
      find.byKey(const ValueKey('biteScore:retry-selected:batch-selection')),
    );
    await tester.pump();

    var loadMore = await _scrollToAdminKey(
      tester,
      const ValueKey('admin-link-load-more-button'),
    );
    await tester.tap(loadMore);
    await tester.pumpAndSettle();
    expect(find.text('1 selected'), findsOneWidget);
    expect(find.text('Retry Load More'), findsOneWidget);

    loadMore = await _scrollToAdminKey(
      tester,
      const ValueKey('admin-link-load-more-button'),
    );
    await tester.tap(loadMore);
    await tester.pumpAndSettle();
    expect(find.text('1 selected'), findsOneWidget);
    expect(calls, 3);
  });

  testWidgets(
    'expired search keeps rows and selection but permits only deselection',
    (tester) async {
      final semantics = tester.ensureSemantics();
      var calls = 0;
      await _pumpPagedScreen(
        tester,
        search:
            ({
              required locationQuery,
              required radiusMiles,
              required restaurantName,
              required sources,
              required searchInstanceId,
              required clientRequestId,
              required needsQrPreparation,
              cursor,
              resolvedSearchCenter,
            }) async {
              calls += 1;
              if (calls == 1) {
                return _pagedResult(
                  records: [
                    _selectableOrderedRecord('expiry-a', 0, name: 'Expiry A'),
                    _selectableOrderedRecord('expiry-b', 1, name: 'Expiry B'),
                    _selectableOrderedRecord('expiry-c', 2, name: 'Expiry C'),
                    _selectableOrderedRecord('expiry-d', 3, name: 'Expiry D'),
                  ],
                  hasNext: true,
                  nextCursor: _pageCursor('selection-expiry'),
                );
              }
              if (calls == 2) {
                throw const AdminLinkSearchExpiredException();
              }
              return _pagedResult(
                records: [_selectableOrderedRecord('expiry-fresh', 0)],
              );
            },
      );
      await _submitSearch(tester);
      for (final id in ['expiry-a', 'expiry-c', 'expiry-d']) {
        final selection = await _scrollToAdminKey(
          tester,
          ValueKey('biteScore:$id:batch-selection'),
        );
        await tester.tap(selection);
        await tester.pump();
      }
      await _scrollToAdminKey(
        tester,
        const ValueKey('admin-link-selected-count'),
        delta: -700,
      );
      expect(find.text('3 selected'), findsOneWidget);

      final loadMore = await _scrollToAdminKey(
        tester,
        const ValueKey('admin-link-load-more-button'),
      );
      await tester.tap(loadMore);
      await tester.pumpAndSettle();
      await _scrollToAdminKey(
        tester,
        const ValueKey('admin-link-selected-count'),
        delta: -700,
      );
      expect(
        find.byKey(const ValueKey('admin-link-expired-state')),
        findsOneWidget,
      );
      expect(find.text('3 selected'), findsOneWidget);
      expect(
        tester
            .widget<OutlinedButton>(
              find.byKey(const ValueKey('admin-link-select-all-loaded')),
            )
            .onPressed,
        isNull,
      );
      expect(
        tester
            .widget<FilledButton>(
              find.byKey(const ValueKey('admin-link-generate-qr-label-pdf')),
            )
            .onPressed,
        isNotNull,
      );

      final expiryA = await _scrollToAdminKey(
        tester,
        const ValueKey('biteScore:expiry-a:batch-selection'),
      );
      expect(tester.widget<Checkbox>(expiryA).value, isTrue);
      await tester.tap(expiryA);
      await tester.pump();

      final expiryB = await _scrollToAdminKey(
        tester,
        const ValueKey('biteScore:expiry-b:batch-selection-unavailable'),
      );
      expect(tester.widget<Checkbox>(expiryB).value, isFalse);
      expect(tester.widget<Checkbox>(expiryB).onChanged, isNull);
      final expiryBSemantics = tester.getSemantics(expiryB);
      expect(
        expiryBSemantics.getSemanticsData().hasAction(ui.SemanticsAction.tap),
        isFalse,
      );
      expect(
        expiryBSemantics.getSemanticsData().flagsCollection.isEnabled,
        ui.Tristate.isFalse,
      );
      await tester.tap(expiryB);
      await tester.pump();

      await _scrollToAdminKey(
        tester,
        const ValueKey('admin-link-selected-count'),
        delta: -700,
      );
      expect(find.text('2 selected'), findsOneWidget);

      await _scrollToAdminKey(
        tester,
        const ValueKey('biteScore:expiry-c:batch-selection'),
      );
      final expiryCSemantics = find.semantics.byLabel(
        'Select Expiry C for batch work',
      );
      expect(expiryCSemantics, findsOneWidget);
      tester.semantics.tap(expiryCSemantics);
      await tester.pump();
      await _scrollToAdminKey(
        tester,
        const ValueKey('admin-link-selected-count'),
        delta: -700,
      );
      expect(find.text('1 selected'), findsOneWidget);
      expect(
        tester
            .widget<TextButton>(
              find.byKey(const ValueKey('admin-link-deselect-all')),
            )
            .onPressed,
        isNotNull,
      );
      await tester.tap(find.byKey(const ValueKey('admin-link-deselect-all')));
      await tester.pump();
      expect(find.text('0 selected'), findsOneWidget);

      final searchAgain = await _scrollToAdminKey(
        tester,
        const ValueKey('admin-link-expired-search-button'),
        delta: -700,
      );
      await tester.tap(searchAgain);
      await tester.pumpAndSettle();
      expect(find.text('0 selected'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('admin-link-record-biteScore:expiry-fresh')),
        findsOneWidget,
      );
      semantics.dispose();
    },
  );

  testWidgets('all criteria edits immediately clear results and selection', (
    tester,
  ) async {
    var calls = 0;
    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
          }) async {
            calls += 1;
            return _result(
              records: [
                _biteScoreRecord(
                  documentId: 'criteria-$calls',
                  preparation: _availablePreparation('criteria-$calls'),
                ),
              ],
            );
          },
    );

    Future<void> searchAndSelect({String location = '34428'}) async {
      await _submitSearch(tester, location: location);
      final selection = find.byKey(
        ValueKey('biteScore:criteria-$calls:batch-selection'),
      );
      await tester.tap(selection);
      await tester.pump();
      expect(find.text('1 selected'), findsOneWidget);
    }

    VoidCallback captureDeselectAll() => tester
        .widget<TextButton>(
          find.byKey(const ValueKey('admin-link-deselect-all')),
        )
        .onPressed!;

    void expectSelectionWasAlreadyCleared(VoidCallback deselectAll) {
      final screenElement = tester.element(
        find.byType(AdminLinkGenerationScreen),
      );
      expect(screenElement.dirty, isFalse);
      deselectAll();
      expect(
        screenElement.dirty,
        isFalse,
        reason: 'Deselect All must already be a no-op after the edit.',
      );
    }

    await searchAndSelect();
    var deselectAll = captureDeselectAll();
    var callsBeforeEdit = calls;
    await tester.enterText(
      find.byKey(const ValueKey('admin-link-location-field')),
      '34429',
    );
    await tester.pump();
    expect(calls, callsBeforeEdit);
    expect(
      tester
          .widget<TextFormField>(
            find.byKey(const ValueKey('admin-link-location-field')),
          )
          .controller!
          .text,
      '34429',
    );
    expectSelectionWasAlreadyCleared(deselectAll);
    expect(
      find.byKey(const ValueKey('admin-link-initial-state')),
      findsOneWidget,
    );

    await searchAndSelect(location: '34429');
    deselectAll = captureDeselectAll();
    callsBeforeEdit = calls;
    await tester.enterText(
      find.byKey(const ValueKey('admin-link-restaurant-name-field')),
      'Fresh Name',
    );
    await tester.pump();
    expect(calls, callsBeforeEdit);
    expect(
      tester
          .widget<TextFormField>(
            find.byKey(const ValueKey('admin-link-restaurant-name-field')),
          )
          .controller!
          .text,
      'Fresh Name',
    );
    expectSelectionWasAlreadyCleared(deselectAll);
    expect(
      find.byKey(const ValueKey('admin-link-initial-state')),
      findsOneWidget,
    );

    await searchAndSelect(location: '34429');
    deselectAll = captureDeselectAll();
    callsBeforeEdit = calls;
    await tester.tap(find.byKey(const ValueKey('admin-link-radius-field')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('20 miles').last);
    await tester.pumpAndSettle();
    expect(calls, callsBeforeEdit);
    expectSelectionWasAlreadyCleared(deselectAll);
    expect(
      tester
          .widget<DropdownButtonFormField<int>>(
            find.byKey(const ValueKey('admin-link-radius-field')),
          )
          .initialValue,
      20,
    );
    expect(
      find.byKey(const ValueKey('admin-link-initial-state')),
      findsOneWidget,
    );

    await searchAndSelect(location: '34429');
    deselectAll = captureDeselectAll();
    callsBeforeEdit = calls;
    await tester.tap(find.byKey(const ValueKey('admin-link-source-biteSaver')));
    await tester.pump();
    expect(calls, callsBeforeEdit);
    expect(
      tester
          .widget<FilterChip>(
            find.byKey(const ValueKey('admin-link-source-biteSaver')),
          )
          .selected,
      isFalse,
    );
    expectSelectionWasAlreadyCleared(deselectAll);
    expect(
      find.byKey(const ValueKey('admin-link-initial-state')),
      findsOneWidget,
    );

    await searchAndSelect(location: '34429');
    deselectAll = captureDeselectAll();
    callsBeforeEdit = calls;
    await tester.tap(
      find.byKey(const ValueKey('admin-link-filter-needs-qr-preparation')),
    );
    await tester.pump();
    expect(calls, callsBeforeEdit);
    expect(
      tester
          .widget<FilterChip>(
            find.byKey(
              const ValueKey('admin-link-filter-needs-qr-preparation'),
            ),
          )
          .selected,
      isTrue,
    );
    expectSelectionWasAlreadyCleared(deselectAll);
    expect(
      find.byKey(const ValueKey('admin-link-initial-state')),
      findsOneWidget,
    );

    await _submitSearch(tester, location: '34429');
    expect(find.text('0 selected'), findsOneWidget);
  });

  testWidgets('new explicit Search clears selection before its response', (
    tester,
  ) async {
    final nextSearch = Completer<AdminRestaurantLinkSearchResult>();
    var calls = 0;
    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
          }) {
            calls += 1;
            if (calls == 1) {
              return Future.value(
                _result(
                  records: [
                    _biteScoreRecord(
                      documentId: 'old-explicit',
                      preparation: _availablePreparation('old-explicit'),
                    ),
                  ],
                ),
              );
            }
            return nextSearch.future;
          },
    );
    await _submitSearch(tester);
    await tester.tap(
      find.byKey(const ValueKey('biteScore:old-explicit:batch-selection')),
    );
    await tester.pump();
    expect(find.text('1 selected'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('admin-link-search-button')));
    await tester.pump();
    expect(
      find.byKey(const ValueKey('admin-link-record-biteScore:old-explicit')),
      findsNothing,
    );
    expect(
      find.byKey(const ValueKey('admin-link-loading-state')),
      findsOneWidget,
    );

    nextSearch.complete(
      _result(
        records: [
          _biteScoreRecord(
            documentId: 'fresh-explicit',
            preparation: _availablePreparation('fresh-explicit'),
          ),
        ],
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('0 selected'), findsOneWidget);
  });

  testWidgets(
    'Continue checking preserves selection and leaves new rows clear',
    (tester) async {
      var calls = 0;
      await _pumpPagedScreen(
        tester,
        search:
            ({
              required locationQuery,
              required radiusMiles,
              required restaurantName,
              required sources,
              required searchInstanceId,
              required clientRequestId,
              required needsQrPreparation,
              cursor,
              resolvedSearchCenter,
            }) async {
              calls += 1;
              return calls == 1
                  ? _pagedResult(
                      needsQrPreparation: true,
                      records: [
                        _filteredRecord(
                          'checking-selected',
                          orderDistanceMillimeters: 0,
                        ),
                      ],
                      hasNext: true,
                      nextCursor: _pageCursor('selection-checking'),
                    )
                  : _pagedResult(
                      needsQrPreparation: true,
                      records: [
                        _filteredRecord(
                          'checking-new',
                          orderDistanceMillimeters: 1,
                        ),
                      ],
                    );
            },
      );
      await tester.tap(
        find.byKey(const ValueKey('admin-link-filter-needs-qr-preparation')),
      );
      await _submitSearch(tester);
      await tester.tap(
        find.byKey(
          const ValueKey('biteScore:checking-selected:batch-selection'),
        ),
      );
      await tester.pump();

      final continueChecking = await _scrollToAdminKey(
        tester,
        const ValueKey('admin-link-load-more-button'),
      );
      expect(find.text('Continue checking'), findsOneWidget);
      await tester.tap(continueChecking);
      await tester.pumpAndSettle();
      await _scrollToAdminKey(
        tester,
        const ValueKey('admin-link-selected-count'),
        delta: -700,
      );
      expect(find.text('1 selected'), findsOneWidget);
      final newSelection = await _scrollToAdminKey(
        tester,
        const ValueKey('biteScore:checking-new:batch-selection'),
      );
      expect(tester.widget<Checkbox>(newSelection).value, isFalse);
    },
  );

  testWidgets('selection preserves scroll offset and survives lazy rebuilds', (
    tester,
  ) async {
    final records = List.generate(
      90,
      (index) => _biteScoreRecord(
        documentId: 'selection-lazy-${index.toString().padLeft(2, '0')}',
        name: 'Selection Lazy $index',
        preparation: _availablePreparation(
          'selection-lazy-${index.toString().padLeft(2, '0')}',
        ),
        orderDistanceMillimeters: index,
      ),
    );
    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
          }) async => _result(records: records),
    );
    await _submitSearch(tester);
    final list = find.byKey(
      const ValueKey('admin-link-generation-scroll-view'),
    );
    final controller = tester.widget<ListView>(list).controller!;
    var selection = await _scrollToAdminKey(
      tester,
      const ValueKey('biteScore:selection-lazy-45:batch-selection'),
    );
    final offset = controller.offset;
    expect(offset, greaterThan(0));
    await tester.tap(selection);
    await tester.pump();
    expect(controller.offset, closeTo(offset, 0.5));

    await _scrollToAdminKey(
      tester,
      const ValueKey('biteScore:selection-lazy-89:batch-selection'),
    );
    expect(
      find.byKey(const ValueKey('biteScore:selection-lazy-45:batch-selection')),
      findsNothing,
    );
    selection = await _scrollToAdminKey(
      tester,
      const ValueKey('biteScore:selection-lazy-45:batch-selection'),
      delta: -700,
    );
    expect(tester.widget<Checkbox>(selection).value, isTrue);
  });

  testWidgets('bulk selection callbacks preserve a nonzero scroll offset', (
    tester,
  ) async {
    final records = List.generate(
      100,
      (index) => _selectableOrderedRecord(
        'bulk-scroll-${index.toString().padLeft(3, '0')}',
        index,
        name: 'Bulk Scroll $index',
      ),
    );
    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
          }) async => _result(records: records),
    );
    await _submitSearch(tester);
    final list = find.byKey(
      const ValueKey('admin-link-generation-scroll-view'),
    );
    final controller = tester.widget<ListView>(list).controller!;
    final selectAll = tester
        .widget<OutlinedButton>(
          find.byKey(const ValueKey('admin-link-select-all-loaded')),
        )
        .onPressed!;

    await _scrollToAdminKey(
      tester,
      const ValueKey('biteScore:bulk-scroll-050:batch-selection'),
    );
    final offsetBeforeSelectAll = controller.offset;
    expect(offsetBeforeSelectAll, greaterThan(0));
    selectAll();
    await tester.pump();
    expect(controller.offset, closeTo(offsetBeforeSelectAll, 0.5));
    expect(tester.widget<ListView>(list).controller, same(controller));

    await _scrollToAdminKey(
      tester,
      const ValueKey('admin-link-selected-count'),
      delta: -700,
    );
    expect(find.text('100 selected'), findsOneWidget);
    final deselectAll = tester
        .widget<TextButton>(
          find.byKey(const ValueKey('admin-link-deselect-all')),
        )
        .onPressed!;

    await _scrollToAdminKey(
      tester,
      const ValueKey('biteScore:bulk-scroll-060:batch-selection'),
    );
    final offsetBeforeDeselectAll = controller.offset;
    expect(offsetBeforeDeselectAll, greaterThan(0));
    deselectAll();
    await tester.pump();
    expect(controller.offset, closeTo(offsetBeforeDeselectAll, 0.5));
    expect(tester.widget<ListView>(list).controller, same(controller));

    await _scrollToAdminKey(
      tester,
      const ValueKey('admin-link-selected-count'),
      delta: -700,
    );
    expect(find.text('0 selected'), findsOneWidget);
  });

  testWidgets('existing Admin actions preserve the exact selection set', (
    tester,
  ) async {
    var inviteCalls = 0;
    var qrRenderCalls = 0;
    var preparationCalls = 0;
    final clipboardWrites = <String>[];
    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
          }) async => _result(
            records: [
              _biteScoreRecord(
                documentId: 'action-selected',
                name: 'Action Selected',
                preparation: _availablePreparation('action-selected'),
              ),
              _biteScoreRecord(
                documentId: 'action-unselected',
                name: 'Action Unselected',
                preparation: _availablePreparation('action-unselected'),
              ),
            ],
          ),
      createCouponInvite:
          ({
            required restaurantName,
            required restaurantId,
            required biteScoreCatalogRestaurantId,
            required streetAddress,
            required city,
            required state,
            required zipCode,
            required phone,
            required website,
            required latitude,
            required longitude,
          }) async {
            inviteCalls += 1;
            return _invite(
              'https://go.bitestar.app/invite/coupon/action-selection',
            );
          },
      writeClipboard: (value) async {
        clipboardWrites.add(value);
      },
      renderQrImage:
          ({required restaurantName, required url, required linkType}) async {
            qrRenderCalls += 1;
            return _qrImage(restaurantName, linkType);
          },
      updatePreparation:
          ({
            required catalogRestaurantId,
            required type,
            required prepared,
            required biteSaverCatalogBindingState,
            required claimState,
            expectedInviteId,
          }) async {
            preparationCalls += 1;
            expect(catalogRestaurantId, 'action-selected');
            expect(type, AdminRestaurantPreparationType.biteSaverCustomer);
            return _preparationState(
              catalogRestaurantId,
              biteSaverCustomer: AdminRestaurantPreparationStatus.prepared,
            );
          },
    );
    await _submitSearch(tester);
    await tester.tap(
      find.byKey(const ValueKey('biteScore:action-selected:batch-selection')),
    );
    await tester.pump();

    Future<void> expectExactSelection() async {
      final selected = await _scrollToAdminKey(
        tester,
        const ValueKey('biteScore:action-selected:batch-selection'),
      );
      expect(tester.widget<Checkbox>(selected).value, isTrue);
      final unselected = await _scrollToAdminKey(
        tester,
        const ValueKey('biteScore:action-unselected:batch-selection'),
      );
      expect(tester.widget<Checkbox>(unselected).value, isFalse);
      await _scrollToAdminKey(
        tester,
        const ValueKey('admin-link-selected-count'),
        delta: -700,
      );
      expect(find.text('1 selected'), findsOneWidget);
    }

    final invite = await _scrollToAdminKey(
      tester,
      const ValueKey('biteScore:action-selected:coupon-invite'),
    );
    await tester.tap(invite);
    await _pumpOpenDialog(tester);
    expect(inviteCalls, 1);
    await tester.tap(find.byKey(const ValueKey('copy-link-action')));
    await tester.pump();
    expect(clipboardWrites, hasLength(1));
    await tester.tap(find.byKey(const ValueKey('create-link-qr')));
    await _pumpOpenDialog(tester);
    expect(qrRenderCalls, 1);
    await tester.tap(find.byKey(const ValueKey('restaurant-qr-preview-close')));
    await tester.pumpAndSettle();
    await expectExactSelection();

    final preparation = await _scrollToAdminKey(
      tester,
      const ValueKey('biteScore:action-selected:preparation-SA'),
    );
    await tester.tap(preparation);
    await tester.pumpAndSettle();
    expect(preparationCalls, 1);
    await expectExactSelection();

    final mailingAddress = await _scrollToAdminKey(
      tester,
      const ValueKey('biteScore:action-selected:copy-mailing-address'),
    );
    await tester.tap(mailingAddress);
    await tester.pumpAndSettle();
    expect(clipboardWrites, hasLength(2));
    await expectExactSelection();
  });

  testWidgets('Needs QR filter toggles locally and enforces BiteScore source', (
    tester,
  ) async {
    var calls = 0;
    await _pumpPagedScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
            required searchInstanceId,
            required clientRequestId,
            required needsQrPreparation,
            cursor,
            resolvedSearchCenter,
          }) async {
            calls += 1;
            return _pagedResult(
              records: [_biteScoreRecord(documentId: 'old-result')],
            );
          },
    );

    final biteScore = find.byKey(const ValueKey('admin-link-source-biteScore'));
    final filter = find.byKey(
      const ValueKey('admin-link-filter-needs-qr-preparation'),
    );
    expect(find.text('Filters'), findsOneWidget);
    expect(filter, findsOneWidget);
    await tester.tap(biteScore);
    await tester.pump();
    expect(tester.widget<FilterChip>(biteScore).selected, isFalse);

    await tester.tap(filter);
    await tester.pump();
    expect(calls, 0);
    expect(tester.widget<FilterChip>(filter).selected, isTrue);
    expect(tester.widget<FilterChip>(biteScore).selected, isTrue);
    expect(tester.widget<FilterChip>(biteScore).onSelected, isNull);

    await tester.tap(filter);
    await tester.pump();
    expect(tester.widget<FilterChip>(filter).selected, isFalse);
    expect(tester.widget<FilterChip>(biteScore).onSelected, isNotNull);
  });

  testWidgets('explicit searches bind false and true to new generations', (
    tester,
  ) async {
    final filters = <bool>[];
    final instances = <String>[];
    await _pumpPagedScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
            required searchInstanceId,
            required clientRequestId,
            required needsQrPreparation,
            cursor,
            resolvedSearchCenter,
          }) async {
            filters.add(needsQrPreparation);
            instances.add(searchInstanceId);
            return _pagedResult(
              needsQrPreparation: needsQrPreparation,
              records: needsQrPreparation
                  ? [_filteredRecord('filtered-result')]
                  : [_biteScoreRecord(documentId: 'ordinary-result')],
            );
          },
    );

    await _submitSearch(tester);
    expect(filters, [false]);
    final filter = await _scrollToAdminKey(
      tester,
      const ValueKey('admin-link-filter-needs-qr-preparation'),
      delta: -600,
    );
    await tester.tap(filter);
    await tester.pump();
    expect(
      find.byKey(const ValueKey('admin-link-record-biteScore:ordinary-result')),
      findsNothing,
    );
    expect(
      find.byKey(const ValueKey('admin-link-initial-state')),
      findsOneWidget,
    );

    await _submitSearch(tester);
    expect(filters, [false, true]);
    expect(instances[1], isNot(instances[0]));
    expect(
      find.byKey(const ValueKey('admin-link-record-biteScore:filtered-result')),
      findsOneWidget,
    );
  });

  testWidgets('filtered sparse pages continue checking without false empty', (
    tester,
  ) async {
    var calls = 0;
    await _pumpPagedScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
            required searchInstanceId,
            required clientRequestId,
            required needsQrPreparation,
            cursor,
            resolvedSearchCenter,
          }) async {
            calls += 1;
            return calls == 1
                ? _pagedResult(
                    needsQrPreparation: true,
                    hasNext: true,
                    nextCursor: _pageCursor('continue-checking'),
                  )
                : _pagedResult(
                    needsQrPreparation: true,
                    records: [_filteredRecord('eventual-match')],
                  );
          },
    );
    await tester.tap(
      find.byKey(const ValueKey('admin-link-filter-needs-qr-preparation')),
    );
    await _submitSearch(tester);

    expect(find.text('Continue checking'), findsOneWidget);
    expect(
      find.text('No restaurants need QR preparation in this search area.'),
      findsNothing,
    );
    await tester.tap(find.text('Continue checking'));
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey('admin-link-record-biteScore:eventual-match')),
      findsOneWidget,
    );
  });

  testWidgets('filtered exact terminal 50 displays without a continuation', (
    tester,
  ) async {
    final records = List.generate(
      50,
      (index) => _filteredRecord(
        'terminal-${index.toString().padLeft(2, '0')}',
        orderDistanceMillimeters: index + 1,
      ),
      growable: false,
    );
    final terminalPage = _pagedResult(
      needsQrPreparation: true,
      records: records,
    );
    expect(terminalPage.hasNext, isFalse);
    expect(terminalPage.nextCursor, isNull);
    expect(terminalPage.consumedBoundary, records.last.materializedOrder);

    var calls = 0;
    await _pumpPagedScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
            required searchInstanceId,
            required clientRequestId,
            required needsQrPreparation,
            cursor,
            resolvedSearchCenter,
          }) async {
            calls += 1;
            expect(cursor, isNull);
            return terminalPage;
          },
    );
    await tester.tap(
      find.byKey(const ValueKey('admin-link-filter-needs-qr-preparation')),
    );
    await _submitSearch(tester);

    expect(calls, 1);
    expect(
      find.text('50 restaurant records near Crystal River, FL'),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('admin-link-record-biteScore:terminal-00')),
      findsOneWidget,
    );
    await _scrollToAdminKey(
      tester,
      const ValueKey('admin-link-record-biteScore:terminal-49'),
    );
    expect(
      find.byKey(const ValueKey('admin-link-record-biteScore:terminal-49')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('admin-link-load-more-button')),
      findsNothing,
    );
    expect(find.text('Continue checking'), findsNothing);
    expect(find.text('Load More'), findsNothing);
    expect(find.textContaining('invalid continuation'), findsNothing);
  });

  testWidgets(
    'filtered warning ORs false true false and resets on Search and criteria',
    (tester) async {
      final firstCursor = _pageCursor('warning-first');
      final secondCursor = _pageCursor('warning-second');
      var calls = 0;
      await _pumpPagedScreen(
        tester,
        search:
            ({
              required locationQuery,
              required radiusMiles,
              required restaurantName,
              required sources,
              required searchInstanceId,
              required clientRequestId,
              required needsQrPreparation,
              cursor,
              resolvedSearchCenter,
            }) async {
              calls += 1;
              switch (calls) {
                case 1:
                  expect(cursor, isNull);
                  return _pagedResult(
                    needsQrPreparation: true,
                    records: [
                      _filteredRecord(
                        'warning-first',
                        orderDistanceMillimeters: 1,
                      ),
                    ],
                    hasNext: true,
                    nextCursor: firstCursor,
                  );
                case 2:
                  expect(cursor, firstCursor);
                  return _pagedResult(
                    needsQrPreparation: true,
                    preparationUnavailableEncountered: true,
                    records: [
                      _filteredRecord(
                        'warning-second',
                        orderDistanceMillimeters: 2,
                      ),
                    ],
                    hasNext: true,
                    nextCursor: secondCursor,
                  );
                case 3:
                  expect(cursor, secondCursor);
                  return _pagedResult(
                    needsQrPreparation: true,
                    records: [
                      _filteredRecord(
                        'warning-third',
                        orderDistanceMillimeters: 3,
                      ),
                    ],
                  );
                case 4:
                  expect(cursor, isNull);
                  return _pagedResult(
                    needsQrPreparation: true,
                    records: [_filteredRecord('fresh-search-no-warning')],
                  );
                case 5:
                  expect(cursor, isNull);
                  return _pagedResult(
                    needsQrPreparation: true,
                    preparationUnavailableEncountered: true,
                    records: [_filteredRecord('before-source-reset')],
                  );
                case 6:
                  expect(cursor, isNull);
                  return _pagedResult(
                    needsQrPreparation: true,
                    preparationUnavailableEncountered: true,
                    records: [_filteredRecord('before-filter-reset')],
                  );
              }
              fail('Unexpected warning-test search call $calls.');
            },
      );
      await tester.tap(
        find.byKey(const ValueKey('admin-link-filter-needs-qr-preparation')),
      );
      await _submitSearch(tester);

      expect(
        find.byKey(
          const ValueKey('admin-link-preparation-unavailable-warning'),
        ),
        findsNothing,
      );
      var action = await _scrollToAdminKey(
        tester,
        const ValueKey('admin-link-load-more-button'),
      );
      expect(find.text('Continue checking'), findsOneWidget);
      await tester.tap(action);
      await tester.pumpAndSettle();

      await _scrollToAdminKey(
        tester,
        const ValueKey('admin-link-preparation-unavailable-warning'),
        delta: -600,
      );
      action = await _scrollToAdminKey(
        tester,
        const ValueKey('admin-link-load-more-button'),
      );
      await tester.tap(action);
      await tester.pumpAndSettle();

      await _scrollToAdminKey(
        tester,
        const ValueKey('admin-link-preparation-unavailable-warning'),
        delta: -600,
      );
      expect(
        find.byKey(const ValueKey('admin-link-load-more-button')),
        findsNothing,
      );

      await _submitSearch(tester);
      expect(calls, 4);
      expect(
        find.byKey(
          const ValueKey('admin-link-preparation-unavailable-warning'),
        ),
        findsNothing,
      );

      await _submitSearch(tester);
      expect(calls, 5);
      await _scrollToAdminKey(
        tester,
        const ValueKey('admin-link-preparation-unavailable-warning'),
      );
      final biteSaverSource = await _scrollToAdminKey(
        tester,
        const ValueKey('admin-link-source-biteSaver'),
        delta: -600,
      );
      await tester.tap(biteSaverSource);
      await tester.pump();
      expect(
        find.byKey(
          const ValueKey('admin-link-preparation-unavailable-warning'),
        ),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('admin-link-initial-state')),
        findsOneWidget,
      );

      await tester.tap(biteSaverSource);
      await tester.pump();
      await _submitSearch(tester);
      expect(calls, 6);
      await _scrollToAdminKey(
        tester,
        const ValueKey('admin-link-preparation-unavailable-warning'),
      );
      final filter = await _scrollToAdminKey(
        tester,
        const ValueKey('admin-link-filter-needs-qr-preparation'),
        delta: -600,
      );
      await tester.tap(filter);
      await tester.pump();
      expect(
        find.byKey(
          const ValueKey('admin-link-preparation-unavailable-warning'),
        ),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('admin-link-initial-state')),
        findsOneWidget,
      );
    },
  );

  testWidgets('filtered terminal empty wording reflects unavailable records', (
    tester,
  ) async {
    var warning = false;
    Future<AdminRestaurantLinkPagedResult> search(
      bool needsQrPreparation,
    ) async => _pagedResult(
      needsQrPreparation: true,
      preparationUnavailableEncountered: warning,
    );
    await _pumpPagedScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
            required searchInstanceId,
            required clientRequestId,
            required needsQrPreparation,
            cursor,
            resolvedSearchCenter,
          }) => search(needsQrPreparation),
    );
    await tester.tap(
      find.byKey(const ValueKey('admin-link-filter-needs-qr-preparation')),
    );
    await _submitSearch(tester);
    expect(
      find.text('No restaurants need QR preparation in this search area.'),
      findsOneWidget,
    );

    warning = true;
    await _submitSearch(tester);
    expect(
      find.text(
        'No assessed restaurants need QR preparation. Some records could not be assessed and are not shown.',
      ),
      findsOneWidget,
    );
  });

  testWidgets(
    'filtered final completion preserves scroll cursor boundary and state',
    (tester) async {
      const completedId = 'completed-locally';
      const overrideId = 'manual-override-kept';
      final continuationCursor = _pageCursor('after-local-completion');
      final records = List.generate(
        16,
        (index) => _filteredRecord(
          'stable-${index.toString().padLeft(2, '0')}',
          orderDistanceMillimeters: index + 1,
        ),
        growable: false,
      );
      records[0] = _filteredRecord(overrideId, orderDistanceMillimeters: 1);
      records[8] = _biteScoreRecord(
        documentId: completedId,
        preparation: _preparationState(
          completedId,
          claimInvite: AdminRestaurantPreparationStatus.prepared,
          biteSaverCustomer: AdminRestaurantPreparationStatus.prepared,
          biteScoreCustomer: AdminRestaurantPreparationStatus.prepared,
        ),
        orderDistanceMillimeters: 9,
      );
      final initialBoundary = records.last.materializedOrder!;
      final cursors = <String?>[];
      var calls = 0;
      await _pumpPagedScreen(
        tester,
        updatePreparation:
            ({
              required catalogRestaurantId,
              required type,
              required prepared,
              required biteSaverCatalogBindingState,
              required claimState,
              expectedInviteId,
            }) async {
              expect(prepared, isTrue);
              if (catalogRestaurantId == overrideId) {
                expect(type, AdminRestaurantPreparationType.biteSaverCustomer);
                return _preparationState(
                  catalogRestaurantId,
                  biteSaverCustomer: AdminRestaurantPreparationStatus.prepared,
                );
              }
              expect(catalogRestaurantId, completedId);
              expect(type, AdminRestaurantPreparationType.ownerInvite);
              return _preparationState(
                catalogRestaurantId,
                ownerInvite: AdminRestaurantPreparationStatus.prepared,
                claimInvite: AdminRestaurantPreparationStatus.prepared,
                biteSaverCustomer: AdminRestaurantPreparationStatus.prepared,
                biteScoreCustomer: AdminRestaurantPreparationStatus.prepared,
              );
            },
        search:
            ({
              required locationQuery,
              required radiusMiles,
              required restaurantName,
              required sources,
              required searchInstanceId,
              required clientRequestId,
              required needsQrPreparation,
              cursor,
              resolvedSearchCenter,
            }) async {
              calls += 1;
              cursors.add(cursor);
              if (calls == 1) {
                return _pagedResult(
                  needsQrPreparation: true,
                  preparationUnavailableEncountered: true,
                  records: records,
                  hasNext: true,
                  nextCursor: continuationCursor,
                );
              }
              expect(cursor, continuationCursor);
              if (calls == 2) {
                return _pagedResult(
                  needsQrPreparation: true,
                  consumedBoundary: initialBoundary,
                  hasNext: true,
                  nextCursor: _pageCursor('overlap-must-not-apply'),
                );
              }
              return _pagedResult(
                needsQrPreparation: true,
                records: [
                  _filteredRecord(completedId, orderDistanceMillimeters: 17),
                  _filteredRecord(
                    'after-local-completion',
                    orderDistanceMillimeters: 18,
                  ),
                ],
              );
            },
      );
      await tester.tap(
        find.byKey(const ValueKey('admin-link-filter-needs-qr-preparation')),
      );
      await _submitSearch(tester);

      await _scrollToAdminKey(
        tester,
        const ValueKey('admin-link-preparation-unavailable-warning'),
      );
      await _scrollToAdminKey(
        tester,
        const ValueKey('admin-link-load-more-button'),
      );
      expect(find.text('Continue checking'), findsOneWidget);
      await _scrollToAdminKey(
        tester,
        const ValueKey('biteScore:$overrideId:preparation-SA'),
        delta: -700,
      );
      await tester.tap(
        find.byKey(const ValueKey('biteScore:$overrideId:preparation-SA')),
      );
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<FilterChip>(
              find.byKey(
                const ValueKey('biteScore:$overrideId:preparation-SA'),
              ),
            )
            .selected,
        isTrue,
      );
      final retainedSelection = find.byKey(
        const ValueKey('biteScore:$overrideId:batch-selection'),
      );
      await tester.tap(retainedSelection);
      await tester.pump();
      expect(tester.widget<Checkbox>(retainedSelection).value, isTrue);

      final listFinder = find.byKey(
        const ValueKey('admin-link-generation-scroll-view'),
      );
      final controller = tester.widget<ListView>(listFinder).controller!;
      final finalPreparation = await _scrollToAdminKey(
        tester,
        const ValueKey('biteScore:$completedId:preparation-I'),
      );
      final completedSelection = find.byKey(
        const ValueKey('biteScore:$completedId:batch-selection'),
      );
      await tester.tap(completedSelection);
      await tester.pump();
      expect(tester.widget<Checkbox>(completedSelection).value, isTrue);
      final offsetBeforeRemoval = controller.offset;
      expect(offsetBeforeRemoval, greaterThan(0));

      await tester.tap(finalPreparation);
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('admin-link-record-biteScore:$completedId')),
        findsNothing,
      );
      expect(controller.offset, greaterThan(0));
      expect(controller.offset, closeTo(offsetBeforeRemoval, 1));
      expect(tester.widget<ListView>(listFinder).controller, same(controller));
      await _scrollToAdminKey(
        tester,
        const ValueKey('admin-link-selected-count'),
        delta: -700,
      );
      expect(find.text('1 selected'), findsOneWidget);

      await _scrollToAdminKey(
        tester,
        const ValueKey('admin-link-preparation-unavailable-warning'),
        delta: -700,
      );
      await _scrollToAdminKey(
        tester,
        const ValueKey('biteScore:$overrideId:preparation-SA'),
        delta: -700,
      );
      expect(
        tester
            .widget<FilterChip>(
              find.byKey(
                const ValueKey('biteScore:$overrideId:preparation-SA'),
              ),
            )
            .selected,
        isTrue,
      );
      expect(
        tester
            .widget<Checkbox>(
              find.byKey(
                const ValueKey('biteScore:$overrideId:batch-selection'),
              ),
            )
            .value,
        isTrue,
      );

      await tester.pump(const Duration(seconds: 4));
      await tester.pumpAndSettle();
      var continueChecking = await _scrollToAdminKey(
        tester,
        const ValueKey('admin-link-load-more-button'),
      );
      expect(find.text('Continue checking'), findsOneWidget);
      await tester.tap(continueChecking);
      await tester.pumpAndSettle();
      expect(find.textContaining('invalid continuation page'), findsOneWidget);
      expect(find.text('Retry checking'), findsOneWidget);

      continueChecking = await _scrollToAdminKey(
        tester,
        const ValueKey('admin-link-load-more-button'),
      );
      await tester.tap(continueChecking);
      await tester.pumpAndSettle();

      expect(calls, 3);
      expect(cursors, [null, continuationCursor, continuationCursor]);
      expect(
        find.byKey(const ValueKey('admin-link-record-biteScore:$completedId')),
        findsNothing,
      );
      await _scrollToAdminKey(
        tester,
        const ValueKey('admin-link-selected-count'),
        delta: -700,
      );
      expect(find.text('1 selected'), findsOneWidget);
      await _scrollToAdminKey(
        tester,
        const ValueKey('admin-link-record-biteScore:after-local-completion'),
      );
      expect(
        find.byKey(
          const ValueKey('admin-link-record-biteScore:after-local-completion'),
        ),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('admin-link-load-more-button')),
        findsNothing,
      );
      await _scrollToAdminKey(
        tester,
        const ValueKey('admin-link-preparation-unavailable-warning'),
        delta: -700,
      );
      await _scrollToAdminKey(
        tester,
        const ValueKey('biteScore:$overrideId:preparation-SA'),
        delta: -700,
      );
      expect(
        tester
            .widget<FilterChip>(
              find.byKey(
                const ValueKey('biteScore:$overrideId:preparation-SA'),
              ),
            )
            .selected,
        isTrue,
      );
      expect(
        tester
            .widget<Checkbox>(
              find.byKey(
                const ValueKey('biteScore:$overrideId:batch-selection'),
              ),
            )
            .value,
        isTrue,
      );
    },
  );

  testWidgets('Load More appends once and preserves manual preparation state', (
    tester,
  ) async {
    final completer = Completer<AdminRestaurantLinkPagedResult>();
    var calls = 0;
    await _pumpPagedScreen(
      tester,
      updatePreparation:
          ({
            required catalogRestaurantId,
            required type,
            required prepared,
            required biteSaverCatalogBindingState,
            required claimState,
            expectedInviteId,
          }) async => AdminRestaurantPreparationState(
            canonicalCatalogRestaurantId: catalogRestaurantId,
            ownerInvite: AdminRestaurantPreparationStatus.unprepared,
            claimInvite: AdminRestaurantPreparationStatus.unprepared,
            biteSaverCustomer: prepared
                ? AdminRestaurantPreparationStatus.prepared
                : AdminRestaurantPreparationStatus.unprepared,
            biteScoreCustomer: AdminRestaurantPreparationStatus.unprepared,
          ),
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
            required searchInstanceId,
            required clientRequestId,
            required needsQrPreparation,
            cursor,
            resolvedSearchCenter,
          }) {
            calls += 1;
            if (calls == 1) {
              return Future.value(
                _pagedResult(
                  records: [
                    _biteScoreRecord(
                      documentId: 'first',
                      preparation: _availablePreparation('first'),
                    ),
                  ],
                  hasNext: true,
                  nextCursor: _pageCursor('page-2'),
                ),
              );
            }
            return completer.future;
          },
    );
    await _submitSearch(tester);
    await tester.tap(
      find.byKey(const ValueKey('biteScore:first:preparation-SA')),
    );
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<FilterChip>(
            find.byKey(const ValueKey('biteScore:first:preparation-SA')),
          )
          .selected,
      isTrue,
    );

    await tester.pump(const Duration(seconds: 4));
    final loadMore = await _scrollToAdminKey(
      tester,
      const ValueKey('admin-link-load-more-button'),
    );
    await tester.tap(loadMore);
    await tester.pump();
    await tester.tap(loadMore, warnIfMissed: false);
    expect(calls, 2);
    expect(find.text('River Grill'), findsOneWidget);

    completer.complete(
      _pagedResult(
        records: [
          _biteScoreRecord(
            documentId: 'second',
            orderDistanceMillimeters: 2011681,
          ),
        ],
      ),
    );
    await tester.pumpAndSettle();
    await _scrollToAdminKey(
      tester,
      const ValueKey('admin-link-record-biteScore:first'),
      delta: -600,
    );
    expect(
      find.byKey(const ValueKey('admin-link-record-biteScore:first')),
      findsOneWidget,
    );
    expect(
      tester
          .widget<FilterChip>(
            find.byKey(const ValueKey('biteScore:first:preparation-SA')),
          )
          .selected,
      isTrue,
    );
    await _scrollToAdminKey(
      tester,
      const ValueKey('admin-link-record-biteScore:second'),
    );
    expect(
      find.byKey(const ValueKey('admin-link-record-biteScore:second')),
      findsOneWidget,
    );
  });

  testWidgets('duplicate append fails closed and keeps loaded rows retryable', (
    tester,
  ) async {
    var calls = 0;
    final first = _biteScoreRecord(documentId: 'first');
    await _pumpPagedScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
            required searchInstanceId,
            required clientRequestId,
            required needsQrPreparation,
            cursor,
            resolvedSearchCenter,
          }) async {
            calls += 1;
            return calls == 1
                ? _pagedResult(
                    records: [first],
                    hasNext: true,
                    nextCursor: _pageCursor('duplicate-page-2'),
                  )
                : _pagedResult(records: [first]);
          },
    );
    await _submitSearch(tester);
    final loadMore = await _scrollToAdminKey(
      tester,
      const ValueKey('admin-link-load-more-button'),
    );
    await tester.tap(loadMore);
    await tester.pumpAndSettle();

    expect(find.textContaining('duplicate records'), findsOneWidget);
    expect(find.text('Retry Load More'), findsOneWidget);
    await _scrollToAdminKey(
      tester,
      const ValueKey('admin-link-record-biteScore:first'),
      delta: -600,
    );
    expect(
      find.byKey(const ValueKey('admin-link-record-biteScore:first')),
      findsOneWidget,
    );
  });

  testWidgets('sparse current page remains honest and keeps Load More', (
    tester,
  ) async {
    await _pumpPagedScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
            required searchInstanceId,
            required clientRequestId,
            required needsQrPreparation,
            cursor,
            resolvedSearchCenter,
          }) async => _pagedResult(
            hasNext: true,
            nextCursor: _pageCursor('sparse-next'),
          ),
    );
    await _submitSearch(tester);

    expect(
      find.byKey(const ValueKey('admin-link-sparse-results-state')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('admin-link-no-results-state')),
      findsNothing,
    );
    expect(
      find.byKey(const ValueKey('admin-link-load-more-button')),
      findsOneWidget,
    );
  });

  testWidgets(
    'final sparse page is authoritative only after continuation is exhausted',
    (tester) async {
      await _pumpPagedScreen(
        tester,
        search:
            ({
              required locationQuery,
              required radiusMiles,
              required restaurantName,
              required sources,
              required searchInstanceId,
              required clientRequestId,
              required needsQrPreparation,
              cursor,
              resolvedSearchCenter,
            }) async => _pagedResult(
              consumedBoundary: const AdminRestaurantMaterializedOrder(
                distanceMillimeters: 7,
                normalizedName: 'filtered restaurant',
                sourceDocumentId: 'filtered-final',
                source: AdminRestaurantLinkSource.biteScore,
              ),
            ),
      );

      await _submitSearch(tester);

      expect(
        find.byKey(const ValueKey('admin-link-no-results-state')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('admin-link-sparse-results-state')),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('admin-link-load-more-button')),
        findsNothing,
      );
    },
  );

  testWidgets('Load More retry reuses its exact client request identity', (
    tester,
  ) async {
    final requestIds = <String>[];
    var calls = 0;
    await _pumpPagedScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
            required searchInstanceId,
            required clientRequestId,
            required needsQrPreparation,
            cursor,
            resolvedSearchCenter,
          }) async {
            calls += 1;
            requestIds.add(clientRequestId);
            if (calls == 1) {
              return _pagedResult(
                records: [
                  _biteScoreRecord(
                    documentId: 'retry-first',
                    orderDistanceMillimeters: 0,
                  ),
                ],
                hasNext: true,
                nextCursor: _pageCursor('retry-next'),
              );
            }
            if (calls == 2) {
              throw const AdminLinkGenerationException(
                'The Load More response was lost.',
              );
            }
            return _pagedResult(
              records: [
                _biteScoreRecord(
                  documentId: 'retry-second',
                  orderDistanceMillimeters: 1,
                ),
              ],
            );
          },
    );
    await _submitSearch(tester);
    final loadMore = await _scrollToAdminKey(
      tester,
      const ValueKey('admin-link-load-more-button'),
    );

    await tester.tap(loadMore);
    await tester.pumpAndSettle();
    expect(find.text('Retry Load More'), findsOneWidget);
    final retry = await _scrollToAdminKey(
      tester,
      const ValueKey('admin-link-load-more-button'),
    );
    await tester.tap(retry);
    await tester.pumpAndSettle();

    expect(calls, 3);
    expect(requestIds[2], requestIds[1]);
    expect(requestIds[1], isNot(requestIds[0]));
    await _scrollToAdminKey(
      tester,
      const ValueKey('admin-link-record-biteScore:retry-second'),
      delta: -600,
    );
    expect(
      find.byKey(const ValueKey('admin-link-record-biteScore:retry-second')),
      findsOneWidget,
    );
  });

  testWidgets(
    'continuation rejects fingerprint and boundary overlap without losing rows',
    (tester) async {
      final first = _biteScoreRecord(
        documentId: 'boundary-first',
        orderDistanceMillimeters: 10,
        preparation: _availablePreparation('boundary-first'),
      );
      final continuationRequestIds = <String>[];
      var calls = 0;
      await _pumpPagedScreen(
        tester,
        updatePreparation:
            ({
              required catalogRestaurantId,
              required type,
              required prepared,
              required biteSaverCatalogBindingState,
              required claimState,
              expectedInviteId,
            }) async => AdminRestaurantPreparationState(
              canonicalCatalogRestaurantId: catalogRestaurantId,
              ownerInvite: AdminRestaurantPreparationStatus.unprepared,
              claimInvite: AdminRestaurantPreparationStatus.unprepared,
              biteSaverCustomer: prepared
                  ? AdminRestaurantPreparationStatus.prepared
                  : AdminRestaurantPreparationStatus.unprepared,
              biteScoreCustomer: AdminRestaurantPreparationStatus.unprepared,
            ),
        search:
            ({
              required locationQuery,
              required radiusMiles,
              required restaurantName,
              required sources,
              required searchInstanceId,
              required clientRequestId,
              required needsQrPreparation,
              cursor,
              resolvedSearchCenter,
            }) async {
              calls += 1;
              if (cursor != null) {
                continuationRequestIds.add(clientRequestId);
              }
              if (calls == 1) {
                return _pagedResult(
                  records: [first],
                  hasNext: true,
                  nextCursor: _pageCursor('boundary-next'),
                );
              }
              if (calls == 2) {
                return _pagedResult(
                  records: [
                    _biteScoreRecord(
                      documentId: 'wrong-fingerprint',
                      orderDistanceMillimeters: 11,
                    ),
                  ],
                  queryFingerprint:
                      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                );
              }
              if (calls == 3) {
                return _pagedResult(consumedBoundary: first.materializedOrder);
              }
              if (calls == 4) {
                return _pagedResult(
                  records: [
                    _biteScoreRecord(
                      documentId: 'overlapping-order',
                      orderDistanceMillimeters: 9,
                    ),
                  ],
                  consumedBoundary: const AdminRestaurantMaterializedOrder(
                    distanceMillimeters: 20,
                    normalizedName: 'later boundary',
                    sourceDocumentId: 'later-boundary',
                    source: AdminRestaurantLinkSource.biteScore,
                  ),
                );
              }
              return _pagedResult(
                records: [
                  _biteScoreRecord(
                    documentId: 'boundary-second',
                    orderDistanceMillimeters: 11,
                  ),
                ],
              );
            },
      );
      await _submitSearch(tester);
      await tester.tap(
        find.byKey(const ValueKey('biteScore:boundary-first:preparation-SA')),
      );
      await tester.pumpAndSettle();
      await tester.pump(const Duration(seconds: 4));
      await tester.pumpAndSettle();
      for (var rejected = 0; rejected < 3; rejected += 1) {
        final retry = await _scrollToAdminKey(
          tester,
          const ValueKey('admin-link-load-more-button'),
        );
        await tester.tap(retry);
        await tester.pumpAndSettle();
        expect(find.text('Retry Load More'), findsOneWidget);
      }
      final validRetry = await _scrollToAdminKey(
        tester,
        const ValueKey('admin-link-load-more-button'),
      );
      await tester.tap(validRetry);
      await tester.pumpAndSettle();

      expect(calls, 5);
      expect(continuationRequestIds.toSet(), hasLength(1));
      await _scrollToAdminKey(
        tester,
        const ValueKey('biteScore:boundary-first:preparation-SA'),
        delta: -600,
      );
      expect(
        tester
            .widget<FilterChip>(
              find.byKey(
                const ValueKey('biteScore:boundary-first:preparation-SA'),
              ),
            )
            .selected,
        isTrue,
      );
      await _scrollToAdminKey(
        tester,
        const ValueKey('admin-link-record-biteScore:boundary-second'),
      );
      expect(
        find.byKey(
          const ValueKey('admin-link-record-biteScore:boundary-second'),
        ),
        findsOneWidget,
      );
    },
  );

  testWidgets('expired continuation asks for a fresh explicit search', (
    tester,
  ) async {
    final instances = <String>[];
    var calls = 0;
    await _pumpPagedScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
            required searchInstanceId,
            required clientRequestId,
            required needsQrPreparation,
            cursor,
            resolvedSearchCenter,
          }) async {
            calls += 1;
            instances.add(searchInstanceId);
            if (calls == 1) {
              return _pagedResult(
                records: [
                  _biteScoreRecord(
                    documentId: 'expired-old',
                    orderDistanceMillimeters: 0,
                  ),
                ],
                hasNext: true,
                nextCursor: _pageCursor('expires'),
              );
            }
            if (calls == 2) {
              throw const AdminLinkSearchExpiredException();
            }
            return _pagedResult(
              records: [
                _biteScoreRecord(
                  documentId: 'expired-fresh',
                  orderDistanceMillimeters: 0,
                ),
              ],
            );
          },
    );
    await _submitSearch(tester);
    final loadMore = await _scrollToAdminKey(
      tester,
      const ValueKey('admin-link-load-more-button'),
    );
    await tester.tap(loadMore);
    await tester.pumpAndSettle();

    expect(
      find.byKey(const ValueKey('admin-link-expired-state')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('admin-link-no-results-state')),
      findsNothing,
    );
    await tester.tap(
      find.byKey(const ValueKey('admin-link-expired-search-button')),
    );
    await tester.pumpAndSettle();
    expect(calls, 3);
    expect(instances[2], isNot(instances[0]));
    await _scrollToAdminKey(
      tester,
      const ValueKey('admin-link-record-biteScore:expired-fresh'),
    );
  });

  testWidgets('late Load More cannot overwrite a newer explicit search', (
    tester,
  ) async {
    final oldLoad = Completer<AdminRestaurantLinkPagedResult>();
    final instances = <String>[];
    var calls = 0;
    await _pumpPagedScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
            required searchInstanceId,
            required clientRequestId,
            required needsQrPreparation,
            cursor,
            resolvedSearchCenter,
          }) {
            calls += 1;
            instances.add(searchInstanceId);
            if (calls == 1) {
              return Future.value(
                _pagedResult(
                  records: [
                    _biteScoreRecord(
                      documentId: 'old-first',
                      preparation: _availablePreparation('old-first'),
                    ),
                  ],
                  hasNext: true,
                  nextCursor: _pageCursor('old-next'),
                ),
              );
            }
            if (calls == 2) {
              return oldLoad.future;
            }
            return Future.value(
              _pagedResult(
                records: [
                  _biteScoreRecord(
                    documentId: 'new-search',
                    preparation: _availablePreparation('new-search'),
                  ),
                ],
              ),
            );
          },
    );
    await _submitSearch(tester);
    final oldSelection = await _scrollToAdminKey(
      tester,
      const ValueKey('biteScore:old-first:batch-selection'),
    );
    await tester.tap(oldSelection);
    await tester.pump();
    final loadMore = await _scrollToAdminKey(
      tester,
      const ValueKey('admin-link-load-more-button'),
    );
    await tester.tap(loadMore);
    await tester.pump();

    final nameField = await _scrollToAdminKey(
      tester,
      const ValueKey('admin-link-restaurant-name-field'),
      delta: -600,
      settle: false,
    );
    await tester.enterText(nameField, 'Fresh');
    final searchButton = await _scrollToAdminKey(
      tester,
      const ValueKey('admin-link-search-button'),
      settle: false,
    );
    await tester.tap(searchButton);
    await tester.pumpAndSettle();
    await _scrollToAdminKey(
      tester,
      const ValueKey('admin-link-record-biteScore:new-search'),
    );
    expect(
      find.byKey(const ValueKey('admin-link-record-biteScore:new-search')),
      findsOneWidget,
    );
    expect(instances[2], isNot(instances[0]));
    await _scrollToAdminKey(
      tester,
      const ValueKey('admin-link-selected-count'),
      delta: -700,
    );
    expect(find.text('0 selected'), findsOneWidget);

    oldLoad.complete(
      _pagedResult(
        records: [
          _biteScoreRecord(
            documentId: 'old-late',
            preparation: _availablePreparation('old-late'),
          ),
        ],
      ),
    );
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey('admin-link-record-biteScore:new-search')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('admin-link-record-biteScore:old-late')),
      findsNothing,
    );
  });

  testWidgets('hundreds of accumulated results use lazy card construction', (
    tester,
  ) async {
    final records = List.generate(
      400,
      (index) => _biteScoreRecord(
        documentId: 'lazy-${index.toString().padLeft(3, '0')}',
        name: 'Lazy Restaurant $index',
        orderDistanceMillimeters: index,
      ),
    );
    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
          }) async => _result(records: records),
    );
    await _submitSearch(tester);

    final builtCards = find.byWidgetPredicate((widget) {
      final key = widget.key;
      return key is ValueKey<String> &&
          key.value.startsWith('admin-link-record-');
    });
    expect(builtCards.evaluate().length, lessThan(20));
    expect(find.text('Lazy Restaurant 399'), findsNothing);
    await tester.scrollUntilVisible(
      find.byKey(const ValueKey('admin-link-record-biteScore:lazy-399')),
      700,
      scrollable: find.byType(Scrollable).first,
      maxScrolls: 500,
    );
    expect(find.text('Lazy Restaurant 399'), findsOneWidget);
  });

  testWidgets('append preserves the primary scroll offset from 10 to 11 rows', (
    tester,
  ) async {
    await _expectAppendPreservesScrollOffset(
      tester,
      initialCount: 10,
      appendedCount: 1,
    );
  });

  testWidgets(
    'append preserves the primary scroll offset from 50 to 100 rows',
    (tester) async {
      await _expectAppendPreservesScrollOffset(
        tester,
        initialCount: 50,
        appendedCount: 50,
      );
    },
  );

  testWidgets('new explicit keyboard search resets the primary scroll offset', (
    tester,
  ) async {
    var calls = 0;
    await _pumpPagedScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
            required searchInstanceId,
            required clientRequestId,
            required needsQrPreparation,
            cursor,
            resolvedSearchCenter,
          }) async {
            calls += 1;
            return _pagedResult(
              records: _orderedRecords(
                prefix: 'search-$calls',
                start: 0,
                count: 50,
              ),
            );
          },
    );
    await _submitSearch(tester);
    final list = tester.widget<ListView>(
      find.byKey(const ValueKey('admin-link-generation-scroll-view')),
    );
    final controller = list.controller!;
    final nameField = await _scrollToAdminKey(
      tester,
      const ValueKey('admin-link-restaurant-name-field'),
      delta: -700,
    );
    await tester.enterText(nameField, 'Fresh search');
    controller.jumpTo(controller.position.maxScrollExtent);
    await tester.pump();
    expect(controller.offset, greaterThan(0));

    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pumpAndSettle();

    expect(calls, 2);
    expect(controller.offset, 0);
  });

  testWidgets('initial state gives instructions and performs no search', (
    tester,
  ) async {
    var calls = 0;
    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
          }) async {
            calls += 1;
            return _result();
          },
    );

    expect(
      find.text('Enter a ZIP code or City, ST to find restaurants.'),
      findsOneWidget,
    );
    expect(calls, 0);
  });

  testWidgets('invalid location is rejected before search', (tester) async {
    var calls = 0;
    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
          }) async {
            calls += 1;
            return _result();
          },
    );

    await _submitSearch(tester, location: 'Crystal River');

    expect(
      find.text('Enter a five-digit ZIP code or City, ST.'),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('admin-link-no-results-state')),
      findsNothing,
    );
    expect(
      find.byKey(const ValueKey('admin-link-initial-state')),
      findsOneWidget,
    );
    expect(calls, 0);
  });

  testWidgets('empty location stays instructional and never calls search', (
    tester,
  ) async {
    var calls = 0;
    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
          }) async {
            calls += 1;
            return _result();
          },
    );

    await _submitSearch(tester, location: '');

    expect(
      find.text('Enter a five-digit ZIP code or City, ST.'),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('admin-link-no-results-state')),
      findsNothing,
    );
    expect(
      find.byKey(const ValueKey('admin-link-initial-state')),
      findsOneWidget,
    );
    expect(calls, 0);
  });

  testWidgets(
    'whitespace location stays instructional and never calls search',
    (tester) async {
      var calls = 0;
      await _pumpScreen(
        tester,
        search:
            ({
              required locationQuery,
              required radiusMiles,
              required restaurantName,
              required sources,
            }) async {
              calls += 1;
              return _result();
            },
      );

      await _submitSearch(tester, location: '   ');

      expect(
        find.text('Enter a five-digit ZIP code or City, ST.'),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('admin-link-no-results-state')),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('admin-link-initial-state')),
        findsOneWidget,
      );
      expect(calls, 0);
    },
  );

  testWidgets('keyboard search action submits a valid ZIP', (tester) async {
    var calls = 0;
    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
          }) async {
            calls += 1;
            return _result();
          },
    );

    await tester.enterText(
      find.byKey(const ValueKey('admin-link-location-field')),
      '34428',
    );
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pumpAndSettle();

    expect(calls, 1);
  });

  testWidgets('submits City, ST, radius, optional name, and selected source', (
    tester,
  ) async {
    String? capturedLocation;
    String? capturedName;
    int? capturedRadius;
    Set<AdminRestaurantLinkSource>? capturedSources;
    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
          }) async {
            capturedLocation = locationQuery;
            capturedName = restaurantName;
            capturedRadius = radiusMiles;
            capturedSources = sources;
            return _result();
          },
    );

    await tester.enterText(
      find.byKey(const ValueKey('admin-link-location-field')),
      'Crystal River, FL',
    );
    await tester.enterText(
      find.byKey(const ValueKey('admin-link-restaurant-name-field')),
      'River Grill',
    );
    await tester.tap(find.byKey(const ValueKey('admin-link-radius-field')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('20 miles').last);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('admin-link-source-biteSaver')));
    await tester.tap(find.byKey(const ValueKey('admin-link-search-button')));
    await tester.pumpAndSettle();

    expect(capturedLocation, 'Crystal River, FL');
    expect(capturedName, 'River Grill');
    expect(capturedRadius, 20);
    expect(capturedSources, {AdminRestaurantLinkSource.biteScore});
  });

  testWidgets('source controls always retain at least one selected source', (
    tester,
  ) async {
    await _pumpScreen(tester, search: _emptySearch);

    await tester.tap(find.byKey(const ValueKey('admin-link-source-biteScore')));
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('admin-link-source-biteSaver')));
    await tester.pump();

    final biteSaverChip = tester.widget<FilterChip>(
      find.byKey(const ValueKey('admin-link-source-biteSaver')),
    );
    expect(biteSaverChip.selected, isTrue);
    expect(find.text('Select at least one restaurant source.'), findsOneWidget);
  });

  testWidgets('loading state prevents duplicate submissions', (tester) async {
    final completer = Completer<AdminRestaurantLinkSearchResult>();
    var calls = 0;
    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
          }) {
            calls += 1;
            return completer.future;
          },
    );

    await tester.enterText(
      find.byKey(const ValueKey('admin-link-location-field')),
      '34428',
    );
    await tester.tap(find.byKey(const ValueKey('admin-link-search-button')));
    await tester.pump();

    expect(
      find.byKey(const ValueKey('admin-link-loading-state')),
      findsOneWidget,
    );
    final button = tester.widget<FilledButton>(
      find.byKey(const ValueKey('admin-link-search-button')),
    );
    expect(button.onPressed, isNull);
    expect(calls, 1);

    completer.complete(_result());
    await tester.pumpAndSettle();
    expect(calls, 1);
  });

  testWidgets('shows no-results, backend-error, and truncation states', (
    tester,
  ) async {
    await _pumpScreen(tester, search: _emptySearch);
    await _submitSearch(tester);
    expect(
      find.text('No matching restaurants were found within this search area.'),
      findsOneWidget,
    );

    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
          }) async => throw const AdminLinkGenerationException(
            'Restaurant search is temporarily unavailable.',
          ),
    );
    await _submitSearch(tester);
    expect(
      find.text('Restaurant search is temporarily unavailable.'),
      findsOneWidget,
    );

    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
          }) async => _result(
            records: [_biteScoreRecord(documentId: 'limited')],
            truncated: true,
          ),
    );
    await _submitSearch(tester);
    expect(
      find.text(
        'Results were limited. Narrow the radius or add a restaurant name to refine the search.',
      ),
      findsOneWidget,
    );
  });

  testWidgets('same-name BiteScore and BiteSaver records remain separate', (
    tester,
  ) async {
    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
          }) async => _result(
            records: [
              _biteScoreRecord(documentId: 'score-doc'),
              _biteSaverRecord(
                documentId: 'saver-doc',
                actionId: 'account-uid',
              ),
            ],
          ),
    );

    await _submitSearch(tester);

    expect(find.text('River Grill'), findsNWidgets(2));
    expect(
      find.byKey(const ValueKey('admin-link-record-biteScore:score-doc')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('admin-link-record-biteSaver:saver-doc')),
      findsOneWidget,
    );
    expect(find.text('1 Main Street'), findsNWidgets(2));
    expect(find.text('1.3 miles away'), findsOneWidget);
    expect(find.text('1.5 miles away'), findsOneWidget);
  });

  testWidgets('responsive controls and actions do not overflow', (
    tester,
  ) async {
    final sizes = <Size>[
      const Size(320, 700),
      const Size(800, 360),
      const Size(1400, 900),
    ];
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    for (var index = 0; index < sizes.length; index += 1) {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = sizes[index];
      await _pumpScreen(
        tester,
        search:
            ({
              required locationQuery,
              required radiusMiles,
              required restaurantName,
              required sources,
            }) async => _result(
              records: [_biteScoreRecord(documentId: 'responsive-$index')],
            ),
        textScale: index == 0 ? 2 : 1,
        configureView: false,
      );
      await _submitSearch(tester);
      expect(tester.takeException(), isNull, reason: '${sizes[index]}');
      final customerLink = await _scrollToAdminKey(
        tester,
        ValueKey('biteScore:responsive-$index:customer-bitescore-link'),
      );
      await tester.tap(customerLink);
      await _pumpOpenDialog(tester);
      expect(tester.takeException(), isNull, reason: '${sizes[index]} dialog');
      expect(
        find.byKey(const ValueKey('admin-link-action-dialog')),
        findsOneWidget,
      );
      await tester.tap(find.byKey(const ValueKey('close-link-action-dialog')));
      await tester.pumpAndSettle();
    }
  });

  testWidgets('BiteScore actions use safe prefill and actual document ID', (
    tester,
  ) async {
    Map<String, Object?>? couponArguments;
    String? claimRestaurantId;
    final copiedLinks = <String>[];
    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
          }) async => _result(
            records: [_biteScoreRecord(documentId: 'actual-score-doc')],
          ),
      createCouponInvite:
          ({
            required restaurantName,
            required restaurantId,
            required biteScoreCatalogRestaurantId,
            required streetAddress,
            required city,
            required state,
            required zipCode,
            required phone,
            required website,
            required latitude,
            required longitude,
          }) async {
            couponArguments = {
              'restaurantName': restaurantName,
              'restaurantId': restaurantId,
              'biteScoreCatalogRestaurantId': biteScoreCatalogRestaurantId,
              'streetAddress': streetAddress,
              'city': city,
              'state': state,
              'zipCode': zipCode,
              'phone': phone,
              'website': website,
              'latitude': latitude,
              'longitude': longitude,
            };
            return _invite(
              'https://go.bitestar.app/invite/coupon/secure-token',
            );
          },
      createClaimInvite: ({required restaurantId}) async {
        claimRestaurantId = restaurantId;
        return _invite('https://go.bitestar.app/invite/bitescore/claim-token');
      },
      writeClipboard: (value) async => copiedLinks.add(value),
    );
    await _submitSearch(tester);

    expect(
      find.byKey(const ValueKey('biteScore:actual-score-doc:coupon-invite')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('biteScore:actual-score-doc:claim-invite')),
      findsOneWidget,
    );
    expect(
      find.byKey(
        const ValueKey('biteScore:actual-score-doc:customer-bitesaver-link'),
      ),
      findsOneWidget,
    );
    expect(
      find.byKey(
        const ValueKey('biteScore:actual-score-doc:customer-bitescore-link'),
      ),
      findsOneWidget,
    );

    final couponButton = find.byKey(
      const ValueKey('biteScore:actual-score-doc:coupon-invite'),
    );
    await tester.ensureVisible(couponButton);
    await tester.tap(couponButton);
    await _pumpOpenDialog(tester);

    expect(couponArguments?['restaurantId'], isNull);
    expect(
      couponArguments?['biteScoreCatalogRestaurantId'],
      'actual-score-doc',
    );
    expect(couponArguments?['restaurantName'], 'River Grill');
    expect(couponArguments?['streetAddress'], '1 Main Street');
    expect(find.byKey(const ValueKey('admin-link-action-url')), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('copy-link-action')));
    await tester.pump();
    expect(copiedLinks, ['https://go.bitestar.app/invite/coupon/secure-token']);
    await tester.tap(find.text('Close'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('admin-link-action-url')), findsNothing);

    final claimButton = find.byKey(
      const ValueKey('biteScore:actual-score-doc:claim-invite'),
    );
    await tester.ensureVisible(claimButton);
    await tester.tap(claimButton);
    await _pumpOpenDialog(tester);
    expect(claimRestaurantId, 'actual-score-doc');
    await tester.tap(find.text('Close'));
    await tester.pumpAndSettle();
  });

  testWidgets('claimed BiteScore record keeps independent BiteSaver actions', (
    tester,
  ) async {
    var claimCalls = 0;
    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
          }) async => _result(
            records: [
              _biteScoreRecord(documentId: 'claimed-doc', isClaimed: true),
            ],
          ),
      createClaimInvite: ({required restaurantId}) async {
        claimCalls += 1;
        return _invite('https://go.bitestar.app/invite/bitescore/token');
      },
    );

    await _submitSearch(tester);

    expect(find.text('Already claimed'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('biteScore:claimed-doc:claim-invite')),
      findsNothing,
    );
    expect(
      find.byKey(const ValueKey('biteScore:claimed-doc:coupon-invite')),
      findsOneWidget,
    );
    expect(
      find.byKey(
        const ValueKey('biteScore:claimed-doc:customer-bitesaver-link'),
      ),
      findsOneWidget,
    );
    expect(
      find.byKey(
        const ValueKey('biteScore:claimed-doc:customer-bitescore-link'),
      ),
      findsOneWidget,
    );
    expect(claimCalls, 0);
  });

  testWidgets('four cross-side states expose exactly the required actions', (
    tester,
  ) async {
    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
          }) async => _result(
            records: [
              _biteScoreRecord(documentId: 'neither'),
              _biteScoreRecord(documentId: 'score-claimed', isClaimed: true),
              _biteScoreRecord(
                documentId: 'saver-bound',
                biteSaverCatalogBindingState:
                    AdminBiteSaverCatalogBindingState.bound,
              ),
              _biteScoreRecord(
                documentId: 'both',
                isClaimed: true,
                biteSaverCatalogBindingState:
                    AdminBiteSaverCatalogBindingState.bound,
              ),
            ],
          ),
    );

    await _submitSearch(tester);

    const actionSuffixes = <String>{
      'coupon-invite',
      'claim-invite',
      'customer-bitesaver-link',
      'customer-bitescore-link',
    };
    const expectedActions = <String, Set<String>>{
      'neither': <String>{
        'coupon-invite',
        'claim-invite',
        'customer-bitesaver-link',
        'customer-bitescore-link',
      },
      'score-claimed': <String>{
        'coupon-invite',
        'customer-bitesaver-link',
        'customer-bitescore-link',
      },
      'saver-bound': <String>{
        'claim-invite',
        'customer-bitesaver-link',
        'customer-bitescore-link',
      },
      'both': <String>{'customer-bitesaver-link', 'customer-bitescore-link'},
    };
    for (final state in expectedActions.entries) {
      for (final suffix in actionSuffixes) {
        expect(
          find.byKey(ValueKey('biteScore:${state.key}:$suffix')),
          state.value.contains(suffix) ? findsOneWidget : findsNothing,
          reason: '${state.key}:$suffix',
        );
      }
    }
    expect(find.text('BiteSaver Owner Invite'), findsNWidgets(2));
    expect(find.text('BiteScore Claim Invite'), findsNWidgets(2));
    expect(find.text('Customer BiteSaver'), findsNWidgets(4));
    expect(find.text('Customer BiteScore'), findsNWidgets(4));
    expect(find.textContaining('Repair'), findsNothing);
  });

  testWidgets(
    'hidden and malformed BiteScore records show unavailable without claim actions',
    (tester) async {
      var claimCalls = 0;
      await _pumpScreen(
        tester,
        search:
            ({
              required locationQuery,
              required radiusMiles,
              required restaurantName,
              required sources,
            }) async => _result(
              records: [
                _biteScoreRecord(
                  documentId: 'hidden-doc',
                  isActive: false,
                  claimAvailable: false,
                  claimStateValid: false,
                ),
                _biteScoreRecord(
                  documentId: 'malformed-doc',
                  ownerUserId: 'contradictory-owner',
                  claimAvailable: false,
                  claimStateValid: false,
                  biteSaverCatalogBindingState:
                      AdminBiteSaverCatalogBindingState.unavailable,
                ),
              ],
            ),
        createClaimInvite: ({required restaurantId}) async {
          claimCalls += 1;
          throw StateError('must not be called');
        },
      );

      await _submitSearch(tester);

      expect(
        find.text('Inactive • Claim unavailable • BiteSaver Unbound'),
        findsOneWidget,
      );
      expect(
        find.text('Active • Claim unavailable • BiteSaver Unavailable'),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('biteScore:hidden-doc:claim-invite')),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('biteScore:malformed-doc:claim-invite')),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('biteScore:malformed-doc:coupon-invite')),
        findsNothing,
      );
      expect(
        find.byKey(
          const ValueKey('biteScore:malformed-doc:customer-bitescore-link'),
        ),
        findsOneWidget,
      );
      expect(
        find.byKey(
          const ValueKey('biteScore:malformed-doc:customer-bitesaver-link'),
        ),
        findsNothing,
      );
      expect(
        find.byKey(
          const ValueKey('biteScore:hidden-doc:customer-bitescore-link'),
        ),
        findsNothing,
      );
      expect(
        find.byKey(
          const ValueKey('biteScore:hidden-doc:customer-bitesaver-link'),
        ),
        findsNothing,
      );
      expect(claimCalls, 0);
    },
  );

  testWidgets('customer links use separate permanent source actions', (
    tester,
  ) async {
    final copied = <String>[];
    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
          }) async => _result(
            records: [
              _biteScoreRecord(documentId: 'score-link-doc'),
              _biteSaverRecord(
                documentId: 'saver-link-doc',
                actionId: 'canonical-account-uid',
                approvalStatus: 'approved',
              ),
              _biteSaverRecord(
                documentId: 'pending-doc',
                actionId: 'pending-uid',
                approvalStatus: 'pending',
              ),
            ],
          ),
      writeClipboard: (value) async => copied.add(value),
    );
    await _submitSearch(tester);

    final biteScoreBiteSaverLink = find.byKey(
      const ValueKey('biteScore:score-link-doc:customer-bitesaver-link'),
    );
    await tester.ensureVisible(biteScoreBiteSaverLink);
    expect(find.text('Customer BiteSaver'), findsNWidgets(2));
    await tester.tap(biteScoreBiteSaverLink);
    await _pumpOpenDialog(tester);
    expect(find.text('Customer BiteSaver Link'), findsOneWidget);
    expect(
      find.text('https://go.bitestar.app/r/coupons/score-link-doc'),
      findsOneWidget,
    );
    await tester.tap(find.byKey(const ValueKey('copy-link-action')));
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('close-link-action-dialog')));
    await tester.pumpAndSettle();

    final biteScoreLink = find.byKey(
      const ValueKey('biteScore:score-link-doc:customer-bitescore-link'),
    );
    await tester.ensureVisible(biteScoreLink);
    expect(find.text('Customer BiteScore'), findsOneWidget);
    await tester.tap(biteScoreLink);
    await _pumpOpenDialog(tester);
    expect(find.text('Customer BiteScore Link'), findsOneWidget);
    expect(
      find.text('https://go.bitestar.app/r/bitescore/score-link-doc'),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('copy-link-action')), findsOneWidget);
    expect(find.byKey(const ValueKey('create-link-qr')), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('copy-link-action')));
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('close-link-action-dialog')));
    await tester.pumpAndSettle();

    final biteSaverLink = find.byKey(
      const ValueKey('biteSaver:saver-link-doc:customer-bitesaver-link'),
    );
    await tester.ensureVisible(biteSaverLink);
    expect(find.text('Customer BiteSaver'), findsNWidgets(2));
    await tester.tap(biteSaverLink);
    await _pumpOpenDialog(tester);
    expect(
      find.text('https://go.bitestar.app/r/coupons/saver-link-doc'),
      findsOneWidget,
    );
    await tester.tap(find.byKey(const ValueKey('copy-link-action')));
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('close-link-action-dialog')));
    await tester.pumpAndSettle();

    expect(copied, [
      'https://go.bitestar.app/r/coupons/score-link-doc',
      'https://go.bitestar.app/r/bitescore/score-link-doc',
      'https://go.bitestar.app/r/coupons/saver-link-doc',
    ]);
    expect(
      find.byKey(
        const ValueKey('biteSaver:pending-doc:customer-bitesaver-link'),
      ),
      findsNothing,
    );
    expect(
      find.byKey(const ValueKey('biteScore:score-link-doc:customer-qr')),
      findsNothing,
    );
    expect(
      find.byKey(const ValueKey('biteSaver:saver-link-doc:customer-qr')),
      findsNothing,
    );
    expect(find.text('Copy Customer BiteScore Link'), findsNothing);
    expect(find.text('Copy Customer Coupon Link'), findsNothing);
    expect(find.text('Create Customer QR'), findsNothing);

    final saverCard = find.byKey(
      const ValueKey('admin-link-record-biteSaver:saver-link-doc'),
    );
    expect(
      find.descendant(
        of: saverCard,
        matching: find.text('BiteScore Claim Invite'),
      ),
      findsNothing,
    );
    expect(
      find.descendant(of: saverCard, matching: find.text('Customer BiteScore')),
      findsNothing,
    );

    final scoreCard = find.byKey(
      const ValueKey('admin-link-record-biteScore:score-link-doc'),
    );
    expect(
      find.descendant(of: scoreCard, matching: find.text('Customer BiteSaver')),
      findsOneWidget,
    );
  });

  testWidgets('BiteSaver owner invite uses canonical account action ID', (
    tester,
  ) async {
    String? capturedRestaurantId;
    String? capturedCatalogRestaurantId;
    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
          }) async => _result(
            records: [
              _biteSaverRecord(
                documentId: 'account-document',
                actionId: 'canonical-account-uid',
                approvalStatus: 'approved',
              ),
            ],
          ),
      createCouponInvite:
          ({
            required restaurantName,
            required restaurantId,
            required biteScoreCatalogRestaurantId,
            required streetAddress,
            required city,
            required state,
            required zipCode,
            required phone,
            required website,
            required latitude,
            required longitude,
          }) async {
            capturedRestaurantId = restaurantId;
            capturedCatalogRestaurantId = biteScoreCatalogRestaurantId;
            return _invite('https://go.bitestar.app/invite/coupon/token');
          },
    );

    await _submitSearch(tester);
    final button = find.byKey(
      const ValueKey('biteSaver:account-document:coupon-invite'),
    );
    await tester.ensureVisible(button);
    await tester.tap(button);
    await _pumpOpenDialog(tester);

    expect(capturedRestaurantId, 'canonical-account-uid');
    expect(capturedCatalogRestaurantId, isNull);
    await tester.tap(find.text('Close'));
    await tester.pumpAndSettle();
  });

  testWidgets(
    'copies trimmed BiteScore and BiteSaver public mailing fields only',
    (tester) async {
      final copied = <String>[];
      var searchCalls = 0;
      var mutationCalls = 0;
      var qrCalls = 0;
      await _pumpScreen(
        tester,
        search:
            ({
              required locationQuery,
              required radiusMiles,
              required restaurantName,
              required sources,
            }) async {
              searchCalls += 1;
              return _result(
                records: [
                  _biteScoreRecord(
                    documentId: 'mailing-score',
                    name: '  Score Place  ',
                    streetAddress: '  10 Score Road  ',
                    city: '  Crystal River  ',
                    state: '  FL  ',
                    zipCode: '  34428  ',
                  ),
                  _biteSaverRecord(
                    documentId: 'mailing-saver',
                    actionId: 'mailing-saver-owner',
                    name: 'Saver Place',
                    streetAddress: '20 Saver Avenue',
                    city: 'Inverness',
                    state: 'FL',
                    zipCode: '34450',
                  ),
                ],
              );
            },
        createCouponInvite:
            ({
              required restaurantName,
              required restaurantId,
              required biteScoreCatalogRestaurantId,
              required streetAddress,
              required city,
              required state,
              required zipCode,
              required phone,
              required website,
              required latitude,
              required longitude,
            }) async {
              mutationCalls += 1;
              return _invite('https://example.test/unused-coupon-invite');
            },
        createClaimInvite: ({required restaurantId}) async {
          mutationCalls += 1;
          return _invite('https://example.test/unused-claim-invite');
        },
        writeClipboard: (value) async => copied.add(value),
        renderQrImage:
            ({required restaurantName, required url, required linkType}) async {
              qrCalls += 1;
              return _qrImage(restaurantName, linkType);
            },
      );
      await _submitSearch(tester);
      expect(find.text('Copy Mailing Address'), findsNWidgets(2));

      final biteScoreAction = find.byKey(
        const ValueKey('biteScore:mailing-score:copy-mailing-address'),
      );
      await tester.ensureVisible(biteScoreAction);
      await tester.tap(biteScoreAction);
      await tester.pump();
      expect(copied, ['Score Place\n10 Score Road\nCrystal River, FL 34428']);
      expect(find.text('Mailing address copied.'), findsOneWidget);

      final biteSaverAction = find.byKey(
        const ValueKey('biteSaver:mailing-saver:copy-mailing-address'),
      );
      await tester.ensureVisible(biteSaverAction);
      await tester.tap(biteSaverAction);
      await tester.pump();
      expect(copied, [
        'Score Place\n10 Score Road\nCrystal River, FL 34428',
        'Saver Place\n20 Saver Avenue\nInverness, FL 34450',
      ]);
      expect(searchCalls, 1);
      expect(mutationCalls, 0);
      expect(qrCalls, 0);
    },
  );

  testWidgets('incomplete mailing fields fail without clipboard writes', (
    tester,
  ) async {
    final copied = <String>[];
    final records = [
      _biteScoreRecord(documentId: 'missing-name', name: '   '),
      _biteScoreRecord(documentId: 'missing-street', streetAddress: '\t'),
      _biteScoreRecord(documentId: 'missing-city', city: '   '),
      _biteScoreRecord(documentId: 'missing-state', state: '\n'),
      _biteScoreRecord(documentId: 'missing-zip', zipCode: '   '),
    ];
    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
          }) async => _result(records: records),
      writeClipboard: (value) async => copied.add(value),
    );
    await _submitSearch(tester);

    for (final record in records) {
      final action = find.byKey(
        ValueKey('${record.recordKey}:copy-mailing-address'),
      );
      await tester.ensureVisible(action);
      await tester.tap(action);
      await tester.pump();
      expect(copied, isEmpty, reason: record.documentId);
      expect(
        find.text('Mailing address is incomplete.'),
        findsOneWidget,
        reason: record.documentId,
      );
    }
  });

  testWidgets('mailing clipboard exceptions show controlled feedback', (
    tester,
  ) async {
    var clipboardAttempts = 0;
    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
          }) async => _result(
            records: [_biteScoreRecord(documentId: 'mailing-failure')],
          ),
      writeClipboard: (_) async {
        clipboardAttempts += 1;
        throw StateError('clipboard denied');
      },
    );
    await _submitSearch(tester);

    final action = find.byKey(
      const ValueKey('biteScore:mailing-failure:copy-mailing-address'),
    );
    await tester.ensureVisible(action);
    await tester.tap(action);
    await tester.pump();

    expect(clipboardAttempts, 1);
    expect(find.text('Could not copy the mailing address.'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'clipboard failures show controlled feedback for both link types',
    (tester) async {
      await _pumpScreen(
        tester,
        search:
            ({
              required locationQuery,
              required radiusMiles,
              required restaurantName,
              required sources,
            }) async => _result(
              records: [_biteScoreRecord(documentId: 'clipboard-doc')],
            ),
        createCouponInvite:
            ({
              required restaurantName,
              required restaurantId,
              required biteScoreCatalogRestaurantId,
              required streetAddress,
              required city,
              required state,
              required zipCode,
              required phone,
              required website,
              required latitude,
              required longitude,
            }) async => _invite('https://go.bitestar.app/invite/coupon/token'),
        writeClipboard: (_) async => throw StateError('clipboard denied'),
      );
      await _submitSearch(tester);

      final customerLink = find.byKey(
        const ValueKey('biteScore:clipboard-doc:customer-bitescore-link'),
      );
      await tester.ensureVisible(customerLink);
      await tester.tap(customerLink);
      await _pumpOpenDialog(tester);
      await tester.tap(find.byKey(const ValueKey('copy-link-action')));
      await tester.pump();
      expect(find.text('Could not copy the link.'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('close-link-action-dialog')));
      await tester.pumpAndSettle();

      final inviteButton = find.byKey(
        const ValueKey('biteScore:clipboard-doc:coupon-invite'),
      );
      await tester.ensureVisible(inviteButton);
      await tester.tap(inviteButton);
      await _pumpOpenDialog(tester);
      await tester.tap(find.byKey(const ValueKey('copy-link-action')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 600));
      expect(find.text('Could not copy the link.'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('close-link-action-dialog')));
      await tester.pumpAndSettle();
    },
  );

  testWidgets(
    'customer dialogs create QR images from the displayed helper URL',
    (tester) async {
      final rendered =
          <
            ({String restaurantName, String url, RestaurantQrLinkType linkType})
          >[];
      await _pumpScreen(
        tester,
        search:
            ({
              required locationQuery,
              required radiusMiles,
              required restaurantName,
              required sources,
            }) async => _result(
              records: [
                _biteScoreRecord(
                  documentId: 'score-qr-doc',
                  name: 'Score Place',
                ),
                _biteSaverRecord(
                  documentId: 'saver-qr-doc',
                  actionId: 'approved-account-uid',
                  approvalStatus: 'approved',
                ),
                _biteSaverRecord(
                  documentId: 'pending-qr-doc',
                  actionId: 'pending-account-uid',
                ),
              ],
            ),
        renderQrImage:
            ({required restaurantName, required url, required linkType}) async {
              rendered.add((
                restaurantName: restaurantName,
                url: url,
                linkType: linkType,
              ));
              return _qrImage(restaurantName, linkType);
            },
      );
      await _submitSearch(tester);

      final scoreLink = find.byKey(
        const ValueKey('biteScore:score-qr-doc:customer-bitescore-link'),
      );
      await tester.ensureVisible(scoreLink);
      await tester.tap(scoreLink);
      await _pumpOpenDialog(tester);
      expect(
        find.text('https://go.bitestar.app/r/bitescore/score-qr-doc'),
        findsOneWidget,
      );
      await tester.tap(find.byKey(const ValueKey('create-link-qr')));
      await _pumpOpenDialog(tester);
      expect(
        find.byKey(const ValueKey('restaurant-qr-preview-dialog')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('restaurant-qr-sensitive-warning')),
        findsNothing,
      );
      await tester.tap(
        find.byKey(const ValueKey('restaurant-qr-preview-close')),
      );
      await tester.pumpAndSettle();

      final catalogBiteSaverLink = find.byKey(
        const ValueKey('biteScore:score-qr-doc:customer-bitesaver-link'),
      );
      await tester.ensureVisible(catalogBiteSaverLink);
      await tester.tap(catalogBiteSaverLink);
      await _pumpOpenDialog(tester);
      expect(
        find.text('https://go.bitestar.app/r/coupons/score-qr-doc'),
        findsOneWidget,
      );
      await tester.tap(find.byKey(const ValueKey('create-link-qr')));
      await _pumpOpenDialog(tester);
      await tester.tap(
        find.byKey(const ValueKey('restaurant-qr-preview-close')),
      );
      await tester.pumpAndSettle();

      final saverLink = find.byKey(
        const ValueKey('biteSaver:saver-qr-doc:customer-bitesaver-link'),
      );
      await tester.ensureVisible(saverLink);
      await tester.tap(saverLink);
      await _pumpOpenDialog(tester);
      expect(
        find.text('https://go.bitestar.app/r/coupons/saver-qr-doc'),
        findsOneWidget,
      );
      await tester.tap(find.byKey(const ValueKey('create-link-qr')));
      await _pumpOpenDialog(tester);
      await tester.tap(
        find.byKey(const ValueKey('restaurant-qr-preview-close')),
      );
      await tester.pumpAndSettle();

      expect(
        find.byKey(
          const ValueKey('biteSaver:pending-qr-doc:customer-bitesaver-link'),
        ),
        findsNothing,
      );
      expect(rendered, [
        (
          restaurantName: 'Score Place',
          url: 'https://go.bitestar.app/r/bitescore/score-qr-doc',
          linkType: RestaurantQrLinkType.customerBiteScore,
        ),
        (
          restaurantName: 'Score Place',
          url: 'https://go.bitestar.app/r/coupons/score-qr-doc',
          linkType: RestaurantQrLinkType.customerBiteSaver,
        ),
        (
          restaurantName: 'River Grill',
          url: 'https://go.bitestar.app/r/coupons/saver-qr-doc',
          linkType: RestaurantQrLinkType.customerBiteSaver,
        ),
      ]);
    },
  );

  testWidgets('secure invite QR reuses each invitation URL exactly once', (
    tester,
  ) async {
    var couponCalls = 0;
    var claimCalls = 0;
    String? ownerInviteCatalogId;
    final rendered =
        <
          ({String restaurantName, String url, RestaurantQrLinkType linkType})
        >[];
    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
          }) async => _result(
            records: [
              _biteScoreRecord(
                documentId: 'secure-qr-doc',
                name: 'Secure River Grill',
              ),
            ],
          ),
      createCouponInvite:
          ({
            required restaurantName,
            required restaurantId,
            required biteScoreCatalogRestaurantId,
            required streetAddress,
            required city,
            required state,
            required zipCode,
            required phone,
            required website,
            required latitude,
            required longitude,
          }) async {
            couponCalls += 1;
            ownerInviteCatalogId = biteScoreCatalogRestaurantId;
            return _invite(
              'https://go.bitestar.app/invite/coupon/fake-secure-token',
            );
          },
      createClaimInvite: ({required restaurantId}) async {
        claimCalls += 1;
        return _invite(
          'https://go.bitestar.app/invite/bitescore/fake-claim-token',
        );
      },
      renderQrImage:
          ({required restaurantName, required url, required linkType}) async {
            rendered.add((
              restaurantName: restaurantName,
              url: url,
              linkType: linkType,
            ));
            return _qrImage(restaurantName, linkType);
          },
    );
    await _submitSearch(tester);

    final couponInvite = find.byKey(
      const ValueKey('biteScore:secure-qr-doc:coupon-invite'),
    );
    await tester.ensureVisible(couponInvite);
    await tester.tap(couponInvite);
    await _pumpOpenDialog(tester);
    expect(couponCalls, 1);
    expect(ownerInviteCatalogId, 'secure-qr-doc');
    await tester.tap(find.byKey(const ValueKey('create-link-qr')));
    await _pumpOpenDialog(tester);
    expect(
      find.byKey(const ValueKey('restaurant-qr-sensitive-warning')),
      findsOneWidget,
    );
    expect(find.textContaining('fake-secure-token'), findsNothing);
    await tester.tap(find.byKey(const ValueKey('restaurant-qr-preview-back')));
    await _pumpOpenDialog(tester);
    expect(couponCalls, 1);
    expect(find.byKey(const ValueKey('admin-link-action-url')), findsOneWidget);
    await tester.tap(find.text('Close'));
    await tester.pumpAndSettle();

    final claimInvite = find.byKey(
      const ValueKey('biteScore:secure-qr-doc:claim-invite'),
    );
    await tester.ensureVisible(claimInvite);
    await tester.tap(claimInvite);
    await _pumpOpenDialog(tester);
    expect(claimCalls, 1);
    await tester.tap(find.byKey(const ValueKey('create-link-qr')));
    await _pumpOpenDialog(tester);
    await tester.tap(find.byKey(const ValueKey('restaurant-qr-preview-close')));
    await tester.pumpAndSettle();

    expect(couponCalls, 1);
    expect(claimCalls, 1);
    expect(rendered, [
      (
        restaurantName: 'Secure River Grill',
        url: 'https://go.bitestar.app/invite/coupon/fake-secure-token',
        linkType: RestaurantQrLinkType.couponInvite,
      ),
      (
        restaurantName: 'Secure River Grill',
        url: 'https://go.bitestar.app/invite/bitescore/fake-claim-token',
        linkType: RestaurantQrLinkType.biteScoreClaimInvite,
      ),
    ]);
  });

  testWidgets(
    'preparation chips render all states and manual updates fail safely',
    (tester) async {
      final updates =
          <
            ({
              String catalogRestaurantId,
              AdminRestaurantPreparationType type,
              bool prepared,
              String? expectedInviteId,
            })
          >[];
      await _pumpScreen(
        tester,
        search:
            ({
              required locationQuery,
              required radiusMiles,
              required restaurantName,
              required sources,
            }) async => _result(
              records: [
                _biteScoreRecord(
                  documentId: 'preparation-doc',
                  preparation: _preparationState(
                    'preparation-doc',
                    ownerInvite: AdminRestaurantPreparationStatus.prepared,
                    claimInvite: AdminRestaurantPreparationStatus.unprepared,
                    biteSaverCustomer:
                        AdminRestaurantPreparationStatus.prepared,
                    biteScoreCustomer:
                        AdminRestaurantPreparationStatus.unprepared,
                  ),
                ),
              ],
            ),
        updatePreparation:
            ({
              required catalogRestaurantId,
              required type,
              required prepared,
              required biteSaverCatalogBindingState,
              required claimState,
              expectedInviteId,
            }) async {
              updates.add((
                catalogRestaurantId: catalogRestaurantId,
                type: type,
                prepared: prepared,
                expectedInviteId: expectedInviteId,
              ));
              if (type == AdminRestaurantPreparationType.ownerInvite) {
                throw const AdminLinkGenerationException(
                  'Preparation save was rejected safely.',
                );
              }
              return _preparationState(
                catalogRestaurantId,
                ownerInvite: AdminRestaurantPreparationStatus.prepared,
                claimInvite: prepared
                    ? AdminRestaurantPreparationStatus.prepared
                    : AdminRestaurantPreparationStatus.unprepared,
                biteSaverCustomer: AdminRestaurantPreparationStatus.prepared,
                biteScoreCustomer: AdminRestaurantPreparationStatus.unprepared,
              );
            },
      );
      await _submitSearch(tester);

      expect(find.text('I · Prepared'), findsOneWidget);
      expect(find.text('C · Unprepared'), findsOneWidget);
      expect(find.text('SA · Prepared'), findsOneWidget);
      expect(find.text('SR · Unprepared'), findsOneWidget);
      final selection = find.byKey(
        const ValueKey('biteScore:preparation-doc:batch-selection'),
      );
      await tester.tap(selection);
      await tester.pump();
      expect(tester.widget<Checkbox>(selection).value, isTrue);

      final claimChip = find.byKey(
        const ValueKey('biteScore:preparation-doc:preparation-C'),
      );
      await tester.ensureVisible(claimChip);
      await tester.tap(claimChip);
      await tester.pumpAndSettle();
      expect(updates.single, (
        catalogRestaurantId: 'preparation-doc',
        type: AdminRestaurantPreparationType.claimInvite,
        prepared: true,
        expectedInviteId: null,
      ));
      expect(find.text('C · Prepared'), findsOneWidget);
      expect(tester.widget<Checkbox>(selection).value, isTrue);

      final ownerChip = find.byKey(
        const ValueKey('biteScore:preparation-doc:preparation-I'),
      );
      await tester.ensureVisible(ownerChip);
      await tester.tap(ownerChip);
      await tester.pumpAndSettle();
      expect(updates, hasLength(2));
      expect(
        find.text('Preparation save was rejected safely.'),
        findsOneWidget,
      );
      expect(find.text('I · Prepared'), findsOneWidget);
      expect(tester.widget<Checkbox>(selection).value, isTrue);
    },
  );

  testWidgets(
    'only successful QR export marks exact permanent and invite types',
    (tester) async {
      final updates =
          <
            ({
              String catalogRestaurantId,
              AdminRestaurantPreparationType type,
              bool prepared,
              String? expectedInviteId,
            })
          >[];
      final exporter = RestaurantQrExporter(
        capabilities: const RestaurantQrExportCapabilities(
          canCopyImage: true,
          canDownloadPng: true,
        ),
        copyPng: (_) async {},
        downloadPng: (_, _) async {},
      );
      await _pumpScreen(
        tester,
        search:
            ({
              required locationQuery,
              required radiusMiles,
              required restaurantName,
              required sources,
            }) async => _result(
              records: [
                _biteScoreRecord(
                  documentId: 'export-doc',
                  preparation: _preparationState('export-doc'),
                ),
                _biteSaverRecord(
                  documentId: 'account-document-id',
                  actionId: 'account-uid',
                  approvalStatus: 'approved',
                ),
              ],
            ),
        createCouponInvite:
            ({
              required restaurantName,
              required restaurantId,
              required biteScoreCatalogRestaurantId,
              required streetAddress,
              required city,
              required state,
              required zipCode,
              required phone,
              required website,
              required latitude,
              required longitude,
            }) async => _invite(
              'https://go.bitestar.app/invite/coupon/exact-token',
              inviteId: 'owner-invite-id',
            ),
        createClaimInvite: ({required restaurantId}) async => _invite(
          'https://go.bitestar.app/invite/bitescore/exact-token',
          inviteId: 'claim-invite-id',
        ),
        writeClipboard: (_) async {},
        renderQrImage:
            ({
              required restaurantName,
              required url,
              required linkType,
            }) async => _qrImage(restaurantName, linkType),
        qrExporter: exporter,
        updatePreparation:
            ({
              required catalogRestaurantId,
              required type,
              required prepared,
              required biteSaverCatalogBindingState,
              required claimState,
              expectedInviteId,
            }) async {
              updates.add((
                catalogRestaurantId: catalogRestaurantId,
                type: type,
                prepared: prepared,
                expectedInviteId: expectedInviteId,
              ));
              return _preparationState(
                catalogRestaurantId,
                ownerInvite: type == AdminRestaurantPreparationType.ownerInvite
                    ? AdminRestaurantPreparationStatus.prepared
                    : AdminRestaurantPreparationStatus.unprepared,
                claimInvite: type == AdminRestaurantPreparationType.claimInvite
                    ? AdminRestaurantPreparationStatus.prepared
                    : AdminRestaurantPreparationStatus.unprepared,
                biteSaverCustomer:
                    type == AdminRestaurantPreparationType.biteSaverCustomer
                    ? AdminRestaurantPreparationStatus.prepared
                    : AdminRestaurantPreparationStatus.unprepared,
                biteScoreCustomer:
                    type == AdminRestaurantPreparationType.biteScoreCustomer
                    ? AdminRestaurantPreparationStatus.prepared
                    : AdminRestaurantPreparationStatus.unprepared,
              );
            },
      );
      await _submitSearch(tester);

      final customerLink = find.byKey(
        const ValueKey('biteScore:export-doc:customer-bitescore-link'),
      );
      await tester.ensureVisible(customerLink);
      await tester.tap(customerLink);
      await _pumpOpenDialog(tester);
      await tester.tap(find.byKey(const ValueKey('copy-link-action')));
      await tester.pump();
      expect(updates, isEmpty);
      await tester.tap(find.byKey(const ValueKey('create-link-qr')));
      await _pumpOpenDialog(tester);
      expect(updates, isEmpty);
      await tester.tap(find.byKey(const ValueKey('restaurant-qr-copy-image')));
      await tester.pump();
      expect(updates.single, (
        catalogRestaurantId: 'export-doc',
        type: AdminRestaurantPreparationType.biteScoreCustomer,
        prepared: true,
        expectedInviteId: null,
      ));
      await tester.tap(
        find.byKey(const ValueKey('restaurant-qr-preview-close')),
      );
      await tester.pumpAndSettle();

      final biteSaverCustomerLink = find.byKey(
        const ValueKey('biteScore:export-doc:customer-bitesaver-link'),
      );
      await tester.ensureVisible(biteSaverCustomerLink);
      await tester.tap(biteSaverCustomerLink);
      await _pumpOpenDialog(tester);
      await tester.tap(find.byKey(const ValueKey('create-link-qr')));
      await _pumpOpenDialog(tester);
      expect(updates, hasLength(1));
      await tester.tap(
        find.byKey(const ValueKey('restaurant-qr-download-png')),
      );
      await tester.pump();
      expect(updates.last, (
        catalogRestaurantId: 'export-doc',
        type: AdminRestaurantPreparationType.biteSaverCustomer,
        prepared: true,
        expectedInviteId: null,
      ));
      await tester.tap(
        find.byKey(const ValueKey('restaurant-qr-preview-close')),
      );
      await tester.pumpAndSettle();

      final ownerInvite = find.byKey(
        const ValueKey('biteScore:export-doc:coupon-invite'),
      );
      await tester.ensureVisible(ownerInvite);
      await tester.tap(ownerInvite);
      await _pumpOpenDialog(tester);
      expect(updates, hasLength(2));
      await tester.tap(find.byKey(const ValueKey('create-link-qr')));
      await _pumpOpenDialog(tester);
      expect(updates, hasLength(2));
      await tester.tap(find.byKey(const ValueKey('restaurant-qr-copy-image')));
      await tester.pump();
      expect(updates.last, (
        catalogRestaurantId: 'export-doc',
        type: AdminRestaurantPreparationType.ownerInvite,
        prepared: true,
        expectedInviteId: 'owner-invite-id',
      ));
      await tester.tap(
        find.byKey(const ValueKey('restaurant-qr-preview-close')),
      );
      await tester.pumpAndSettle();

      final claimInvite = find.byKey(
        const ValueKey('biteScore:export-doc:claim-invite'),
      );
      await tester.ensureVisible(claimInvite);
      await tester.tap(claimInvite);
      await _pumpOpenDialog(tester);
      await tester.tap(find.byKey(const ValueKey('create-link-qr')));
      await _pumpOpenDialog(tester);
      expect(updates, hasLength(3));
      await tester.tap(
        find.byKey(const ValueKey('restaurant-qr-download-png')),
      );
      await tester.pump();
      expect(updates.last, (
        catalogRestaurantId: 'export-doc',
        type: AdminRestaurantPreparationType.claimInvite,
        prepared: true,
        expectedInviteId: 'claim-invite-id',
      ));
      await tester.tap(
        find.byKey(const ValueKey('restaurant-qr-preview-close')),
      );
      await tester.pumpAndSettle();

      final accountCustomerLink = find.byKey(
        const ValueKey('biteSaver:account-document-id:customer-bitesaver-link'),
      );
      await tester.ensureVisible(accountCustomerLink);
      await tester.tap(accountCustomerLink);
      await _pumpOpenDialog(tester);
      await tester.tap(find.byKey(const ValueKey('create-link-qr')));
      await _pumpOpenDialog(tester);
      await tester.tap(find.byKey(const ValueKey('restaurant-qr-copy-image')));
      await tester.pump();
      expect(updates, hasLength(4));
    },
  );

  testWidgets('preparation busy state locks every type for one restaurant', (
    tester,
  ) async {
    final completer = Completer<AdminRestaurantPreparationState>();
    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
          }) async => _result(
            records: [
              _biteScoreRecord(
                documentId: 'preparation-busy',
                preparation: _preparationState('preparation-busy'),
              ),
            ],
          ),
      updatePreparation:
          ({
            required catalogRestaurantId,
            required type,
            required prepared,
            required biteSaverCatalogBindingState,
            required claimState,
            expectedInviteId,
          }) => completer.future,
    );
    await _submitSearch(tester);

    final saChip = find.byKey(
      const ValueKey('biteScore:preparation-busy:preparation-SA'),
    );
    final srChip = find.byKey(
      const ValueKey('biteScore:preparation-busy:preparation-SR'),
    );
    await tester.ensureVisible(saChip);
    await tester.tap(saChip);
    await tester.pump();

    expect(tester.widget<FilterChip>(saChip).onSelected, isNull);
    expect(tester.widget<FilterChip>(srChip).onSelected, isNull);
    expect(
      find.descendant(
        of: saChip,
        matching: find.byType(CircularProgressIndicator),
      ),
      findsOneWidget,
    );

    completer.complete(
      _preparationState(
        'preparation-busy',
        biteSaverCustomer: AdminRestaurantPreparationStatus.prepared,
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('SA · Prepared'), findsOneWidget);
  });

  testWidgets(
    'one canonical lock prevents overlap and updates duplicate rows together',
    (tester) async {
      final completer = Completer<AdminRestaurantPreparationState>();
      var calls = 0;
      final duplicatedRecord = _biteScoreRecord(
        documentId: 'duplicate-canonical',
        preparation: _preparationState('duplicate-canonical'),
      );
      await _pumpScreen(
        tester,
        search:
            ({
              required locationQuery,
              required radiusMiles,
              required restaurantName,
              required sources,
            }) async => _result(records: [duplicatedRecord, duplicatedRecord]),
        updatePreparation:
            ({
              required catalogRestaurantId,
              required type,
              required prepared,
              required biteSaverCatalogBindingState,
              required claimState,
              expectedInviteId,
            }) {
              calls += 1;
              return completer.future;
            },
      );
      await _submitSearch(tester);

      final saChips = find.byKey(
        const ValueKey('biteScore:duplicate-canonical:preparation-SA'),
      );
      final srChips = find.byKey(
        const ValueKey('biteScore:duplicate-canonical:preparation-SR'),
      );
      expect(saChips, findsNWidgets(2));
      await tester.ensureVisible(saChips.first);
      await tester.tap(saChips.first);
      await tester.pump();

      expect(calls, 1);
      for (final chip in tester.widgetList<FilterChip>(srChips)) {
        expect(chip.onSelected, isNull);
      }
      await tester.tap(srChips.last);
      await tester.pump();
      expect(calls, 1);

      completer.complete(
        _preparationState(
          'duplicate-canonical',
          biteSaverCustomer: AdminRestaurantPreparationStatus.prepared,
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('SA · Prepared'), findsNWidgets(2));
    },
  );

  testWidgets('a delayed mutation cannot overwrite a newer search generation', (
    tester,
  ) async {
    final mutation = Completer<AdminRestaurantPreparationState>();
    var searchCalls = 0;
    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
          }) async {
            searchCalls += 1;
            return _result(
              records: [
                _biteScoreRecord(
                  documentId: 'generation-safe',
                  preparation: _preparationState(
                    'generation-safe',
                    biteScoreCustomer: searchCalls == 1
                        ? AdminRestaurantPreparationStatus.unprepared
                        : AdminRestaurantPreparationStatus.prepared,
                  ),
                ),
              ],
            );
          },
      updatePreparation:
          ({
            required catalogRestaurantId,
            required type,
            required prepared,
            required biteSaverCatalogBindingState,
            required claimState,
            expectedInviteId,
          }) => mutation.future,
    );
    await _submitSearch(tester);

    final saChip = find.byKey(
      const ValueKey('biteScore:generation-safe:preparation-SA'),
    );
    await tester.ensureVisible(saChip);
    await tester.tap(saChip);
    await tester.pump();

    final searchButton = find.byKey(const ValueKey('admin-link-search-button'));
    await tester.ensureVisible(searchButton);
    await tester.tap(searchButton);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 20));
    expect(searchCalls, 2);
    expect(find.text('SR · Prepared'), findsOneWidget);

    mutation.complete(
      _preparationState(
        'generation-safe',
        biteSaverCustomer: AdminRestaurantPreparationStatus.prepared,
        biteScoreCustomer: AdminRestaurantPreparationStatus.unprepared,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('SA · Unprepared'), findsOneWidget);
    expect(find.text('SR · Prepared'), findsOneWidget);
  });

  testWidgets('tracking completion after screen disposal is context safe', (
    tester,
  ) async {
    final mutation = Completer<AdminRestaurantPreparationState>();
    var mutationCalls = 0;
    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
          }) async => _result(
            records: [
              _biteScoreRecord(
                documentId: 'dispose-safe',
                preparation: _preparationState('dispose-safe'),
              ),
            ],
          ),
      renderQrImage:
          ({required restaurantName, required url, required linkType}) async =>
              _qrImage(restaurantName, linkType),
      qrExporter: RestaurantQrExporter(
        capabilities: const RestaurantQrExportCapabilities(
          canCopyImage: true,
          canDownloadPng: false,
        ),
        copyPng: (_) async {},
        downloadPng: (_, _) async {},
      ),
      updatePreparation:
          ({
            required catalogRestaurantId,
            required type,
            required prepared,
            required biteSaverCatalogBindingState,
            required claimState,
            expectedInviteId,
          }) {
            mutationCalls += 1;
            return mutation.future;
          },
    );
    await _submitSearch(tester);

    final customerLink = find.byKey(
      const ValueKey('biteScore:dispose-safe:customer-bitescore-link'),
    );
    await tester.ensureVisible(customerLink);
    await tester.tap(customerLink);
    await _pumpOpenDialog(tester);
    await tester.tap(find.byKey(const ValueKey('create-link-qr')));
    await _pumpOpenDialog(tester);
    await tester.tap(find.byKey(const ValueKey('restaurant-qr-copy-image')));
    await tester.pump();
    expect(mutationCalls, 1);

    await tester.pumpWidget(const SizedBox.shrink());
    mutation.complete(
      _preparationState(
        'dispose-safe',
        biteScoreCustomer: AdminRestaurantPreparationStatus.prepared,
      ),
    );
    await tester.pump();
    await tester.pump();
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'dialog QR busy state prevents duplicates without blocking peers or copy',
    (tester) async {
      final completer = Completer<RestaurantQrImageResult>();
      var firstCalls = 0;
      await _pumpScreen(
        tester,
        search:
            ({
              required locationQuery,
              required radiusMiles,
              required restaurantName,
              required sources,
            }) async => _result(
              records: [
                _biteScoreRecord(documentId: 'qr-busy-one', name: 'Busy One'),
                _biteScoreRecord(documentId: 'qr-busy-two', name: 'Busy Two'),
              ],
            ),
        renderQrImage:
            ({required restaurantName, required url, required linkType}) {
              if (restaurantName == 'Busy One') {
                firstCalls += 1;
                return completer.future;
              }
              return Future.value(_qrImage(restaurantName, linkType));
            },
      );
      await _submitSearch(tester);

      final first = find.byKey(
        const ValueKey('biteScore:qr-busy-one:customer-bitescore-link'),
      );
      final second = find.byKey(
        const ValueKey('biteScore:qr-busy-two:customer-bitescore-link'),
      );
      final firstBiteSaver = find.byKey(
        const ValueKey('biteScore:qr-busy-one:customer-bitesaver-link'),
      );
      await tester.ensureVisible(first);
      await tester.tap(first);
      await _pumpOpenDialog(tester);

      expect(tester.widget<OutlinedButton>(first).onPressed, isNull);
      expect(tester.widget<OutlinedButton>(second).onPressed, isNotNull);
      expect(
        tester.widget<OutlinedButton>(firstBiteSaver).onPressed,
        isNotNull,
      );
      final createQr = find.byKey(const ValueKey('create-link-qr'));
      await tester.tap(createQr);
      await tester.pump();
      expect(firstCalls, 1);
      expect(tester.widget<OutlinedButton>(createQr).onPressed, isNull);
      expect(
        tester
            .widget<FilledButton>(
              find.byKey(const ValueKey('copy-link-action')),
            )
            .onPressed,
        isNotNull,
      );
      await tester.tap(createQr, warnIfMissed: false);
      await tester.pump();
      expect(firstCalls, 1);

      completer.complete(
        _qrImage('Busy One', RestaurantQrLinkType.customerBiteScore),
      );
      await _pumpOpenDialog(tester);
      await tester.tap(
        find.byKey(const ValueKey('restaurant-qr-preview-close')),
      );
      await tester.pumpAndSettle();
      expect(firstCalls, 1);
      expect(tester.widget<OutlinedButton>(first).onPressed, isNotNull);
    },
  );

  testWidgets('customer dialog restores QR action after controlled failure', (
    tester,
  ) async {
    var renderCalls = 0;
    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
          }) async =>
              _result(records: [_biteScoreRecord(documentId: 'qr-failure')]),
      renderQrImage:
          ({required restaurantName, required url, required linkType}) async {
            renderCalls += 1;
            throw const RestaurantQrImageException(
              'Could not render this QR image.',
            );
          },
    );
    await _submitSearch(tester);

    final customerLink = find.byKey(
      const ValueKey('biteScore:qr-failure:customer-bitescore-link'),
    );
    await tester.ensureVisible(customerLink);
    await tester.tap(customerLink);
    await _pumpOpenDialog(tester);
    final createQr = find.byKey(const ValueKey('create-link-qr'));
    await tester.tap(createQr);
    await tester.pump();

    expect(renderCalls, 1);
    expect(find.text('Could not render this QR image.'), findsOneWidget);
    expect(tester.widget<OutlinedButton>(createQr).onPressed, isNotNull);
    expect(
      find.byKey(const ValueKey('admin-link-action-dialog')),
      findsOneWidget,
    );
    await tester.tap(find.byKey(const ValueKey('close-link-action-dialog')));
    await tester.pumpAndSettle();
  });

  testWidgets(
    'per-record busy state prevents duplicates without blocking peers',
    (tester) async {
      final completer = Completer<RestaurantInviteCreationResult>();
      var firstCalls = 0;
      await _pumpScreen(
        tester,
        search:
            ({
              required locationQuery,
              required radiusMiles,
              required restaurantName,
              required sources,
            }) async => _result(
              records: [
                _biteScoreRecord(documentId: 'busy-one', name: 'Busy One'),
                _biteScoreRecord(documentId: 'busy-two', name: 'Busy Two'),
              ],
            ),
        createCouponInvite:
            ({
              required restaurantName,
              required restaurantId,
              required biteScoreCatalogRestaurantId,
              required streetAddress,
              required city,
              required state,
              required zipCode,
              required phone,
              required website,
              required latitude,
              required longitude,
            }) {
              if (restaurantName == 'Busy One') {
                firstCalls += 1;
                return completer.future;
              }
              return Future.value(
                _invite('https://go.bitestar.app/invite/coupon/other'),
              );
            },
      );
      await _submitSearch(tester);

      final first = find.byKey(
        const ValueKey('biteScore:busy-one:coupon-invite'),
      );
      final second = find.byKey(
        const ValueKey('biteScore:busy-two:coupon-invite'),
      );
      await tester.ensureVisible(first);
      await tester.tap(first);
      await tester.pump();

      expect(tester.widget<FilledButton>(first).onPressed, isNull);
      expect(tester.widget<FilledButton>(second).onPressed, isNotNull);
      expect(firstCalls, 1);
      await tester.tap(first, warnIfMissed: false);
      await tester.pump();
      expect(firstCalls, 1);

      completer.complete(
        _invite('https://go.bitestar.app/invite/coupon/busy-token'),
      );
      await _pumpOpenDialog(tester);
      await tester.tap(find.text('Close'));
      await tester.pumpAndSettle();
      expect(firstCalls, 1);
    },
  );
}

Future<AdminRestaurantLinkSearchResult> _emptySearch({
  required String locationQuery,
  required int radiusMiles,
  required String? restaurantName,
  required Set<AdminRestaurantLinkSource> sources,
}) async {
  return _result();
}

Future<void> _pumpScreen(
  WidgetTester tester, {
  required AdminRestaurantSearchCallback search,
  AdminCouponInviteCallback? createCouponInvite,
  AdminBiteScoreClaimInviteCallback? createClaimInvite,
  AdminClipboardWriteCallback? writeClipboard,
  AdminQrImageRenderCallback? renderQrImage,
  RestaurantQrExporter? qrExporter,
  AdminPreparationUpdateCallback? updatePreparation,
  AdminRestaurantQrBatchDialogDependencies? qrBatchDependencies,
  double textScale = 1,
  bool configureView = true,
}) async {
  if (configureView) {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(900, 6000);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
  }
  await tester.pumpWidget(
    MaterialApp(
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: TextScaler.linear(textScale)),
        child: child!,
      ),
      home: Scaffold(
        body: AdminLinkGenerationScreen(
          searchRestaurants: search,
          createCouponInvite: createCouponInvite,
          createBiteScoreClaimInvite: createClaimInvite,
          writeClipboard: writeClipboard,
          renderQrImage: renderQrImage,
          qrExporter: qrExporter ?? _unsupportedQrExporter(),
          updatePreparation: updatePreparation,
          qrBatchDependencies: qrBatchDependencies,
        ),
      ),
    ),
  );
  await tester.pump();
}

Future<void> _pumpPagedScreen(
  WidgetTester tester, {
  required AdminRestaurantPagedSearchCallback search,
  AdminPreparationUpdateCallback? updatePreparation,
  AdminRestaurantQrBatchDialogDependencies? qrBatchDependencies,
}) async {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = const Size(900, 900);
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: AdminLinkGenerationScreen(
          searchRestaurantPage: search,
          qrExporter: _unsupportedQrExporter(),
          updatePreparation: updatePreparation,
          qrBatchDependencies: qrBatchDependencies,
        ),
      ),
    ),
  );
  await tester.pump();
}

Future<Finder> _scrollToAdminKey(
  WidgetTester tester,
  ValueKey<String> key, {
  double delta = 600,
  bool settle = true,
}) async {
  final finder = find.byKey(key);
  await tester.scrollUntilVisible(
    finder,
    delta,
    scrollable: find.byType(Scrollable).first,
    maxScrolls: 100,
  );
  await Scrollable.ensureVisible(tester.element(finder), alignment: 0.5);
  if (settle) {
    await tester.pumpAndSettle();
  } else {
    await tester.pump();
  }
  return finder;
}

Future<void> _expectAppendPreservesScrollOffset(
  WidgetTester tester, {
  required int initialCount,
  required int appendedCount,
}) async {
  var calls = 0;
  await _pumpPagedScreen(
    tester,
    search:
        ({
          required locationQuery,
          required radiusMiles,
          required restaurantName,
          required sources,
          required searchInstanceId,
          required clientRequestId,
          required needsQrPreparation,
          cursor,
          resolvedSearchCenter,
        }) async {
          calls += 1;
          if (calls == 1) {
            return _pagedResult(
              records: _orderedRecords(
                prefix: 'offset-initial-$initialCount',
                start: 0,
                count: initialCount,
              ),
              hasNext: true,
              nextCursor: _pageCursor('offset-$initialCount'),
            );
          }
          return _pagedResult(
            records: _orderedRecords(
              prefix: 'offset-appended-$initialCount',
              start: initialCount,
              count: appendedCount,
            ),
          );
        },
  );
  await _submitSearch(tester);
  final listFinder = find.byKey(
    const ValueKey('admin-link-generation-scroll-view'),
  );
  final controller = tester.widget<ListView>(listFinder).controller!;
  final loadMore = await _scrollToAdminKey(
    tester,
    const ValueKey('admin-link-load-more-button'),
  );
  final offsetBeforeAppend = controller.offset;
  expect(offsetBeforeAppend, greaterThan(0));

  await tester.tap(loadMore);
  await tester.pumpAndSettle();

  expect(calls, 2);
  expect(tester.widget<ListView>(listFinder).controller, same(controller));
  expect(controller.offset, closeTo(offsetBeforeAppend, 0.5));
}

String _pageCursor(String label) {
  final packed = utf8.encode('admin-link-packed-cursor-envelope:$label');
  return '$adminRestaurantPageCursorPrefix${base64Url.encode(packed).replaceAll('=', '')}';
}

List<AdminRestaurantLinkRecord> _orderedRecords({
  required String prefix,
  required int start,
  required int count,
}) {
  return List.generate(count, (index) {
    final order = start + index;
    return _biteScoreRecord(
      documentId: '$prefix-${order.toString().padLeft(3, '0')}',
      name: 'Ordered Restaurant $order',
      orderDistanceMillimeters: order,
    );
  }, growable: false);
}

AdminRestaurantLinkPagedResult _pagedResult({
  List<AdminRestaurantLinkRecord> records = const [],
  bool preparing = false,
  bool hasNext = false,
  String? nextCursor,
  String queryFingerprint =
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  AdminRestaurantMaterializedOrder? consumedBoundary,
  bool? needsQrPreparation,
  bool preparationUnavailableEncountered = false,
}) {
  final effectiveBoundary = preparing
      ? null
      : consumedBoundary ??
            (records.isNotEmpty
                ? records.last.materializedOrder
                : hasNext
                ? const AdminRestaurantMaterializedOrder(
                    distanceMillimeters: 1,
                    normalizedName: 'sparse boundary',
                    sourceDocumentId: 'sparse-boundary',
                    source: AdminRestaurantLinkSource.biteScore,
                  )
                : null);
  return AdminRestaurantLinkPagedResult(
    page: PagedResponse<AdminRestaurantLinkRecord>(
      items: records,
      pageSize: 50,
      hasNext: hasNext,
      hasPrevious: false,
      nextCursor: nextCursor,
      total: const PagedTotal.unknown(),
      queryFingerprint: queryFingerprint,
      snapshotTimestampMs: 1,
      capabilities: PageCapabilities(
        first: false,
        previous: false,
        numberedVisitedPages: false,
        next: hasNext,
        last: false,
      ),
      preparation: PagePreparation.fromJson({
        'state': preparing ? 'preparing' : 'ready',
        'completedUnits': preparing ? 1 : 2,
        'totalUnits': 2,
      }),
    ),
    searchCenter: const AdminRestaurantSearchCenter(
      latitude: 28.8517,
      longitude: -82.487,
      displayName: 'Crystal River, FL',
    ),
    radiusMiles: 10,
    queriedSources: AdminRestaurantLinkSource.values,
    consumedBoundary: effectiveBoundary,
    needsQrPreparation: needsQrPreparation,
    preparationUnavailableEncountered: preparationUnavailableEncountered,
  );
}

AdminRestaurantPreparationState _availablePreparation(String id) {
  return AdminRestaurantPreparationState(
    canonicalCatalogRestaurantId: id,
    ownerInvite: AdminRestaurantPreparationStatus.unprepared,
    claimInvite: AdminRestaurantPreparationStatus.unprepared,
    biteSaverCustomer: AdminRestaurantPreparationStatus.unprepared,
    biteScoreCustomer: AdminRestaurantPreparationStatus.unprepared,
  );
}

Future<void> _submitSearch(
  WidgetTester tester, {
  String location = '34428',
}) async {
  final locationField = await _scrollToAdminKey(
    tester,
    const ValueKey('admin-link-location-field'),
    delta: -600,
  );
  await tester.enterText(locationField, location);
  final button = await _scrollToAdminKey(
    tester,
    const ValueKey('admin-link-search-button'),
  );
  await tester.tap(button);
  await tester.pumpAndSettle();
}

Future<void> _pumpOpenDialog(WidgetTester tester) async {
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 350));
}

AdminRestaurantLinkSearchResult _result({
  List<AdminRestaurantLinkRecord> records = const [],
  bool truncated = false,
}) {
  return AdminRestaurantLinkSearchResult(
    searchCenter: const AdminRestaurantSearchCenter(
      latitude: 28.8517,
      longitude: -82.487,
      displayName: 'Crystal River, FL',
    ),
    radiusMiles: 10,
    results: records,
    resultsMayBeTruncated: truncated,
    returnedCount: records.length,
    queriedSources: AdminRestaurantLinkSource.values,
  );
}

AdminRestaurantLinkRecord _biteScoreRecord({
  required String documentId,
  String? actionId,
  String name = 'River Grill',
  String streetAddress = '1 Main Street',
  String city = 'Crystal River',
  String state = 'FL',
  String zipCode = '34428',
  bool isActive = true,
  bool isClaimed = false,
  String? ownerUserId,
  bool? claimAvailable,
  bool? claimStateValid,
  AdminBiteSaverCatalogBindingState biteSaverCatalogBindingState =
      AdminBiteSaverCatalogBindingState.unbound,
  AdminRestaurantPreparationState preparation =
      const AdminRestaurantPreparationState.unavailable(),
  int orderDistanceMillimeters = 2011680,
}) {
  final resolvedOwnerUserId = ownerUserId ?? (isClaimed ? 'owner-1' : null);
  final validlyClaimed =
      isClaimed && resolvedOwnerUserId?.trim().isNotEmpty == true;
  final strictlyUnclaimed =
      !isClaimed &&
      (resolvedOwnerUserId == null || resolvedOwnerUserId.isEmpty);
  return AdminRestaurantLinkRecord(
    source: AdminRestaurantLinkSource.biteScore,
    documentId: documentId,
    actionId: actionId ?? documentId,
    restaurantName: name,
    streetAddress: streetAddress,
    city: city,
    state: state,
    zipCode: zipCode,
    phone: '555-0100',
    website: 'https://example.com',
    latitude: 28.8517,
    longitude: -82.487,
    distanceMiles: 1.25,
    isActive: isActive,
    isClaimed: isClaimed,
    claimAvailable: claimAvailable ?? (isActive && strictlyUnclaimed),
    claimStateValid:
        claimStateValid ?? (isActive && (strictlyUnclaimed || validlyClaimed)),
    ownerUserId: resolvedOwnerUserId,
    biteSaverCatalogBindingState: biteSaverCatalogBindingState,
    preparation: preparation,
    materializedOrder: AdminRestaurantMaterializedOrder(
      distanceMillimeters: orderDistanceMillimeters,
      normalizedName: name.trim().replaceAll(RegExp(r'\s+'), ' ').toLowerCase(),
      sourceDocumentId: documentId,
      source: AdminRestaurantLinkSource.biteScore,
    ),
  );
}

AdminRestaurantLinkRecord _filteredRecord(
  String documentId, {
  int orderDistanceMillimeters = 2011680,
}) {
  return _biteScoreRecord(
    documentId: documentId,
    preparation: _availablePreparation(documentId),
    orderDistanceMillimeters: orderDistanceMillimeters,
  );
}

AdminRestaurantPreparationState _preparationState(
  String catalogRestaurantId, {
  AdminRestaurantPreparationStatus ownerInvite =
      AdminRestaurantPreparationStatus.unprepared,
  AdminRestaurantPreparationStatus claimInvite =
      AdminRestaurantPreparationStatus.unprepared,
  AdminRestaurantPreparationStatus biteSaverCustomer =
      AdminRestaurantPreparationStatus.unprepared,
  AdminRestaurantPreparationStatus biteScoreCustomer =
      AdminRestaurantPreparationStatus.unprepared,
}) {
  return AdminRestaurantPreparationState(
    canonicalCatalogRestaurantId: catalogRestaurantId,
    ownerInvite: ownerInvite,
    claimInvite: claimInvite,
    biteSaverCustomer: biteSaverCustomer,
    biteScoreCustomer: biteScoreCustomer,
  );
}

AdminRestaurantLinkRecord _biteSaverRecord({
  required String documentId,
  required String actionId,
  String? linkedBiteScoreRestaurantId,
  String name = 'River Grill',
  String streetAddress = '1 Main Street',
  String city = 'Crystal River',
  String state = 'FL',
  String zipCode = '34428',
  String approvalStatus = 'pending',
}) {
  return AdminRestaurantLinkRecord(
    source: AdminRestaurantLinkSource.biteSaver,
    documentId: documentId,
    actionId: actionId,
    restaurantName: name,
    streetAddress: streetAddress,
    city: city,
    state: state,
    zipCode: zipCode,
    phone: '555-0100',
    website: 'https://example.com',
    latitude: 28.8517,
    longitude: -82.487,
    distanceMiles: 1.5,
    approvalStatus: approvalStatus,
    couponApplicationSubmitted: true,
    uid: actionId,
    linkedBiteScoreRestaurantId: linkedBiteScoreRestaurantId,
    materializedOrder: AdminRestaurantMaterializedOrder(
      distanceMillimeters: 2414016,
      normalizedName: name.trim().replaceAll(RegExp(r'\s+'), ' ').toLowerCase(),
      sourceDocumentId: documentId,
      source: AdminRestaurantLinkSource.biteSaver,
    ),
  );
}

AdminRestaurantLinkRecord _selectableOrderedRecord(
  String documentId,
  int order, {
  String name = 'River Grill',
}) {
  return _biteScoreRecord(
    documentId: documentId,
    name: name,
    preparation: _availablePreparation(documentId),
    orderDistanceMillimeters: order,
  );
}

AdminRestaurantQrPreparationRunResult _batchPreparation(List<String> ids) {
  final results = <AdminRestaurantQrRestaurantResult>[
    for (final id in ids)
      AdminRestaurantQrReadyRestaurant(
        catalogRestaurantId: id,
        restaurantName: 'Batch $id',
        labels: <AdminRestaurantQrLabelEntry>[
          AdminRestaurantQrLabelEntry(
            type: AdminRestaurantQrLabelType.ownerInvite,
            payloadUrl:
                'https://go.bitestar.app/invite/coupon/'
                'synthetic-owner-$id',
            invitationId: 'owner-invitation-$id',
            invitationExpiresAtMillis: 1800000000000,
          ),
          AdminRestaurantQrLabelEntry(
            type: AdminRestaurantQrLabelType.claimInvite,
            payloadUrl:
                'https://go.bitestar.app/invite/bitescore/'
                'synthetic-claim-$id',
            invitationId: 'claim-invitation-$id',
            invitationExpiresAtMillis: 1800000000000,
          ),
          AdminRestaurantQrLabelEntry(
            type: AdminRestaurantQrLabelType.biteSaverCustomer,
            payloadUrl: 'https://go.bitestar.app/r/coupons/$id',
          ),
          AdminRestaurantQrLabelEntry(
            type: AdminRestaurantQrLabelType.biteScoreCustomer,
            payloadUrl: 'https://go.bitestar.app/r/bitescore/$id',
          ),
        ],
      ),
  ];
  return AdminRestaurantQrPreparationRunResult(
    requestedCatalogRestaurantIds: ids,
    results: results,
  );
}

RestaurantQrPdfArtifact _batchPdfArtifact(
  RestaurantQrPdfPreflightResult preflight,
) {
  return RestaurantQrPdfArtifact(
    bytes: Uint8List.fromList('%PDF-synthetic-admin-screen'.codeUnits),
    summary: AdminRestaurantQrPdfArtifactSummary(
      filename: 'bitestar-qr-labels-20260829-205400.pdf',
      pageCount: preflight.pageCount,
      includedManifest: preflight.validManifest,
    ),
  );
}

AdminRestaurantQrMarkingRunResult _resolvedBatchMarking(
  AdminRestaurantQrMarkingWorklist worklist, {
  Set<String> failedCatalogRestaurantIds = const <String>{},
  Set<String> completeProjectionForFailedCatalogRestaurantIds =
      const <String>{},
  Set<String> incompatibleNotRequiredProjectionForFailedCatalogRestaurantIds =
      const <String>{},
}) {
  final request = AdminRestaurantQrMarkingRequest(worklist.restaurants);
  final hasFailures = worklist.restaurants.any(
    (restaurant) =>
        failedCatalogRestaurantIds.contains(restaurant.catalogRestaurantId),
  );
  final chunk = AdminRestaurantQrMarkingChunkResult.fromCallableData(
    <String, Object?>{
      'schemaVersion': 1,
      'outcome': hasFailures ? 'partialFailure' : 'complete',
      'results': <Object?>[
        for (final restaurant in worklist.restaurants)
          <String, Object?>{
            'catalogRestaurantId': restaurant.catalogRestaurantId,
            'outcome':
                failedCatalogRestaurantIds.contains(
                  restaurant.catalogRestaurantId,
                )
                ? 'partialFailure'
                : 'processed',
            'labels': <Object?>[
              for (var index = 0; index < restaurant.labels.length; index += 1)
                failedCatalogRestaurantIds.contains(
                          restaurant.catalogRestaurantId,
                        ) &&
                        index == 0
                    ? <String, Object?>{
                        'type': restaurant.labels[index].type.wireName,
                        'status': 'failed',
                        'code': 'status_unavailable',
                        'message': 'Preparation status could not be confirmed.',
                      }
                    : <String, Object?>{
                        'type': restaurant.labels[index].type.wireName,
                        'status': 'saved',
                        'alreadySaved': false,
                      },
            ],
            'preparation': <String, Object?>{
              'canonicalCatalogRestaurantId': restaurant.catalogRestaurantId,
              'i':
                  incompatibleNotRequiredProjectionForFailedCatalogRestaurantIds
                      .contains(restaurant.catalogRestaurantId)
                  ? 'notRequired'
                  : failedCatalogRestaurantIds.contains(
                          restaurant.catalogRestaurantId,
                        ) &&
                        !completeProjectionForFailedCatalogRestaurantIds
                            .contains(restaurant.catalogRestaurantId)
                  ? 'unprepared'
                  : 'prepared',
              'c':
                  incompatibleNotRequiredProjectionForFailedCatalogRestaurantIds
                      .contains(restaurant.catalogRestaurantId)
                  ? 'notRequired'
                  : 'prepared',
              'sa': 'prepared',
              'sr': 'prepared',
            },
          },
      ],
    },
    expectedRequest: request,
  );
  return AdminRestaurantQrMarkingRunResult(
    requestedWorklist: worklist,
    results: chunk.results,
  );
}

RestaurantQrImageResult _qrImage(
  String restaurantName,
  RestaurantQrLinkType linkType,
) {
  return RestaurantQrImageResult(
    pngBytes: base64Decode(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8'
      '/x8AAusB9Y9Zl1EAAAAASUVORK5CYII=',
    ),
    width: 1200,
    height: 1306,
    qrWidth: 1200,
    moduleCount: 41,
    modulePixels: 24,
    headerHeight: 106,
    titleLineCount: 1,
    safeFilename: RestaurantQrImageService.safeFilename(
      restaurantName: restaurantName,
      linkType: linkType,
    ),
  );
}

RestaurantQrExporter _unsupportedQrExporter() {
  return RestaurantQrExporter(
    capabilities: const RestaurantQrExportCapabilities(
      canCopyImage: false,
      canDownloadPng: false,
    ),
    copyPng: (_) async {},
    downloadPng: (_, _) async {},
  );
}

RestaurantInviteCreationResult _invite(
  String url, {
  String inviteId = 'invite-id',
}) {
  return RestaurantInviteCreationResult(
    inviteId: inviteId,
    token: 'not-persisted',
    inviteUrl: url,
    expiresAt: null,
  );
}
