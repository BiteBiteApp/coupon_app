import 'package:cloud_functions/cloud_functions.dart';

import '../models/pagination/paged_models.dart';
import '../models/rating_admin_people_paging_models.dart';

typedef RatingAdminPeopleFunctionsBoundary =
    Future<Object?> Function(String callableName, Map<String, Object?> request);

class RatingAdminPeoplePagingException implements Exception {
  const RatingAdminPeoplePagingException(this.message);

  final String message;

  @override
  String toString() => message;
}

class RatingAdminPeoplePagingService {
  RatingAdminPeoplePagingService({
    RatingAdminPeopleFunctionsBoundary? functionsBoundary,
  }) : _functionsBoundary = functionsBoundary ?? _callFirebase;

  static const int pageSize = 50;

  final RatingAdminPeopleFunctionsBoundary _functionsBoundary;

  Future<PagedResponse<RatingAdminUserRecord>> loadUsersPage(
    PagedRequest request,
  ) => _load(
    'searchRatingAdminUsersPage',
    request,
    RatingAdminUserRecord.fromJson,
  );

  Future<PagedResponse<RatingAdminUserRecord>> loadLogicalUsersPage(
    PagedRequest request, {
    required bool Function() canContinue,
  }) async {
    var nextRequest = request;
    PagedResponse<RatingAdminUserRecord>? candidate;
    String? fingerprint;
    int? visiblePageNumber;
    final continuationCursors = <String>{};
    var continuationNumber = 0;

    while (true) {
      final page = await loadUsersPage(nextRequest);
      if (!canContinue()) {
        throw const RatingAdminPeoplePagingException(
          'The Rating Admin request was replaced.',
        );
      }
      fingerprint ??= page.queryFingerprint;
      if (page.queryFingerprint != fingerprint) {
        throw const RatingAdminPeoplePagingException(
          'Rating Admin returned an invalid page. Refresh and try again.',
        );
      }
      final preparation = page.preparation;
      if (preparation?.state == PagePreparationState.failed) {
        throw const RatingAdminPeoplePagingException(
          'Rating Admin could not prepare this page. Try again.',
        );
      }
      if (preparation?.state != PagePreparationState.preparing) {
        if (candidate == null) {
          if (preparation?.state == PagePreparationState.ready) {
            throw const RatingAdminPeoplePagingException(
              'Rating Admin returned an invalid page. Refresh and try again.',
            );
          }
          return page;
        }
        if (preparation?.state != PagePreparationState.ready ||
            page.items.isNotEmpty ||
            page.pageSize != candidate.pageSize ||
            page.total?.state != PagedTotalState.unknown ||
            page.pageNumber == null) {
          throw const RatingAdminPeoplePagingException(
            'Rating Admin returned an invalid page. Refresh and try again.',
          );
        }
        final targetPage = page.pageNumber!.currentPageNumber;
        return PagedResponse<RatingAdminUserRecord>(
          items: candidate.items,
          pageSize: candidate.pageSize,
          hasNext: page.hasNext,
          hasPrevious: candidate.hasPrevious,
          nextCursor: page.nextCursor,
          previousCursor: candidate.previousCursor,
          pageNumber: page.pageNumber,
          total: candidate.total,
          queryFingerprint: candidate.queryFingerprint,
          snapshotTimestampMs: page.snapshotTimestampMs,
          capabilities: PageCapabilities(
            first: targetPage > 1,
            previous: candidate.hasPrevious,
            numberedVisitedPages: true,
            next: page.hasNext,
            last: false,
          ),
        );
      }
      if (request.criteria['mode'] != 'claimedRestaurant' ||
          page.total?.state != PagedTotalState.unknown ||
          page.pageNumber == null ||
          !page.hasNext ||
          page.nextCursor == null) {
        throw const RatingAdminPeoplePagingException(
          'Rating Admin returned an invalid page. Refresh and try again.',
        );
      }
      final currentVisiblePage = page.pageNumber!.currentPageNumber;
      visiblePageNumber ??= currentVisiblePage;
      if (currentVisiblePage != visiblePageNumber) {
        throw const RatingAdminPeoplePagingException(
          'Rating Admin returned an invalid page. Refresh and try again.',
        );
      }
      if (page.items.isNotEmpty) {
        if (candidate != null) {
          throw const RatingAdminPeoplePagingException(
            'Rating Admin returned an invalid page. Refresh and try again.',
          );
        }
        candidate = page;
      }
      final cursor = page.nextCursor!;
      if (!continuationCursors.add(cursor)) {
        throw const RatingAdminPeoplePagingException(
          'Rating Admin returned an invalid continuation. Refresh and try again.',
        );
      }
      await Future<void>.delayed(Duration.zero);
      if (!canContinue()) {
        throw const RatingAdminPeoplePagingException(
          'The Rating Admin request was replaced.',
        );
      }
      continuationNumber++;
      final suffix = '-continuation-$continuationNumber';
      final maximumBaseLength = 128 - suffix.length;
      final requestId = nextRequest.clientRequestId.length > maximumBaseLength
          ? nextRequest.clientRequestId.substring(0, maximumBaseLength)
          : nextRequest.clientRequestId;
      nextRequest = PagedRequest(
        pageSize: request.pageSize,
        criteria: request.criteria,
        cursor: cursor,
        direction: PageDirection.forward,
        requestExactCount: request.requestExactCount,
        clientRequestId: '$requestId$suffix',
      );
    }
  }

  Future<PagedResponse<RatingAdminUserPointsRecord>> loadUserPointsPage(
    PagedRequest request,
  ) => _load(
    'listRatingAdminUserPointsPage',
    request,
    RatingAdminUserPointsRecord.fromJson,
  );

  Future<PagedResponse<RatingAdminContributionLedgerRecord>>
  loadContributionLedgerPage(PagedRequest request) => _load(
    'listRatingAdminContributionLedgerPage',
    request,
    RatingAdminContributionLedgerRecord.fromJson,
  );

  Future<PagedResponse<T>> _load<T>(
    String callableName,
    PagedRequest request,
    T Function(Object? value) parser,
  ) async {
    try {
      final raw = await _functionsBoundary(callableName, request.toJson());
      return PagedResponse<T>.fromJson(raw, itemParser: parser);
    } on RatingAdminPeoplePagingException {
      rethrow;
    } on FirebaseFunctionsException catch (error) {
      throw RatingAdminPeoplePagingException(
        error.message ?? 'Rating Admin results could not be loaded.',
      );
    } on FormatException {
      throw const RatingAdminPeoplePagingException(
        'Rating Admin returned an invalid page. Refresh and try again.',
      );
    } catch (_) {
      throw const RatingAdminPeoplePagingException(
        'Rating Admin results could not be loaded. Try again.',
      );
    }
  }

  static Future<Object?> _callFirebase(
    String callableName,
    Map<String, Object?> request,
  ) async {
    final functions = FirebaseFunctions.instanceFor(region: 'us-central1');
    final response = await functions
        .httpsCallable(callableName)
        .call<Object?>(request);
    return response.data;
  }

  static Map<String, Object?> usersCriteria({
    required RatingAdminUserSearchMode mode,
    String? value,
  }) {
    if (mode == RatingAdminUserSearchMode.viewAll) {
      return <String, Object?>{'mode': mode.wireName};
    }
    final normalized = value?.trim() ?? '';
    if (normalized.isEmpty || normalized.length > 1500) {
      throw const RatingAdminPeoplePagingException(
        'Enter a search value for the selected mode.',
      );
    }
    return <String, Object?>{'mode': mode.wireName, 'value': normalized};
  }

  static Map<String, Object?> userPointsCriteria(
    RatingAdminUserPointsSort sort,
  ) => <String, Object?>{'sort': sort.wireName};

  static Map<String, Object?> contributionLedgerCriteria(String userId) {
    final normalized = userId.trim();
    if (normalized.isEmpty || normalized.contains('/')) {
      throw const RatingAdminPeoplePagingException(
        'The selected user identity is invalid.',
      );
    }
    return <String, Object?>{'userId': normalized};
  }
}
