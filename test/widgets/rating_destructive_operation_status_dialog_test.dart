import 'dart:async';

import 'package:coupon_app/models/rating_destructive_operation_models.dart';
import 'package:coupon_app/services/rating_destructive_operations_service.dart';
import 'package:coupon_app/widgets/rating_destructive_operation_status_dialog.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const String _operationId =
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const String _differentOperationId =
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

Map<String, Object?> summaryJson({
  String operationId = _operationId,
  String operation = 'dishMerge',
  String status = 'active',
  String progressCategory = 'moving_data',
  bool accepted = true,
  bool processing = true,
  bool complete = false,
  bool retryable = false,
  bool manualReviewRequired = false,
  int processedCount = 2,
  int updatedAtMs = 1786406401000,
  String? messageCategory,
}) => <String, Object?>{
  'contractVersion': ratingDestructiveSummaryContractVersion,
  'accepted': accepted,
  'operationId': operationId,
  'operation': operation,
  'status': status,
  'progressCategory': progressCategory,
  'processing': processing,
  'complete': complete,
  'retryable': retryable,
  'manualReviewRequired': manualReviewRequired,
  'messageCategory':
      messageCategory ??
      switch (status) {
        'complete' => 'accepted_complete',
        'retryable' => 'retryable_processing',
        'manual_review_required' => 'manual_review_required',
        _ => accepted ? 'accepted_processing' : 'current_status',
      },
  'processedCount': processedCount,
  'phaseProcessedCount': 1,
  'createdAtMs': 1786406400000,
  'updatedAtMs': updatedAtMs,
};

RatingDestructiveOperationSummary summary({
  String operationId = _operationId,
  String operation = 'dishMerge',
  String status = 'active',
  String progressCategory = 'moving_data',
  bool accepted = true,
  bool processing = true,
  bool complete = false,
  bool retryable = false,
  bool manualReviewRequired = false,
  int processedCount = 2,
  int updatedAtMs = 1786406401000,
}) => RatingDestructiveOperationSummary.fromJson(
  summaryJson(
    operationId: operationId,
    operation: operation,
    status: status,
    progressCategory: progressCategory,
    accepted: accepted,
    processing: processing,
    complete: complete,
    retryable: retryable,
    manualReviewRequired: manualReviewRequired,
    processedCount: processedCount,
    updatedAtMs: updatedAtMs,
  ),
);

Widget host(Widget child, {double width = 390, double height = 560}) {
  return MaterialApp(
    home: Scaffold(
      body: SizedBox(width: width, height: height, child: child),
    ),
  );
}

void main() {
  testWidgets('does not poll and refreshes only after the manual action', (
    tester,
  ) async {
    var calls = 0;
    final service = RatingDestructiveOperationsService(
      functionsBoundary: (name, request) async {
        calls += 1;
        return summaryJson(accepted: false);
      },
    );

    await tester.pumpWidget(
      host(
        RatingDestructiveOperationStatusDialog(
          service: service,
          initialSummary: summary(),
        ),
      ),
    );
    await tester.pump(const Duration(minutes: 5));
    expect(calls, 0, reason: 'The status dialog must never poll.');

    tester
        .widget<FilledButton>(
          find.byKey(const ValueKey<String>('rating-operation-manual-refresh')),
        )
        .onPressed!();
    await tester.pump();

    expect(calls, 1);
    expect(find.text('Processed: 2'), findsOneWidget);
  });

  testWidgets(
    'suppresses duplicate manual refresh and notifies once on finish',
    (tester) async {
      final response = Completer<Object?>();
      var calls = 0;
      var completions = 0;
      final service = RatingDestructiveOperationsService(
        functionsBoundary: (name, request) {
          calls += 1;
          return response.future;
        },
      );

      await tester.pumpWidget(
        host(
          RatingDestructiveOperationStatusDialog(
            service: service,
            initialSummary: summary(),
            onComplete: () async => completions += 1,
          ),
        ),
      );
      final refresh = find.byKey(
        const ValueKey<String>('rating-operation-manual-refresh'),
      );
      final refreshButton = tester.widget<FilledButton>(refresh);
      refreshButton.onPressed!();
      refreshButton.onPressed!();
      await tester.pump();
      expect(calls, 1);
      expect(find.byType(LinearProgressIndicator), findsOneWidget);

      response.complete(
        summaryJson(
          accepted: false,
          status: 'complete',
          progressCategory: 'complete',
          processing: false,
          complete: true,
          messageCategory: 'current_status',
          processedCount: 10,
          updatedAtMs: 1786406402000,
        ),
      );
      await tester.pumpAndSettle();

      expect(completions, 1);
      expect(find.text('This operation is complete.'), findsOneWidget);
      expect(find.text('Processed: 10'), findsOneWidget);
      expect(refresh, findsNothing);
    },
  );

  testWidgets(
    'rejects a mismatched refreshed identity without replacing state',
    (tester) async {
      final service = RatingDestructiveOperationsService(
        functionsBoundary: (name, request) async =>
            summaryJson(operationId: _differentOperationId, accepted: false),
      );

      await tester.pumpWidget(
        host(
          RatingDestructiveOperationStatusDialog(
            service: service,
            initialSummary: summary(),
          ),
        ),
      );
      tester
          .widget<FilledButton>(
            find.byKey(
              const ValueKey<String>('rating-operation-manual-refresh'),
            ),
          )
          .onPressed!();
      await tester.pumpAndSettle();

      expect(
        find.text('BiteStar returned an invalid operation status.'),
        findsOneWidget,
      );
      expect(find.text('Operation ID: $_operationId'), findsOneWidget);
    },
  );

  testWidgets(
    'completed initial status neither refreshes nor calls completion',
    (tester) async {
      var calls = 0;
      var completions = 0;
      final service = RatingDestructiveOperationsService(
        functionsBoundary: (name, request) async {
          calls += 1;
          return summaryJson(accepted: false);
        },
      );

      await tester.pumpWidget(
        host(
          RatingDestructiveOperationStatusDialog(
            service: service,
            initialSummary: summary(
              status: 'complete',
              progressCategory: 'complete',
              processing: false,
              complete: true,
            ),
            onComplete: () async => completions += 1,
          ),
        ),
      );
      await tester.pump(const Duration(minutes: 5));

      expect(find.text('This operation is complete.'), findsOneWidget);
      expect(find.text('Refresh'), findsNothing);
      expect(calls, 0);
      expect(completions, 0);
    },
  );

  testWidgets('feedback exposes View Status and opens the reusable dialog', (
    tester,
  ) async {
    late BuildContext actionContext;
    var calls = 0;
    final service = RatingDestructiveOperationsService(
      functionsBoundary: (name, request) async {
        calls += 1;
        return summaryJson(accepted: false);
      },
    );

    await tester.pumpWidget(
      host(
        Builder(
          builder: (context) {
            actionContext = context;
            return const SizedBox.shrink();
          },
        ),
      ),
    );
    showRatingDestructiveOperationFeedback(
      actionContext,
      service: service,
      summary: summary(),
    );
    await tester.pump();
    expect(find.text('View Status'), findsOneWidget);

    tester.widget<SnackBarAction>(find.byType(SnackBarAction)).onPressed();
    await tester.pumpAndSettle();
    expect(find.text('Dish merge'), findsOneWidget);
    expect(find.text('Operation ID: $_operationId'), findsOneWidget);
    expect(calls, 0, reason: 'Opening status must not implicitly refresh.');
  });
}
