import 'package:coupon_app/models/pagination/paged_models.dart';
import 'package:coupon_app/models/rating_admin_dish_suggestion_models.dart';
import 'package:coupon_app/services/rating_admin_dish_suggestions_service.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter_test/flutter_test.dart';

const String _groupId =
    '1111111111111111111111111111111111111111111111111111111111111111';
const String _fingerprint =
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

Map<String, Object?> _dish({
  required String id,
  String restaurantId = 'restaurant-1',
  String name = 'Original Dish',
  bool isActive = true,
  String? mergedIntoDishId,
}) => <String, Object?>{
  'id': id,
  'restaurantId': restaurantId,
  'restaurantName': 'Alpha Cafe',
  'name': name,
  'isActive': isActive,
  'mergedIntoDishId': mergedIntoDishId,
};

Map<String, Object?> _suggestion({
  String groupId = _groupId,
  String fingerprint = _fingerprint,
  int membershipGeneration = 3,
  int resolutionSequence = 7,
  String proposalType = 'rename',
  String restaurantId = 'restaurant-1',
  String sourceDishId = 'dish-1',
  String? mergeTargetDishId,
  String? proposedDisplayName = 'Renamed Dish',
  bool hasPendingMembers = true,
  String resolutionState = 'idle',
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
  'sourceDish': sourceDish ?? _dish(id: sourceDishId),
  'mergeTargetDish': mergeTargetDish,
  'restaurant': <String, Object?>{'id': restaurantId, 'name': 'Alpha Cafe'},
};

Map<String, Object?> _page({
  List<Object?>? items,
  int pageNumber = 1,
  bool hasNext = false,
  bool hasPrevious = false,
}) => <String, Object?>{
  'protocolVersion': pageProtocolVersion,
  'items': items ?? <Object?>[_suggestion()],
  'pageSize': 25,
  'hasNext': hasNext,
  'hasPrevious': hasPrevious,
  if (hasNext) 'nextCursor': 'next-$pageNumber',
  if (hasPrevious) 'previousCursor': 'previous-$pageNumber',
  'currentPageNumber': pageNumber,
  'total': <String, Object?>{'state': 'exact', 'value': items?.length ?? 1},
  'queryFingerprint':
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'snapshotTimestampMs': 1721952000000,
  'capabilities': <String, Object?>{
    'first': pageNumber > 1,
    'previous': hasPrevious,
    'numberedVisitedPages': true,
    'next': hasNext,
    'last': hasNext,
  },
};

PagedRequest _request() => PagedRequest(
  pageSize: 25,
  criteria: RatingAdminDishSuggestionsService.pageCriteria,
  direction: PageDirection.first,
  requestExactCount: true,
  clientRequestId: 'page-request-1',
);

Map<String, Object?> _actionResult({
  bool accepted = true,
  String status = 'applying',
  String? resolutionType = 'apply',
  bool processing = true,
  bool complete = false,
  bool manualReviewRequired = false,
  String messageCategory = 'accepted_processing',
}) => <String, Object?>{
  'contractVersion': dishProposalActionResultContractVersion,
  'accepted': accepted,
  'status': status,
  'resolutionType': resolutionType,
  'processing': processing,
  'complete': complete,
  'manualReviewRequired': manualReviewRequired,
  'messageCategory': messageCategory,
};

RatingAdminDishSuggestionActionRequest _actionRequest() =>
    RatingAdminDishSuggestionActionRequest(
      groupId: _groupId,
      expectedFingerprint: _fingerprint,
      expectedMembershipGeneration: 3,
      expectedResolutionSequence: 7,
      clientRequestId: 'action-request-1',
    );

void main() {
  test(
    'list uses exact callable, criteria, size, and strict record model',
    () async {
      final calls = <(String, Map<String, Object?>)>[];
      final service = RatingAdminDishSuggestionsService(
        functionsBoundary: (name, request) async {
          calls.add((name, request));
          return _page();
        },
      );

      final response = await service.loadDishSuggestionPage(_request());

      expect(calls, hasLength(1));
      expect(calls.single.$1, 'listRatingAdminDishSuggestionsPage');
      expect(calls.single.$2, <String, Object?>{
        'protocolVersion': pageProtocolVersion,
        'pageSize': 25,
        'criteria': <String, Object?>{'entityKind': 'dishSuggestions'},
        'direction': 'first',
        'requestExactCount': true,
        'clientRequestId': 'page-request-1',
      });
      expect(response.items.single.groupId, _groupId);
      expect(response.items.single.fingerprint, _fingerprint);
      expect(response.items.single.membershipGeneration, 3);
      expect(response.items.single.resolutionSequence, 7);
      expect(response.items.single.proposedDisplayName, 'Renamed Dish');
      expect(response.pageSize, 25);
      expect(response.total?.exactValue, 1);
    },
  );

  test('list rejects noncanonical page requests before the boundary', () async {
    var boundaryCalls = 0;
    final service = RatingAdminDishSuggestionsService(
      functionsBoundary: (_, _) async {
        boundaryCalls++;
        return _page();
      },
    );
    final invalidRequests = <PagedRequest>[
      PagedRequest(
        pageSize: 50,
        criteria: RatingAdminDishSuggestionsService.pageCriteria,
        direction: PageDirection.first,
        requestExactCount: true,
        clientRequestId: 'wrong-size',
      ),
      PagedRequest(
        pageSize: 25,
        criteria: const <String, Object?>{'entityKind': 'restaurants'},
        direction: PageDirection.first,
        requestExactCount: true,
        clientRequestId: 'wrong-criteria',
      ),
      PagedRequest(
        pageSize: 25,
        criteria: RatingAdminDishSuggestionsService.pageCriteria,
        direction: PageDirection.first,
        requestExactCount: false,
        clientRequestId: 'missing-count',
      ),
    ];

    for (final request in invalidRequests) {
      await expectLater(
        service.loadDishSuggestionPage(request),
        throwsA(isA<RatingAdminDishSuggestionsException>()),
      );
    }
    expect(boundaryCalls, 0);
  });

  test('list rejects endpoint-specific page response contradictions', () async {
    final base = _page();
    final capabilities = Map<String, Object?>.from(
      base['capabilities']! as Map,
    );
    final withoutPageNumber = Map<String, Object?>.from(base)
      ..remove('currentPageNumber');
    final invalidPages = <Map<String, Object?>>[
      <String, Object?>{...base, 'pageSize': 50},
      <String, Object?>{
        ...base,
        'total': const <String, Object?>{'state': 'unknown'},
      },
      withoutPageNumber,
      <String, Object?>{
        ...base,
        'capabilities': <String, Object?>{
          ...capabilities,
          'numberedVisitedPages': false,
        },
      },
      _page(items: <Object?>[_suggestion(dueNow: true)]),
    ];

    for (final page in invalidPages) {
      final service = RatingAdminDishSuggestionsService(
        functionsBoundary: (_, _) async => page,
      );
      await expectLater(
        service.loadDishSuggestionPage(_request()),
        throwsA(
          isA<RatingAdminDishSuggestionsException>().having(
            (error) => error.message,
            'message',
            contains('invalid page'),
          ),
        ),
      );
    }
  });

  test(
    'maps only the exact stale-page Functions error to its subtype',
    () async {
      // The constructor is protected for platform implementations but is the
      // package's public exception type delivered through callable boundaries.
      // ignore: invalid_use_of_protected_member
      final outOfRange = FirebaseFunctionsException(
        code: 'out-of-range',
        message: ratingAdminDishSuggestionsPageOutOfRangeMessage,
      );
      final mapped = RatingAdminDishSuggestionsService(
        functionsBoundary: (_, _) async => throw outOfRange,
      );

      await expectLater(
        mapped.loadDishSuggestionPage(_request()),
        throwsA(isA<RatingAdminDishSuggestionsPageOutOfRangeException>()),
      );

      // ignore: invalid_use_of_protected_member
      final wrongMessage = FirebaseFunctionsException(
        code: 'out-of-range',
        message: 'Some other out-of-range failure.',
      );
      final generic = RatingAdminDishSuggestionsService(
        functionsBoundary: (_, _) async => throw wrongMessage,
      );
      await expectLater(
        generic.loadDishSuggestionPage(_request()),
        throwsA(
          isA<RatingAdminDishSuggestionsException>().having(
            (error) => error,
            'type',
            isNot(isA<RatingAdminDishSuggestionsPageOutOfRangeException>()),
          ),
        ),
      );
    },
  );

  test(
    'apply and reject use exact callable and action identity payload',
    () async {
      final calls = <(String, Map<String, Object?>)>[];
      final service = RatingAdminDishSuggestionsService(
        functionsBoundary: (name, request) async {
          calls.add((name, request));
          return name == 'applyRatingAdminDishSuggestionGroup'
              ? _actionResult()
              : _actionResult(status: 'rejecting', resolutionType: 'reject');
        },
      );

      final apply = await service.applyDishSuggestionGroup(_actionRequest());
      final reject = await service.rejectDishSuggestionGroup(_actionRequest());

      expect(calls.map((call) => call.$1), <String>[
        'applyRatingAdminDishSuggestionGroup',
        'rejectRatingAdminDishSuggestionGroup',
      ]);
      for (final call in calls) {
        expect(call.$2, <String, Object?>{
          'contractVersion': dishProposalActionContractVersion,
          'groupId': _groupId,
          'expectedFingerprint': _fingerprint,
          'expectedMembershipGeneration': 3,
          'expectedResolutionSequence': 7,
          'clientRequestId': 'action-request-1',
        });
      }
      expect(
        apply.resolutionType,
        RatingAdminDishSuggestionResolutionType.apply,
      );
      expect(
        reject.resolutionType,
        RatingAdminDishSuggestionResolutionType.reject,
      );
    },
  );

  test('strict queue boundary rejects unknown and mismatched fields', () async {
    final invalidItems = <Map<String, Object?>>[
      <String, Object?>{..._suggestion(), 'internalCanary': 'private'},
      _suggestion(sourceDish: _dish(id: 'wrong-source-id')),
      _suggestion(
        proposalType: 'merge',
        mergeTargetDishId: 'dish-2',
        proposedDisplayName: null,
        mergeTargetDish: _dish(id: 'wrong-target-id', name: 'Target'),
      ),
    ];

    for (final item in invalidItems) {
      final service = RatingAdminDishSuggestionsService(
        functionsBoundary: (_, _) async => _page(items: <Object?>[item]),
      );
      await expectLater(
        service.loadDishSuggestionPage(_request()),
        throwsA(isA<RatingAdminDishSuggestionsException>()),
      );
    }
  });

  test('handler-shaped mixed page preserves a missing rename name', () async {
    const missingGroup =
        '2222222222222222222222222222222222222222222222222222222222222222';
    const namedGroup =
        '3333333333333333333333333333333333333333333333333333333333333333';
    const mergeGroup =
        '4444444444444444444444444444444444444444444444444444444444444444';
    final service = RatingAdminDishSuggestionsService(
      functionsBoundary: (_, _) async => _page(
        items: <Object?>[
          _suggestion(
            groupId: missingGroup,
            fingerprint:
                'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            membershipGeneration: 4,
            resolutionSequence: 8,
            sourceDishId: 'dish-missing-name',
            proposedDisplayName: null,
          ),
          _suggestion(
            groupId: namedGroup,
            fingerprint:
                'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
            membershipGeneration: 5,
            resolutionSequence: 9,
            sourceDishId: 'dish-named-rename',
            proposedDisplayName: 'crispy garlic knots',
          ),
          _suggestion(
            groupId: mergeGroup,
            fingerprint:
                'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
            membershipGeneration: 6,
            resolutionSequence: 10,
            proposalType: 'merge',
            sourceDishId: 'dish-merge-source',
            mergeTargetDishId: 'dish-merge-target',
            proposedDisplayName: null,
            mergeTargetDish: _dish(id: 'dish-merge-target'),
          ),
        ],
      ),
    );

    final response = await service.loadDishSuggestionPage(_request());

    expect(response.items, hasLength(3));
    expect(response.items.map((record) => record.groupId), <String>[
      missingGroup,
      namedGroup,
      mergeGroup,
    ]);
    expect(response.items[0].proposedDisplayName, isNull);
    expect(
      response.items[0].fingerprint,
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    );
    expect(response.items[0].membershipGeneration, 4);
    expect(response.items[0].resolutionSequence, 8);
    expect(response.items[1].proposedDisplayName, 'crispy garlic knots');
    expect(response.items[2].proposedDisplayName, isNull);
    expect(response.items[2].mergeTargetDishId, 'dish-merge-target');
  });

  test('service preserves strict empty proposed-name rejection', () async {
    final service = RatingAdminDishSuggestionsService(
      functionsBoundary: (_, _) async => _page(
        items: <Object?>[
          _suggestion(),
          _suggestion(
            groupId:
                '2222222222222222222222222222222222222222222222222222222222222222',
            fingerprint:
                'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            sourceDishId: 'dish-empty-name',
            proposedDisplayName: '',
          ),
        ],
      ),
    );

    await expectLater(
      service.loadDishSuggestionPage(_request()),
      throwsA(isA<RatingAdminDishSuggestionsException>()),
    );
  });

  test('nullable proposal fields and invalid relationships stay visible', () {
    final record = RatingAdminDishSuggestionRecord.fromJson(
      _suggestion(
        proposedDisplayName: null,
        sourceDish: _dish(id: 'dish-1', restaurantId: 'different-restaurant'),
      ),
    );

    expect(record.proposedDisplayName, isNull);
    expect(record.sourceDish?.restaurantId, 'different-restaurant');
    expect(record.restaurantId, 'restaurant-1');

    final missingMergeTarget = RatingAdminDishSuggestionRecord.fromJson(
      _suggestion(
        proposalType: 'merge',
        mergeTargetDishId: null,
        proposedDisplayName: null,
      ),
    );
    expect(missingMergeTarget.mergeTargetDishId, isNull);
    expect(missingMergeTarget.mergeTargetDish, isNull);
  });

  test('valid long rename display names remain visible without truncation', () {
    final proposedName = 'A${List<String>.filled(1999, 'b').join()}';
    final record = RatingAdminDishSuggestionRecord.fromJson(
      _suggestion(proposedDisplayName: proposedName),
    );

    expect(record.proposedDisplayName, proposedName);
  });

  test('contradictory queue projection state fails closed', () {
    final invalidItems = <Map<String, Object?>>[
      <String, Object?>{..._suggestion(), 'hasPendingMembers': false},
      <String, Object?>{
        ..._suggestion(),
        'oldestTrustedProposalTimeMillis': null,
      },
      <String, Object?>{..._suggestion(), 'dueAtMillis': null, 'dueNow': true},
      <String, Object?>{
        ..._suggestion(),
        'enoughSupporters': false,
        'autoEligible': true,
      },
      <String, Object?>{
        ..._suggestion(),
        'resolutionState': 'applying',
        'autoEligible': true,
      },
      <String, Object?>{..._suggestion(), 'autoEligible': false},
      <String, Object?>{..._suggestion(), 'dueAtMillis': 1722211200001},
    ];

    for (final item in invalidItems) {
      expect(
        () => RatingAdminDishSuggestionRecord.fromJson(item),
        throwsFormatException,
      );
    }
  });

  test('action request validates every optimistic identity component', () {
    expect(
      () => RatingAdminDishSuggestionActionRequest(
        groupId: 'not-a-group-hash',
        expectedFingerprint: _fingerprint,
        expectedMembershipGeneration: 3,
        expectedResolutionSequence: 7,
        clientRequestId: 'action-request-1',
      ),
      throwsFormatException,
    );
    expect(
      () => RatingAdminDishSuggestionActionRequest(
        groupId: _groupId,
        expectedFingerprint: 'not-a-fingerprint',
        expectedMembershipGeneration: 3,
        expectedResolutionSequence: 7,
        clientRequestId: 'action-request-1',
      ),
      throwsFormatException,
    );
    expect(
      () => RatingAdminDishSuggestionActionRequest(
        groupId: _groupId,
        expectedFingerprint: _fingerprint,
        expectedMembershipGeneration: -1,
        expectedResolutionSequence: 7,
        clientRequestId: 'action-request-1',
      ),
      throwsFormatException,
    );
    expect(
      () => RatingAdminDishSuggestionActionRequest(
        groupId: _groupId,
        expectedFingerprint: _fingerprint,
        expectedMembershipGeneration: 3,
        expectedResolutionSequence: 7,
        clientRequestId: 'contains whitespace',
      ),
      throwsFormatException,
    );
  });

  test('action result contradictions fail closed', () {
    final invalidResults = <Map<String, Object?>>[
      <String, Object?>{..._actionResult(), 'privateCanary': true},
      _actionResult(processing: false),
      _actionResult(complete: true),
      _actionResult(resolutionType: 'reject'),
      _actionResult(accepted: false),
      _actionResult(messageCategory: 'accepted_complete'),
      _actionResult(
        accepted: false,
        status: 'manual_review_required',
        resolutionType: 'apply',
        processing: false,
        manualReviewRequired: false,
        messageCategory: 'manual_review_required',
      ),
      _actionResult(
        accepted: false,
        status: 'stale',
        resolutionType: 'apply',
        processing: false,
        messageCategory: 'stale_group',
      ),
    ];

    for (final result in invalidResults) {
      expect(
        () => RatingAdminDishSuggestionActionResult.fromJson(result),
        throwsFormatException,
      );
    }
  });

  test(
    'service converts malformed action responses to controlled errors',
    () async {
      final service = RatingAdminDishSuggestionsService(
        functionsBoundary: (_, _) async => _actionResult(processing: false),
      );

      await expectLater(
        service.applyDishSuggestionGroup(_actionRequest()),
        throwsA(
          isA<RatingAdminDishSuggestionsException>().having(
            (error) => error.message,
            'message',
            contains('invalid action result'),
          ),
        ),
      );
    },
  );

  test('accepted action type must match its callable endpoint', () async {
    final invalid = RatingAdminDishSuggestionsService(
      functionsBoundary: (_, _) async =>
          _actionResult(status: 'rejecting', resolutionType: 'reject'),
    );
    await expectLater(
      invalid.applyDishSuggestionGroup(_actionRequest()),
      throwsA(
        isA<RatingAdminDishSuggestionsException>().having(
          (error) => error.message,
          'message',
          contains('invalid action result'),
        ),
      ),
    );

    final alreadyProcessing = RatingAdminDishSuggestionsService(
      functionsBoundary: (_, _) async => _actionResult(
        accepted: false,
        status: 'rejecting',
        resolutionType: 'reject',
        messageCategory: 'already_processing',
      ),
    );
    final result = await alreadyProcessing.applyDishSuggestionGroup(
      _actionRequest(),
    );
    expect(result.accepted, isFalse);
    expect(
      result.resolutionType,
      RatingAdminDishSuggestionResolutionType.reject,
    );
  });
}
