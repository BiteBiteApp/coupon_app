import 'package:cloud_functions/cloud_functions.dart';

import '../models/pagination/paged_models.dart';
import '../models/rating_admin_dish_suggestion_models.dart';

typedef RatingAdminDishSuggestionsFunctionsBoundary =
    Future<Object?> Function(String callableName, Map<String, Object?> request);

class RatingAdminDishSuggestionsException implements Exception {
  const RatingAdminDishSuggestionsException(this.message);

  final String message;

  @override
  String toString() => message;
}

const String ratingAdminDishSuggestionsPageOutOfRangeMessage =
    'The Dish Suggestions page is no longer available.';

class RatingAdminDishSuggestionsPageOutOfRangeException
    extends RatingAdminDishSuggestionsException {
  const RatingAdminDishSuggestionsPageOutOfRangeException()
    : super(ratingAdminDishSuggestionsPageOutOfRangeMessage);
}

class RatingAdminDishSuggestionsService {
  RatingAdminDishSuggestionsService({
    RatingAdminDishSuggestionsFunctionsBoundary? functionsBoundary,
  }) : _functionsBoundary = functionsBoundary ?? _callFirebase;

  static const int pageSize = operationalQueueDefaultPageSize;
  static const Map<String, Object?> pageCriteria = <String, Object?>{
    'entityKind': 'dishSuggestions',
  };

  final RatingAdminDishSuggestionsFunctionsBoundary _functionsBoundary;

  Future<PagedResponse<RatingAdminDishSuggestionRecord>> loadDishSuggestionPage(
    PagedRequest request,
  ) async {
    try {
      _validatePageRequest(request);
      final raw = await _functionsBoundary(
        'listRatingAdminDishSuggestionsPage',
        request.toJson(),
      );
      final page = PagedResponse<RatingAdminDishSuggestionRecord>.fromJson(
        raw,
        itemParser: RatingAdminDishSuggestionRecord.fromJson,
      );
      _validatePageResponse(page);
      return page;
    } on RatingAdminDishSuggestionsException {
      rethrow;
    } on FirebaseFunctionsException catch (error) {
      if (error.code == 'out-of-range' &&
          error.message == ratingAdminDishSuggestionsPageOutOfRangeMessage) {
        throw const RatingAdminDishSuggestionsPageOutOfRangeException();
      }
      throw RatingAdminDishSuggestionsException(
        error.message ?? 'Dish suggestions could not be loaded.',
      );
    } on FormatException {
      throw const RatingAdminDishSuggestionsException(
        'Dish Suggestions returned an invalid page. Refresh and try again.',
      );
    } catch (_) {
      throw const RatingAdminDishSuggestionsException(
        'Dish suggestions could not be loaded. Try again.',
      );
    }
  }

  void _validatePageRequest(PagedRequest request) {
    if (request.pageSize != pageSize ||
        !request.requestExactCount ||
        request.criteria.length != pageCriteria.length ||
        request.criteria['entityKind'] != pageCriteria['entityKind']) {
      throw const FormatException('Invalid Dish Suggestions page request.');
    }
  }

  void _validatePageResponse(
    PagedResponse<RatingAdminDishSuggestionRecord> page,
  ) {
    final currentPageNumber = page.pageNumber?.currentPageNumber;
    final total = page.total;
    if (page.pageSize != pageSize ||
        currentPageNumber == null ||
        total?.isExact != true ||
        !page.capabilities.numberedVisitedPages) {
      throw const FormatException('Invalid Dish Suggestions page response.');
    }

    final totalPages = page.pageNumber!.totalPages(total, page.pageSize)!;
    final hasPrevious = currentPageNumber > 1;
    final hasNext = currentPageNumber < totalPages;
    if (page.hasPrevious != hasPrevious ||
        page.hasNext != hasNext ||
        page.capabilities.first != hasPrevious ||
        page.capabilities.last != hasNext ||
        total!.exactValue! < page.items.length ||
        page.items.any(
          (item) =>
              item.dueNow !=
              (item.dueAtMillis != null &&
                  item.dueAtMillis! <= page.snapshotTimestampMs),
        )) {
      throw const FormatException('Invalid Dish Suggestions page response.');
    }
  }

  Future<RatingAdminDishSuggestionActionResult> applyDishSuggestionGroup(
    RatingAdminDishSuggestionActionRequest request,
  ) {
    return _runAction(
      'applyRatingAdminDishSuggestionGroup',
      RatingAdminDishSuggestionResolutionType.apply,
      request,
    );
  }

  Future<RatingAdminDishSuggestionActionResult> rejectDishSuggestionGroup(
    RatingAdminDishSuggestionActionRequest request,
  ) {
    return _runAction(
      'rejectRatingAdminDishSuggestionGroup',
      RatingAdminDishSuggestionResolutionType.reject,
      request,
    );
  }

  Future<RatingAdminDishSuggestionActionResult> _runAction(
    String callableName,
    RatingAdminDishSuggestionResolutionType expectedResolutionType,
    RatingAdminDishSuggestionActionRequest request,
  ) async {
    try {
      final raw = await _functionsBoundary(callableName, request.toJson());
      final result = RatingAdminDishSuggestionActionResult.fromJson(raw);
      if (result.accepted && result.resolutionType != expectedResolutionType) {
        throw const FormatException(
          'Accepted dish suggestion action type does not match the request.',
        );
      }
      return result;
    } on RatingAdminDishSuggestionsException {
      rethrow;
    } on FirebaseFunctionsException catch (error) {
      throw RatingAdminDishSuggestionsException(
        error.message ?? 'The dish suggestion action could not be completed.',
      );
    } on FormatException {
      throw const RatingAdminDishSuggestionsException(
        'Dish Suggestions returned an invalid action result. Refresh and try again.',
      );
    } catch (_) {
      throw const RatingAdminDishSuggestionsException(
        'The dish suggestion action could not be completed. Try again.',
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
}
