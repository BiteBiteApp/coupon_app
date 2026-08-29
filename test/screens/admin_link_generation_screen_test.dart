import 'dart:async';
import 'dart:convert';

import 'package:coupon_app/models/admin_restaurant_link_record.dart';
import 'package:coupon_app/models/pagination/paged_models.dart';
import 'package:coupon_app/screens/admin_link_generation_screen.dart';
import 'package:coupon_app/services/admin_link_generation_service.dart';
import 'package:coupon_app/services/restaurant_invite_service.dart';
import 'package:coupon_app/services/restaurant_qr_export.dart';
import 'package:coupon_app/services/restaurant_qr_image_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
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

      final listFinder = find.byKey(
        const ValueKey('admin-link-generation-scroll-view'),
      );
      final controller = tester.widget<ListView>(listFinder).controller!;
      final finalPreparation = await _scrollToAdminKey(
        tester,
        const ValueKey('biteScore:$completedId:preparation-I'),
      );
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
                  records: [_biteScoreRecord(documentId: 'old-first')],
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
                records: [_biteScoreRecord(documentId: 'new-search')],
              ),
            );
          },
    );
    await _submitSearch(tester);
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

    oldLoad.complete(
      _pagedResult(records: [_biteScoreRecord(documentId: 'old-late')]),
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
    actionId: documentId,
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
    materializedOrder: AdminRestaurantMaterializedOrder(
      distanceMillimeters: 2414016,
      normalizedName: name.trim().replaceAll(RegExp(r'\s+'), ' ').toLowerCase(),
      sourceDocumentId: documentId,
      source: AdminRestaurantLinkSource.biteSaver,
    ),
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
