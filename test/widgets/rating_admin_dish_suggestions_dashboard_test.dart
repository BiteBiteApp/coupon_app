import 'dart:async';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:coupon_app/models/pagination/paged_models.dart';
import 'package:coupon_app/models/rating_admin_dish_suggestion_models.dart';
import 'package:coupon_app/services/rating_admin_dish_suggestions_service.dart';
import 'package:coupon_app/widgets/rating_admin_dish_suggestions_dashboard.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

const String _fingerprint =
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const String _group1 =
    '1111111111111111111111111111111111111111111111111111111111111111';
const String _group2 =
    '2222222222222222222222222222222222222222222222222222222222222222';
const String _invalidMergeGroup =
    '3333333333333333333333333333333333333333333333333333333333333333';
const String _replacementGroup =
    '4444444444444444444444444444444444444444444444444444444444444444';

String _group(int value) => value.toRadixString(16).padLeft(64, '0');

Map<String, Object?> _dish({
  required String id,
  String restaurantId = 'restaurant-1',
  String restaurantName = 'Alpha Cafe',
  String name = 'Original Dish',
  bool isActive = true,
  String? mergedIntoDishId,
}) => <String, Object?>{
  'id': id,
  'restaurantId': restaurantId,
  'restaurantName': restaurantName,
  'name': name,
  'isActive': isActive,
  'mergedIntoDishId': mergedIntoDishId,
};

Map<String, Object?> _suggestion({
  String groupId = _group1,
  String fingerprint = _fingerprint,
  int membershipGeneration = 3,
  int resolutionSequence = 7,
  String proposalType = 'rename',
  String restaurantId = 'restaurant-1',
  String restaurantName = 'Alpha Cafe',
  String sourceDishId = 'dish-1',
  String? mergeTargetDishId,
  String? proposedDisplayName = 'Renamed Dish',
  String resolutionState = 'idle',
  bool hasPendingMembers = true,
  bool enoughSupporters = true,
  bool? autoEligible,
  bool dueNow = false,
  Map<String, Object?>? sourceDish,
  Map<String, Object?>? mergeTargetDish,
}) => <String, Object?>{
  'groupId': groupId,
  'fingerprint': fingerprint,
  'membershipGeneration': membershipGeneration,
  'resolutionSequence': resolutionSequence,
  'proposalType': proposalType,
  'restaurantId': restaurantId,
  'sourceDishId': sourceDishId,
  'mergeTargetDishId': mergeTargetDishId,
  'proposedDisplayName': proposedDisplayName,
  'hasPendingMembers': hasPendingMembers,
  'oldestTrustedProposalTimeMillis': 1721952000000,
  'dueAtMillis': 1722211200000,
  'dueNow': dueNow,
  'enoughSupporters': enoughSupporters,
  'autoEligible':
      autoEligible ?? (enoughSupporters && resolutionState == 'idle'),
  'resolutionState': resolutionState,
  'supporterCount': 2,
  'sourceDish':
      sourceDish ?? _dish(id: sourceDishId, restaurantName: restaurantName),
  'mergeTargetDish': mergeTargetDish,
  'restaurant': <String, Object?>{'id': restaurantId, 'name': restaurantName},
};

Map<String, Object?> _page({
  List<Object?>? items,
  int pageNumber = 1,
  bool hasNext = false,
  bool hasPrevious = false,
  int? total,
  String? nextCursor,
  String? previousCursor,
}) {
  final values = items ?? <Object?>[_suggestion()];
  return <String, Object?>{
    'protocolVersion': pageProtocolVersion,
    'items': values,
    'pageSize': 25,
    'hasNext': hasNext,
    'hasPrevious': hasPrevious,
    if (hasNext) 'nextCursor': nextCursor ?? 'next-$pageNumber',
    if (hasPrevious) 'previousCursor': previousCursor ?? 'previous-$pageNumber',
    'currentPageNumber': pageNumber,
    'total': <String, Object?>{
      'state': 'exact',
      'value': total ?? (hasNext || hasPrevious ? 26 : values.length),
    },
    'queryFingerprint':
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'snapshotTimestampMs': 1721952000000 + pageNumber,
    'capabilities': <String, Object?>{
      'first': pageNumber > 1,
      'previous': hasPrevious,
      'numberedVisitedPages': true,
      'next': hasNext,
      'last': hasNext,
    },
  };
}

Map<String, Object?> _actionResult({
  String status = 'applying',
  String resolutionType = 'apply',
}) => <String, Object?>{
  'contractVersion': dishProposalActionResultContractVersion,
  'accepted': true,
  'status': status,
  'resolutionType': resolutionType,
  'processing': true,
  'complete': false,
  'manualReviewRequired': false,
  'messageCategory': 'accepted_processing',
};

String _identity(String groupId) => '$groupId:$_fingerprint:3:7';

Finder _applyButton(String groupId) =>
    find.byKey(ValueKey<String>('dish-suggestion-apply-${_identity(groupId)}'));

Finder _rejectButton(String groupId) => find.byKey(
  ValueKey<String>('dish-suggestion-reject-${_identity(groupId)}'),
);

Widget _host(
  RatingAdminDishSuggestionsService service, {
  bool isActive = true,
  double textScale = 1,
}) => MaterialApp(
  builder: (context, child) => MediaQuery(
    data: MediaQuery.of(
      context,
    ).copyWith(textScaler: TextScaler.linear(textScale)),
    child: child!,
  ),
  home: Scaffold(
    body: RatingAdminDishSuggestionsPagedView(
      key: const ValueKey<String>('dish-suggestions-view'),
      service: service,
      isActive: isActive,
    ),
  ),
);

void main() {
  test('migrated source has only the paged callable dashboard boundary', () {
    final screenSource = File(
      'lib/screens/bitescore_admin_screen.dart',
    ).readAsStringSync();
    final widgetSource = File(
      'lib/widgets/rating_admin_dish_suggestions_dashboard.dart',
    ).readAsStringSync();
    final serviceSource = File(
      'lib/services/bitescore_service.dart',
    ).readAsStringSync();

    expect(screenSource, contains('RatingAdminDishSuggestionsPagedView('));
    expect(screenSource, contains('isScrollable: true'));
    expect(screenSource, isNot(contains('_BiteScoreDishSuggestionAdminList')));
    expect(screenSource, isNot(contains('dishEditSuggestionsAdminStream')));
    expect(screenSource, isNot(contains('approveDishEditSuggestion')));
    expect(screenSource, isNot(contains('rejectDishEditSuggestion')));

    expect(
      widgetSource,
      contains('PagedDirectoryView<RatingAdminDishSuggestionRecord>'),
    );
    for (final forbidden in <String>[
      'Timer(',
      'dishEditSuggestionsAdminStream',
      'evaluatePendingDishEditSuggestionsForDish',
      'maybeAutoApplyDueDishEditSuggestions',
      'approveDishEditSuggestion',
      'rejectDishEditSuggestion',
      'processDishProposalResolutionJobStep',
    ]) {
      expect(widgetSource, isNot(contains(forbidden)), reason: forbidden);
    }

    final evaluationStart = serviceSource.indexOf(
      'static Future<void> evaluatePendingDishEditSuggestionsForDish',
    );
    final evaluationEnd = serviceSource.indexOf(
      'static Future<void>',
      evaluationStart + 20,
    );
    expect(evaluationStart, greaterThanOrEqualTo(0));
    expect(evaluationEnd, greaterThan(evaluationStart));
    final evaluationMethod = serviceSource.substring(
      evaluationStart,
      evaluationEnd,
    );
    expect(evaluationMethod, contains('Future<void>.value()'));
    expect(
      evaluationMethod,
      isNot(contains('maybeAutoApplyDueDishEditSuggestions')),
    );

    final streamStart = serviceSource.indexOf(
      'dishEditSuggestionsAdminStream({bool pendingOnly = true})',
    );
    final streamEnd = serviceSource.indexOf(
      'static Future<void>',
      streamStart + 20,
    );
    expect(streamStart, greaterThanOrEqualTo(0));
    expect(streamEnd, greaterThan(streamStart));
    expect(
      serviceSource.substring(streamStart, streamEnd),
      isNot(contains('maybeAutoApplyDueDishEditSuggestions')),
    );
  });

  testWidgets('loads lazily, pages and refreshes only on explicit input', (
    tester,
  ) async {
    final calls = <(String, Map<String, Object?>)>[];
    final service = RatingAdminDishSuggestionsService(
      functionsBoundary: (name, request) async {
        calls.add((name, request));
        expect(name, 'listRatingAdminDishSuggestionsPage');
        return request['direction'] == 'forward'
            ? _page(
                items: <Object?>[
                  _suggestion(groupId: _group2, sourceDishId: 'dish-2'),
                ],
                pageNumber: 2,
                hasPrevious: true,
              )
            : _page(hasNext: true);
      },
    );

    await tester.pumpWidget(_host(service, isActive: false));
    await tester.pump(const Duration(minutes: 1));
    expect(calls, isEmpty);

    await tester.pumpWidget(_host(service));
    await tester.pumpAndSettle();
    expect(calls, hasLength(1));
    expect(calls.single.$2['criteria'], <String, Object?>{
      'entityKind': 'dishSuggestions',
    });
    expect(calls.single.$2['pageSize'], 25);
    expect(calls.single.$2['requestExactCount'], isTrue);
    expect(find.textContaining('Source dish: Original Dish'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey<String>('pagination-next')));
    await tester.pumpAndSettle();
    expect(calls, hasLength(2));
    expect(calls.last.$2['direction'], 'forward');
    expect(calls.last.$2['cursor'], 'next-1');
    expect(
      find.byKey(
        ValueKey<String>('rating-admin-dish-suggestion-${_identity(_group2)}'),
      ),
      findsOneWidget,
    );

    await tester.tap(
      find.byKey(const ValueKey<String>('paged-directory-refresh')),
    );
    await tester.pumpAndSettle();
    expect(calls, hasLength(3));
    expect(calls.last.$2['direction'], 'forward');
    await tester.pump(const Duration(minutes: 1));
    expect(calls, hasLength(3));
  });

  testWidgets('card keeps invalid proposals visible and safely actionable', (
    tester,
  ) async {
    final invalidMerge = _suggestion(
      groupId: _invalidMergeGroup,
      proposalType: 'merge',
      mergeTargetDishId: 'dish-2',
      proposedDisplayName: null,
      mergeTargetDish: _dish(
        id: 'dish-2',
        restaurantId: 'different-restaurant',
        name: 'Target Dish',
      ),
    );
    final service = RatingAdminDishSuggestionsService(
      functionsBoundary: (_, _) async => _page(items: <Object?>[invalidMerge]),
    );

    await tester.pumpWidget(_host(service));
    await tester.pumpAndSettle();

    expect(find.text('Alpha Cafe'), findsOneWidget);
    expect(find.textContaining('Type: Merge'), findsOneWidget);
    expect(find.textContaining('Restaurant ID: restaurant-1'), findsOneWidget);
    expect(find.textContaining('Source dish: Original Dish'), findsOneWidget);
    expect(find.textContaining('Merge into: Target Dish'), findsOneWidget);
    expect(find.textContaining('Supporters: 2'), findsOneWidget);
    expect(find.textContaining('Status: Pending'), findsOneWidget);
    expect(find.textContaining('Created:'), findsOneWidget);
    expect(find.textContaining('Automatic processing'), findsOneWidget);
    expect(
      find.textContaining(
        'Invalid reason: Merge dishes must belong to the same restaurant.',
      ),
      findsOneWidget,
    );

    final apply = tester.widget<ElevatedButton>(
      _applyButton(_invalidMergeGroup),
    );
    final reject = tester.widget<OutlinedButton>(
      _rejectButton(_invalidMergeGroup),
    );
    expect(apply.onPressed, isNull);
    expect(reject.onPressed, isNotNull);
    expect(tester.getSize(_applyButton(_invalidMergeGroup)).height, 48);
    expect(tester.getSize(_rejectButton(_invalidMergeGroup)).height, 48);
  });

  testWidgets('missing rename name keeps the page visible and Apply disabled', (
    tester,
  ) async {
    final missingNameGroup = _group(5);
    final validNeighborGroup = _group(6);
    final service = RatingAdminDishSuggestionsService(
      functionsBoundary: (_, _) async => _page(
        items: <Object?>[
          _suggestion(
            groupId: missingNameGroup,
            sourceDishId: 'dish-missing-name',
            proposedDisplayName: null,
          ),
          _suggestion(
            groupId: validNeighborGroup,
            sourceDishId: 'dish-valid-neighbor',
            proposedDisplayName: 'crispy garlic knots',
          ),
        ],
        total: 2,
      ),
    );

    await tester.pumpWidget(_host(service));
    await tester.pumpAndSettle();

    expect(
      find.byKey(
        ValueKey<String>(
          'rating-admin-dish-suggestion-${_identity(missingNameGroup)}',
        ),
      ),
      findsOneWidget,
    );
    expect(find.textContaining('Proposed name: Unavailable'), findsOneWidget);
    expect(
      find.textContaining(
        'Invalid reason: Rename suggestion is missing the proposed name.',
      ),
      findsOneWidget,
    );
    expect(
      tester.widget<ElevatedButton>(_applyButton(missingNameGroup)).onPressed,
      isNull,
    );
    expect(
      tester.widget<OutlinedButton>(_rejectButton(missingNameGroup)).onPressed,
      isNotNull,
    );
    expect(
      tester.widget<ElevatedButton>(_applyButton(validNeighborGroup)).onPressed,
      isNotNull,
    );
    expect(
      tester
          .widget<OutlinedButton>(_rejectButton(validNeighborGroup))
          .onPressed,
      isNotNull,
    );
    expect(find.text('Try Again'), findsNothing);
  });

  testWidgets('apply sends exact identity once and refreshes its origin page', (
    tester,
  ) async {
    final action = Completer<Object?>();
    final actionRequests = <Map<String, Object?>>[];
    var listCalls = 0;
    final service = RatingAdminDishSuggestionsService(
      functionsBoundary: (name, request) {
        if (name == 'listRatingAdminDishSuggestionsPage') {
          listCalls++;
          return Future<Object?>.value(_page());
        }
        expect(name, 'applyRatingAdminDishSuggestionGroup');
        actionRequests.add(request);
        return action.future;
      },
    );

    await tester.pumpWidget(_host(service));
    await tester.pumpAndSettle();
    await tester.ensureVisible(_applyButton(_group1));
    await tester.tap(_applyButton(_group1));
    await tester.pump();

    expect(actionRequests, hasLength(1));
    expect(actionRequests.single.keys.toSet(), <String>{
      'contractVersion',
      'groupId',
      'expectedFingerprint',
      'expectedMembershipGeneration',
      'expectedResolutionSequence',
      'clientRequestId',
    });
    expect(
      actionRequests.single['contractVersion'],
      dishProposalActionContractVersion,
    );
    expect(actionRequests.single['groupId'], _group1);
    expect(actionRequests.single['expectedFingerprint'], _fingerprint);
    expect(actionRequests.single['expectedMembershipGeneration'], 3);
    expect(actionRequests.single['expectedResolutionSequence'], 7);
    expect(
      actionRequests.single['clientRequestId'],
      matches(RegExp(r'^dish-suggestion-action-\d+-\d+$')),
    );
    expect(
      actionRequests.single['clientRequestId'].toString(),
      isNot(contains(_group1)),
    );
    expect(
      find.byKey(const ValueKey<String>('dish-suggestion-action-progress')),
      findsOneWidget,
    );
    expect(
      tester.widget<ElevatedButton>(_applyButton(_group1)).onPressed,
      isNull,
    );

    await tester.tap(_applyButton(_group1));
    await tester.pump();
    expect(actionRequests, hasLength(1));

    action.complete(_actionResult());
    await tester.pumpAndSettle();
    expect(listCalls, 2);
    expect(
      find.text('Dish suggestion accepted and processing.'),
      findsOneWidget,
    );
  });

  testWidgets('page navigation fences a delayed action refresh', (
    tester,
  ) async {
    final action = Completer<Object?>();
    var listCalls = 0;
    final service = RatingAdminDishSuggestionsService(
      functionsBoundary: (name, request) {
        if (name == 'applyRatingAdminDishSuggestionGroup') {
          return action.future;
        }
        listCalls++;
        return Future<Object?>.value(
          request['direction'] == 'forward'
              ? _page(
                  items: <Object?>[
                    _suggestion(groupId: _group2, sourceDishId: 'dish-2'),
                  ],
                  pageNumber: 2,
                  hasPrevious: true,
                )
              : _page(hasNext: true),
        );
      },
    );

    await tester.pumpWidget(_host(service));
    await tester.pumpAndSettle();
    await tester.ensureVisible(_applyButton(_group1));
    await tester.tap(_applyButton(_group1));
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey<String>('pagination-next')));
    await tester.pump();
    await tester.pump();
    expect(listCalls, 2);
    expect(_applyButton(_group2), findsOneWidget);

    action.complete(_actionResult());
    await tester.pumpAndSettle();
    expect(listCalls, 2);
  });

  testWidgets('visibility change fences delayed action completion', (
    tester,
  ) async {
    final action = Completer<Object?>();
    var listCalls = 0;
    final service = RatingAdminDishSuggestionsService(
      functionsBoundary: (name, request) {
        if (name == 'applyRatingAdminDishSuggestionGroup') {
          return action.future;
        }
        listCalls++;
        return Future<Object?>.value(_page());
      },
    );

    await tester.pumpWidget(_host(service));
    await tester.pumpAndSettle();
    await tester.ensureVisible(_applyButton(_group1));
    await tester.tap(_applyButton(_group1));
    await tester.pump();
    await tester.pumpWidget(_host(service, isActive: false));
    await tester.pump();

    action.complete(_actionResult());
    await tester.pumpAndSettle();
    expect(listCalls, 1);
    expect(find.byType(SnackBar), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('controller replacement fences delayed reject completion', (
    tester,
  ) async {
    final reject = Completer<Object?>();
    var oldListCalls = 0;
    var newListCalls = 0;
    final oldService = RatingAdminDishSuggestionsService(
      functionsBoundary: (name, request) {
        if (name == 'rejectRatingAdminDishSuggestionGroup') {
          return reject.future;
        }
        oldListCalls++;
        return Future<Object?>.value(_page());
      },
    );
    final newService = RatingAdminDishSuggestionsService(
      functionsBoundary: (name, request) async {
        expect(name, 'listRatingAdminDishSuggestionsPage');
        newListCalls++;
        return _page(
          items: <Object?>[
            _suggestion(groupId: _replacementGroup, sourceDishId: 'dish-2'),
          ],
        );
      },
    );

    await tester.pumpWidget(_host(oldService));
    await tester.pumpAndSettle();
    await tester.ensureVisible(_rejectButton(_group1));
    await tester.tap(_rejectButton(_group1));
    await tester.pump();
    await tester.pumpWidget(_host(newService));
    await tester.pump();
    await tester.pump();
    expect(oldListCalls, 1);
    expect(newListCalls, 1);

    reject.complete(
      _actionResult(status: 'rejecting', resolutionType: 'reject'),
    );
    await tester.pumpAndSettle();
    expect(oldListCalls, 1);
    expect(newListCalls, 1);
    expect(find.byType(SnackBar), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    '51 to 50 action removal resets to canonical last and clears anchors',
    (tester) async {
      final listRequests = <Map<String, Object?>>[];
      var shrunk = false;
      final service = RatingAdminDishSuggestionsService(
        functionsBoundary: (name, request) async {
          if (name == 'applyRatingAdminDishSuggestionGroup') {
            shrunk = true;
            return _actionResult();
          }
          expect(name, 'listRatingAdminDishSuggestionsPage');
          listRequests.add(request);
          final direction = request['direction'];
          final cursor = request['cursor'];
          if (!shrunk) {
            if (direction == 'first') {
              return _page(total: 51, hasNext: true, nextCursor: 'old-next-1');
            }
            if (cursor == 'old-next-1') {
              return _page(
                items: <Object?>[
                  _suggestion(groupId: _group2, sourceDishId: 'dish-2'),
                ],
                pageNumber: 2,
                total: 51,
                hasNext: true,
                hasPrevious: true,
                nextCursor: 'old-next-2',
              );
            }
            return _page(
              items: <Object?>[
                _suggestion(groupId: _group(5), sourceDishId: 'dish-3'),
              ],
              pageNumber: 3,
              total: 51,
              hasPrevious: true,
            );
          }
          if (direction == 'forward' && cursor == 'old-next-2') {
            throw const RatingAdminDishSuggestionsPageOutOfRangeException();
          }
          if (direction == 'first') {
            return _page(
              items: <Object?>[
                _suggestion(groupId: _group(6), sourceDishId: 'dish-1'),
              ],
              total: 50,
              hasNext: true,
              nextCursor: 'canonical-next',
            );
          }
          if (direction == 'last' || cursor == 'canonical-next') {
            return _page(
              items: <Object?>[
                _suggestion(groupId: _replacementGroup, sourceDishId: 'dish-2'),
              ],
              pageNumber: 2,
              total: 50,
              hasPrevious: true,
              previousCursor: 'canonical-previous',
            );
          }
          fail('Unexpected page request: $request');
        },
      );

      await tester.pumpWidget(_host(service));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey<String>('pagination-next')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey<String>('pagination-next')));
      await tester.pumpAndSettle();
      await tester.ensureVisible(_applyButton(_group(5)));
      await tester.tap(_applyButton(_group(5)));
      await tester.pumpAndSettle();

      expect(find.textContaining('50 results • Page 2 of 2'), findsOneWidget);
      expect(_applyButton(_replacementGroup), findsOneWidget);
      expect(
        find.byKey(const ValueKey<String>('pagination-page-3')),
        findsNothing,
      );
      expect(listRequests.map((request) => request['direction']), <Object?>[
        'first',
        'forward',
        'forward',
        'forward',
        'first',
        'last',
      ]);

      await tester.pump(const Duration(seconds: 5));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey<String>('pagination-page-1')));
      await tester.pumpAndSettle();
      expect(listRequests.last['direction'], 'first');
      await tester.tap(find.byKey(const ValueKey<String>('pagination-last')));
      await tester.pumpAndSettle();
      expect(listRequests.last['direction'], 'last');
      await tester.tap(find.byKey(const ValueKey<String>('pagination-first')));
      await tester.pumpAndSettle();
      expect(listRequests.last['direction'], 'first');
      await tester.tap(find.byKey(const ValueKey<String>('pagination-next')));
      await tester.pumpAndSettle();
      expect(listRequests.last['direction'], 'forward');
      expect(listRequests.last['cursor'], 'canonical-next');
      await tester.tap(
        find.byKey(const ValueKey<String>('pagination-previous')),
      );
      await tester.pumpAndSettle();
      expect(listRequests.last['direction'], 'first');
      expect(
        find.byKey(const ValueKey<String>('pagination-page-3')),
        findsNothing,
      );
    },
  );

  testWidgets('manual Refresh remaps page 3 after an exact 51 to 50 shrink', (
    tester,
  ) async {
    final directions = <Object?>[];
    var pageThreeCalls = 0;
    var shrunk = false;
    final service = RatingAdminDishSuggestionsService(
      functionsBoundary: (name, request) async {
        expect(name, 'listRatingAdminDishSuggestionsPage');
        directions.add(request['direction']);
        final direction = request['direction'];
        final cursor = request['cursor'];
        if (direction == 'first') {
          return _page(
            total: shrunk ? 50 : 51,
            hasNext: true,
            nextCursor: shrunk ? 'canonical-next' : 'old-next-1',
          );
        }
        if (cursor == 'old-next-1') {
          return _page(
            pageNumber: 2,
            total: 51,
            hasNext: true,
            hasPrevious: true,
            nextCursor: 'old-next-2',
          );
        }
        if (cursor == 'old-next-2') {
          pageThreeCalls++;
          if (pageThreeCalls == 1) {
            return _page(
              items: <Object?>[
                _suggestion(groupId: _group(7), sourceDishId: 'dish-7'),
              ],
              pageNumber: 3,
              total: 51,
              hasPrevious: true,
            );
          }
          shrunk = true;
          throw const RatingAdminDishSuggestionsPageOutOfRangeException();
        }
        if (direction == 'last') {
          return _page(
            items: <Object?>[
              _suggestion(groupId: _replacementGroup, sourceDishId: 'dish-2'),
            ],
            pageNumber: 2,
            total: 50,
            hasPrevious: true,
          );
        }
        fail('Unexpected page request: $request');
      },
    );

    await tester.pumpWidget(_host(service));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey<String>('pagination-next')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey<String>('pagination-next')));
    await tester.pumpAndSettle();
    expect(find.textContaining('51 results • Page 3 of 3'), findsOneWidget);

    await tester.tap(
      find.byKey(const ValueKey<String>('paged-directory-refresh')),
    );
    await tester.pumpAndSettle();

    expect(find.textContaining('50 results • Page 2 of 2'), findsOneWidget);
    expect(_applyButton(_replacementGroup), findsOneWidget);
    expect(
      find.byKey(const ValueKey<String>('pagination-page-3')),
      findsNothing,
    );
    expect(directions, <Object?>[
      'first',
      'forward',
      'forward',
      'forward',
      'first',
      'last',
    ]);
  });

  testWidgets('manual refresh shrinking to empty installs a fresh first page', (
    tester,
  ) async {
    final listRequests = <Map<String, Object?>>[];
    var forwardCalls = 0;
    var emptied = false;
    final service = RatingAdminDishSuggestionsService(
      functionsBoundary: (name, request) async {
        expect(name, 'listRatingAdminDishSuggestionsPage');
        listRequests.add(request);
        if (request['direction'] == 'first') {
          return emptied
              ? _page(items: const <Object?>[], total: 0)
              : _page(total: 26, hasNext: true, nextCursor: 'old-next');
        }
        if (request['direction'] == 'forward') {
          forwardCalls++;
          if (forwardCalls == 1) {
            return _page(
              items: <Object?>[
                _suggestion(groupId: _group2, sourceDishId: 'dish-2'),
              ],
              pageNumber: 2,
              total: 26,
              hasPrevious: true,
            );
          }
          emptied = true;
          throw const RatingAdminDishSuggestionsPageOutOfRangeException();
        }
        fail('Unexpected page request: $request');
      },
    );

    await tester.pumpWidget(_host(service));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey<String>('pagination-next')));
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(const ValueKey<String>('paged-directory-refresh')),
    );
    await tester.pumpAndSettle();

    expect(find.text('No pending dish suggestions.'), findsOneWidget);
    expect(find.textContaining('0 results • Page 1 of 1'), findsOneWidget);
    expect(listRequests.map((request) => request['direction']), <Object?>[
      'first',
      'forward',
      'forward',
      'first',
    ]);
    expect(find.byKey(const ValueKey<String>('pagination-last')), findsNothing);
    expect(
      find.byKey(const ValueKey<String>('pagination-page-2')),
      findsNothing,
    );
    expect(
      tester.binding.focusManager.primaryFocus?.debugLabel,
      'Dish Suggestions remapped results',
    );
  });

  testWidgets(
    'manual multi-page remap is canonicalized with one First and Last',
    (tester) async {
      final directions = <Object?>[];
      var lastCalls = 0;
      final service = RatingAdminDishSuggestionsService(
        functionsBoundary: (name, request) async {
          expect(name, 'listRatingAdminDishSuggestionsPage');
          directions.add(request['direction']);
          if (request['direction'] == 'first') {
            final reset = lastCalls >= 2;
            return _page(
              total: reset ? 50 : 126,
              hasNext: true,
              nextCursor: reset ? 'canonical-next' : 'old-next',
            );
          }
          if (request['direction'] == 'last') {
            lastCalls++;
            if (lastCalls == 1) {
              return _page(
                items: <Object?>[
                  _suggestion(groupId: _group(6), sourceDishId: 'dish-6'),
                ],
                pageNumber: 6,
                total: 126,
                hasPrevious: true,
              );
            }
            return _page(
              items: <Object?>[
                _suggestion(groupId: _group2, sourceDishId: 'dish-2'),
              ],
              pageNumber: 2,
              total: 50,
              hasPrevious: true,
            );
          }
          fail('Unexpected page request: $request');
        },
      );

      await tester.pumpWidget(_host(service));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey<String>('pagination-last')));
      await tester.pumpAndSettle();
      expect(find.textContaining('Page 6 of 6'), findsOneWidget);
      await tester.tap(
        find.byKey(const ValueKey<String>('paged-directory-refresh')),
      );
      await tester.pumpAndSettle();

      expect(directions, <Object?>['first', 'last', 'last', 'first', 'last']);
      expect(find.textContaining('50 results • Page 2 of 2'), findsOneWidget);
      expect(
        find.byKey(const ValueKey<String>('pagination-page-6')),
        findsNothing,
      );
    },
  );

  testWidgets(
    'hidden in-flight stale refresh is fenced and recovered on return',
    (tester) async {
      final refresh = Completer<Object?>();
      var listCalls = 0;
      var hiddenRefreshFinished = false;
      final service = RatingAdminDishSuggestionsService(
        functionsBoundary: (name, request) {
          if (name == 'applyRatingAdminDishSuggestionGroup') {
            return Future<Object?>.value(_actionResult());
          }
          listCalls++;
          if (request['direction'] == 'first') {
            return Future<Object?>.value(
              hiddenRefreshFinished
                  ? _page(items: const <Object?>[], total: 0)
                  : _page(total: 26, hasNext: true),
            );
          }
          if (listCalls == 2) {
            return Future<Object?>.value(
              _page(
                items: <Object?>[
                  _suggestion(groupId: _group2, sourceDishId: 'dish-2'),
                ],
                pageNumber: 2,
                total: 26,
                hasPrevious: true,
              ),
            );
          }
          return refresh.future;
        },
      );

      await tester.pumpWidget(_host(service));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey<String>('pagination-next')));
      await tester.pumpAndSettle();
      await tester.ensureVisible(_applyButton(_group2));
      await tester.tap(_applyButton(_group2));
      await tester.pump();
      await tester.pump();
      expect(listCalls, 3);

      await tester.pumpWidget(_host(service, isActive: false));
      await tester.pump();
      hiddenRefreshFinished = true;
      refresh.completeError(
        const RatingAdminDishSuggestionsPageOutOfRangeException(),
      );
      await tester.pumpAndSettle();
      expect(listCalls, 3);

      await tester.pumpWidget(_host(service));
      await tester.pumpAndSettle();
      expect(listCalls, 4);
      expect(find.text('No pending dish suggestions.'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('hidden Last refresh clears a remapped stale visited anchor', (
    tester,
  ) async {
    final delayedLastRefresh = Completer<Object?>();
    final directions = <Object?>[];
    var firstCalls = 0;
    var lastCalls = 0;
    final service = RatingAdminDishSuggestionsService(
      functionsBoundary: (name, request) {
        expect(name, 'listRatingAdminDishSuggestionsPage');
        directions.add(request['direction']);
        if (request['direction'] == 'first') {
          firstCalls++;
          return Future<Object?>.value(
            _page(
              total: firstCalls == 1 ? 126 : 50,
              hasNext: true,
              nextCursor: firstCalls == 1 ? 'old-next' : 'canonical-next',
            ),
          );
        }
        if (request['direction'] == 'last') {
          lastCalls++;
          if (lastCalls == 1) {
            return Future<Object?>.value(
              _page(
                items: <Object?>[
                  _suggestion(groupId: _group(8), sourceDishId: 'dish-8'),
                ],
                pageNumber: 6,
                total: 126,
                hasPrevious: true,
              ),
            );
          }
          if (lastCalls == 2) {
            return delayedLastRefresh.future;
          }
          return Future<Object?>.value(
            _page(
              items: <Object?>[
                _suggestion(groupId: _replacementGroup, sourceDishId: 'dish-2'),
              ],
              pageNumber: 2,
              total: 50,
              hasPrevious: true,
            ),
          );
        }
        fail('Unexpected page request: $request');
      },
    );

    await tester.pumpWidget(_host(service));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey<String>('pagination-last')));
    await tester.pumpAndSettle();
    expect(find.textContaining('Page 6 of 6'), findsOneWidget);
    await tester.tap(
      find.byKey(const ValueKey<String>('paged-directory-refresh')),
    );
    await tester.pump();

    await tester.pumpWidget(_host(service, isActive: false));
    await tester.pump();
    delayedLastRefresh.complete(
      _page(
        items: <Object?>[
          _suggestion(groupId: _replacementGroup, sourceDishId: 'dish-2'),
        ],
        pageNumber: 2,
        total: 50,
        hasPrevious: true,
      ),
    );
    await tester.pumpAndSettle();
    expect(directions, <Object?>['first', 'last', 'last']);

    await tester.pumpWidget(_host(service));
    await tester.pumpAndSettle();

    expect(directions, <Object?>['first', 'last', 'last', 'first', 'last']);
    expect(find.textContaining('50 results • Page 2 of 2'), findsOneWidget);
    expect(
      find.byKey(const ValueKey<String>('pagination-page-6')),
      findsNothing,
    );
  });

  testWidgets('typed stale error reached through Retry resets exactly once', (
    tester,
  ) async {
    final directions = <Object?>[];
    var oldPageThreeCalls = 0;
    var shrunk = false;
    final service = RatingAdminDishSuggestionsService(
      functionsBoundary: (name, request) async {
        expect(name, 'listRatingAdminDishSuggestionsPage');
        directions.add(request['direction']);
        final direction = request['direction'];
        final cursor = request['cursor'];
        if (direction == 'first') {
          return _page(
            total: shrunk ? 50 : 51,
            hasNext: true,
            nextCursor: shrunk ? 'canonical-next' : 'old-next-1',
          );
        }
        if (cursor == 'old-next-1') {
          return _page(
            pageNumber: 2,
            total: 51,
            hasNext: true,
            hasPrevious: true,
            nextCursor: 'old-next-2',
          );
        }
        if (cursor == 'old-next-2') {
          oldPageThreeCalls++;
          if (oldPageThreeCalls == 1) {
            return _page(pageNumber: 3, total: 51, hasPrevious: true);
          }
          if (oldPageThreeCalls == 2) {
            throw const RatingAdminDishSuggestionsException('temporary');
          }
          shrunk = true;
          throw const RatingAdminDishSuggestionsPageOutOfRangeException();
        }
        if (direction == 'last') {
          return _page(
            items: <Object?>[
              _suggestion(groupId: _replacementGroup, sourceDishId: 'dish-2'),
            ],
            pageNumber: 2,
            total: 50,
            hasPrevious: true,
          );
        }
        fail('Unexpected page request: $request');
      },
    );

    await tester.pumpWidget(_host(service));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey<String>('pagination-next')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey<String>('pagination-next')));
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(const ValueKey<String>('paged-directory-refresh')),
    );
    await tester.pumpAndSettle();
    expect(find.text('Retry'), findsOneWidget);

    await tester.tap(find.text('Retry'));
    await tester.pumpAndSettle();

    expect(oldPageThreeCalls, 3);
    expect(find.textContaining('50 results • Page 2 of 2'), findsOneWidget);
    expect(
      find.byKey(const ValueKey<String>('pagination-page-3')),
      findsNothing,
    );
    expect(directions.where((direction) => direction == 'first').length, 2);
    expect(directions.where((direction) => direction == 'last').length, 1);
  });

  testWidgets('action semantics tap once and disable while processing', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();
    final applyResult = Completer<Object?>();
    final actionRequests = <Map<String, Object?>>[];
    final service = RatingAdminDishSuggestionsService(
      functionsBoundary: (name, request) {
        if (name == 'applyRatingAdminDishSuggestionGroup') {
          actionRequests.add(request);
          return applyResult.future;
        }
        expect(name, 'listRatingAdminDishSuggestionsPage');
        return Future<Object?>.value(_page());
      },
    );

    await tester.pumpWidget(_host(service));
    await tester.pumpAndSettle();
    final applySemantics = find.semantics.byLabel(
      'Apply dish suggestion for Alpha Cafe, source Original Dish, '
      'proposed Renamed Dish',
    );
    expect(applySemantics, findsOne);
    expect(
      applySemantics.evaluate().single.getSemanticsData().hasAction(
        ui.SemanticsAction.tap,
      ),
      isTrue,
    );

    tester.semantics.tap(applySemantics);
    await tester.pump();
    expect(actionRequests, hasLength(1));
    expect(
      applySemantics.evaluate().single.getSemanticsData().hasAction(
        ui.SemanticsAction.tap,
      ),
      isFalse,
    );

    applyResult.complete(_actionResult());
    await tester.pumpAndSettle();
    expect(actionRequests, hasLength(1));
    semantics.dispose();
  });

  testWidgets('processing states disable actions with concise labels', (
    tester,
  ) async {
    final cases = <(String, String)>[
      ('applying', 'Applying / Processing'),
      ('rejecting', 'Rejecting / Processing'),
      ('retryable', 'Processing issue / Will retry'),
      ('manual_review_required', 'Needs attention'),
    ];
    for (var index = 0; index < cases.length; index++) {
      final groupId = _group(10 + index);
      final service = RatingAdminDishSuggestionsService(
        functionsBoundary: (_, _) async => _page(
          items: <Object?>[
            _suggestion(groupId: groupId, resolutionState: cases[index].$1),
          ],
        ),
      );
      await tester.pumpWidget(_host(service));
      await tester.pumpAndSettle();

      expect(find.textContaining('Status: ${cases[index].$2}'), findsOneWidget);
      expect(
        tester.widget<ElevatedButton>(_applyButton(groupId)).onPressed,
        isNull,
      );
      expect(
        tester.widget<OutlinedButton>(_rejectButton(groupId)).onPressed,
        isNull,
      );
    }
  });

  testWidgets('reject uses exact identity when display labels collide', (
    tester,
  ) async {
    final actionRequests = <Map<String, Object?>>[];
    final service = RatingAdminDishSuggestionsService(
      functionsBoundary: (name, request) async {
        if (name == 'rejectRatingAdminDishSuggestionGroup') {
          actionRequests.add(request);
          return _actionResult(status: 'rejecting', resolutionType: 'reject');
        }
        expect(name, 'listRatingAdminDishSuggestionsPage');
        return _page(
          items: <Object?>[
            _suggestion(groupId: _group1),
            _suggestion(groupId: _group2),
          ],
          total: 2,
        );
      },
    );

    await tester.pumpWidget(_host(service));
    await tester.pumpAndSettle();
    expect(find.text('Alpha Cafe'), findsNWidgets(2));
    await tester.drag(find.byType(ListView), const Offset(0, -300));
    await tester.pumpAndSettle();
    await tester.tap(_rejectButton(_group2));
    await tester.pumpAndSettle();

    expect(actionRequests, hasLength(1));
    expect(actionRequests.single['groupId'], _group2);
    expect(actionRequests.single['expectedFingerprint'], _fingerprint);
    expect(actionRequests.single['expectedMembershipGeneration'], 3);
    expect(actionRequests.single['expectedResolutionSequence'], 7);
  });

  testWidgets('initial page error exposes a bounded explicit retry', (
    tester,
  ) async {
    var calls = 0;
    final service = RatingAdminDishSuggestionsService(
      functionsBoundary: (_, _) async {
        calls++;
        if (calls == 1) {
          throw const RatingAdminDishSuggestionsException('temporary');
        }
        return _page();
      },
    );

    await tester.pumpWidget(_host(service));
    await tester.pumpAndSettle();
    expect(find.text('Try Again'), findsOneWidget);
    await tester.tap(find.text('Try Again'));
    await tester.pumpAndSettle();
    expect(calls, 2);
    expect(_applyButton(_group1), findsOneWidget);
  });

  testWidgets('responsive long-text and semantics matrix has no overflow', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetPhysicalSize);
    final longRestaurantName = List<String>.filled(
      6,
      'A deliberately long restaurant name',
    ).join(' ');
    final longDishName = List<String>.filled(
      6,
      'A deliberately long source dish name',
    ).join(' ');
    final longProposedName = List<String>.filled(
      6,
      'A deliberately long proposed dish display name',
    ).join(' ');
    final fixtures = <({String groupId, String state})>[
      (groupId: _group1, state: 'idle'),
      (groupId: _group2, state: 'applying'),
      (groupId: _group(9), state: 'manual_review_required'),
    ];

    for (final width in <double>[320, 390, 1280]) {
      for (final scale in <double>[1, 1.5, 2]) {
        for (final fixture in fixtures) {
          final service = RatingAdminDishSuggestionsService(
            functionsBoundary: (_, _) async => _page(
              items: <Object?>[
                _suggestion(
                  groupId: fixture.groupId,
                  restaurantName: longRestaurantName,
                  proposedDisplayName: longProposedName,
                  resolutionState: fixture.state,
                  sourceDish: _dish(
                    id: 'dish-1',
                    restaurantName: longRestaurantName,
                    name: longDishName,
                  ),
                ),
              ],
            ),
          );
          tester.view.physicalSize = Size(width, 900);
          await tester.pumpWidget(_host(service, textScale: scale));
          await tester.pumpAndSettle();

          expect(
            tester.takeException(),
            isNull,
            reason: '$width at $scale for ${fixture.state}',
          );
          expect(
            tester.getSize(_applyButton(fixture.groupId)).height,
            greaterThanOrEqualTo(48),
          );
          expect(
            tester.getSize(_rejectButton(fixture.groupId)).height,
            greaterThanOrEqualTo(48),
          );
        }
      }
    }

    final semantics = tester.ensureSemantics();
    await tester.pump();
    expect(
      tester
          .widget<IconButton>(
            find.byKey(const ValueKey<String>('paged-directory-refresh')),
          )
          .tooltip,
      'Refresh results',
    );
    expect(
      find.bySemanticsLabel(RegExp(r'Apply dish suggestion for .*')),
      findsOneWidget,
    );
    expect(
      find.bySemanticsLabel(RegExp(r'Reject dish suggestion for .*')),
      findsOneWidget,
    );
    semantics.dispose();
  });

  testWidgets(
    'keyboard focus exists and page transition restores results focus',
    (tester) async {
      var calls = 0;
      final service = RatingAdminDishSuggestionsService(
        functionsBoundary: (name, request) async {
          expect(name, 'listRatingAdminDishSuggestionsPage');
          calls++;
          return request['direction'] == 'forward'
              ? _page(
                  items: <Object?>[
                    _suggestion(groupId: _group2, sourceDishId: 'dish-2'),
                  ],
                  pageNumber: 2,
                  total: 26,
                  hasPrevious: true,
                )
              : _page(total: 26, hasNext: true);
        },
      );

      await tester.pumpWidget(_host(service));
      await tester.pumpAndSettle();
      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pump();
      expect(tester.binding.focusManager.primaryFocus, isNotNull);

      await tester.tap(find.byKey(const ValueKey<String>('pagination-next')));
      await tester.pumpAndSettle();
      expect(calls, 2);
      expect(
        tester.binding.focusManager.primaryFocus?.debugLabel,
        'Paged results',
      );
    },
  );
}
