import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../models/admin_restaurant_mailing_batch.dart';
import '../models/admin_restaurant_mailing_pdf.dart';
import '../models/admin_restaurant_qr_batch.dart';
import '../services/admin_restaurant_mailing_batch_service.dart';
import '../services/admin_restaurant_qr_batch_service.dart';
import '../services/restaurant_mailing_label_pdf_export.dart';
import '../services/restaurant_mailing_label_pdf_service.dart';
import '../services/restaurant_qr_pdf_export.dart';
import '../services/restaurant_qr_pdf_service.dart';

typedef AdminRestaurantQrPrepareOperation =
    Future<AdminRestaurantQrPreparationRunResult> Function(
      List<String> catalogRestaurantIds,
      AdminRestaurantQrPreparationProgressCallback onProgress,
    );
typedef AdminRestaurantQrRetryPreparationOperation =
    Future<AdminRestaurantQrPreparationRunResult> Function(
      AdminRestaurantQrPreparationRunResult previousAttempt,
      AdminRestaurantQrPreparationProgressCallback onProgress,
    );
typedef AdminRestaurantQrPdfPreflightOperation =
    Future<RestaurantQrPdfPreflightResult> Function(
      AdminRestaurantQrArtifactManifest manifest,
    );
typedef AdminRestaurantQrPdfBuildOperation =
    Future<RestaurantQrPdfArtifact> Function(
      RestaurantQrPdfPreflightResult preflight,
    );
typedef AdminRestaurantQrPdfDownloadOperation =
    Future<RestaurantQrPdfExportResult> Function(
      Uint8List bytes,
      String filename,
    );
typedef AdminRestaurantQrMarkOperation =
    Future<AdminRestaurantQrMarkingRunResult> Function(
      AdminRestaurantQrMarkingWorklist worklist,
      AdminRestaurantQrMarkingProgressCallback onProgress,
    );
typedef AdminRestaurantQrBatchReconciledCallback =
    void Function(AdminRestaurantQrBatchReconciliation reconciliation);
typedef AdminRestaurantMailingPrepareOperation =
    Future<AdminRestaurantMailingBatchRunResult> Function(
      List<String> catalogRestaurantIds,
      AdminRestaurantMailingProgressCallback onProgress,
    );
typedef AdminRestaurantMailingRetryOperation =
    Future<AdminRestaurantMailingBatchRunResult> Function(
      AdminRestaurantMailingBatchRunResult previousAttempt,
      AdminRestaurantMailingProgressCallback onProgress,
    );
typedef AdminRestaurantMailingPdfPreflightOperation =
    Future<AdminRestaurantMailingPdfPreflightResult> Function(
      AdminRestaurantMailingManifest manifest,
      List<AdminRestaurantMailingPdfProblem> existingProblems,
    );
typedef AdminRestaurantMailingPdfBuildOperation =
    Future<AdminRestaurantMailingPdfArtifact> Function(
      AdminRestaurantMailingPdfPreflightResult preflight,
      bool approveValidOnly,
    );
typedef AdminRestaurantMailingPdfDownloadOperation =
    Future<RestaurantMailingLabelPdfExportResult> Function(
      Uint8List bytes,
      String filename,
    );

/// Injectable workflow boundaries. The dialog owns orchestration and keeps the
/// manifest/PDF immutable; these callbacks make each external operation easy
/// to fake without weakening that ownership.
@immutable
class AdminRestaurantQrBatchDialogDependencies {
  const AdminRestaurantQrBatchDialogDependencies({
    required this.prepare,
    required this.retryPreparation,
    required this.preflight,
    required this.buildPdf,
    required this.downloadPdf,
    required this.markPrepared,
    this.prepareMailing,
    this.retryMailing,
    this.preflightMailing,
    this.buildMailingPdf,
    this.downloadMailingPdf,
  }) : assert(
         (prepareMailing == null &&
                 retryMailing == null &&
                 preflightMailing == null &&
                 buildMailingPdf == null &&
                 downloadMailingPdf == null) ||
             (prepareMailing != null &&
                 retryMailing != null &&
                 preflightMailing != null &&
                 buildMailingPdf != null &&
                 downloadMailingPdf != null),
         'Mailing workflow dependencies must be supplied together.',
       );

  factory AdminRestaurantQrBatchDialogDependencies.fromServices({
    AdminRestaurantQrBatchService? batchService,
    RestaurantQrPdfService? pdfService,
    RestaurantQrPdfExporter? pdfExporter,
    AdminRestaurantMailingBatchService? mailingBatchService,
    RestaurantMailingLabelPdfService? mailingPdfService,
    RestaurantMailingLabelPdfExporter? mailingPdfExporter,
  }) {
    final resolvedBatchService =
        batchService ?? AdminRestaurantQrBatchService();
    final resolvedPdfService = pdfService ?? const RestaurantQrPdfService();
    final resolvedPdfExporter = pdfExporter ?? RestaurantQrPdfExporter();
    final resolvedMailingBatchService =
        mailingBatchService ?? AdminRestaurantMailingBatchService();
    final resolvedMailingPdfService =
        mailingPdfService ?? const RestaurantMailingLabelPdfService();
    final resolvedMailingPdfExporter =
        mailingPdfExporter ?? RestaurantMailingLabelPdfExporter();
    return AdminRestaurantQrBatchDialogDependencies(
      prepare: (catalogRestaurantIds, onProgress) => resolvedBatchService
          .prepareRestaurants(catalogRestaurantIds, onProgress: onProgress),
      retryPreparation: (previousAttempt, onProgress) {
        final alreadyConfirmed =
            previousAttempt.requestedCatalogRestaurantIds.length -
            previousAttempt.retryCatalogRestaurantIds.length;
        return resolvedBatchService.retryPreparation(
          previousAttempt,
          onProgress: (progress) => onProgress(
            AdminRestaurantQrPreparationProgress(
              confirmedRestaurantCount:
                  alreadyConfirmed + progress.confirmedRestaurantCount,
              totalRestaurantCount:
                  previousAttempt.requestedCatalogRestaurantIds.length,
            ),
          ),
        );
      },
      preflight: resolvedPdfService.preflight,
      buildPdf: resolvedPdfService.build,
      downloadPdf: resolvedPdfExporter.downloadPdf,
      markPrepared: (worklist, onProgress) =>
          resolvedBatchService.markPrepared(worklist, onProgress: onProgress),
      prepareMailing: (catalogRestaurantIds, onProgress) =>
          resolvedMailingBatchService.prepareRestaurants(
            catalogRestaurantIds,
            onProgress: onProgress,
          ),
      retryMailing: (previousAttempt, onProgress) {
        final alreadyConfirmed = previousAttempt.confirmedResults.length;
        return resolvedMailingBatchService.retryUnconfirmed(
          previousAttempt,
          onProgress: (progress) => onProgress(
            AdminRestaurantMailingProgress(
              confirmedRestaurantCount:
                  alreadyConfirmed + progress.confirmedRestaurantCount,
              totalRestaurantCount:
                  previousAttempt.requestedCatalogRestaurantIds.length,
            ),
          ),
        );
      },
      preflightMailing: (manifest, existingProblems) =>
          resolvedMailingPdfService.preflight(
            manifest,
            existingProblems: existingProblems,
          ),
      buildMailingPdf: (preflight, approveValidOnly) =>
          resolvedMailingPdfService.build(
            preflight,
            approveValidOnly: approveValidOnly,
          ),
      downloadMailingPdf: resolvedMailingPdfExporter.downloadPdf,
    );
  }

  final AdminRestaurantQrPrepareOperation prepare;
  final AdminRestaurantQrRetryPreparationOperation retryPreparation;
  final AdminRestaurantQrPdfPreflightOperation preflight;
  final AdminRestaurantQrPdfBuildOperation buildPdf;
  final AdminRestaurantQrPdfDownloadOperation downloadPdf;
  final AdminRestaurantQrMarkOperation markPrepared;
  final AdminRestaurantMailingPrepareOperation? prepareMailing;
  final AdminRestaurantMailingRetryOperation? retryMailing;
  final AdminRestaurantMailingPdfPreflightOperation? preflightMailing;
  final AdminRestaurantMailingPdfBuildOperation? buildMailingPdf;
  final AdminRestaurantMailingPdfDownloadOperation? downloadMailingPdf;

  bool get hasMailingWorkflow =>
      prepareMailing != null &&
      retryMailing != null &&
      preflightMailing != null &&
      buildMailingPdf != null &&
      downloadMailingPdf != null;
}

/// A safe, token-free projection emitted only after a complete marking
/// worklist attempt has returned (including a complete retry attempt).
@immutable
class AdminRestaurantQrBatchReconciliation {
  AdminRestaurantQrBatchReconciliation({
    required Map<String, AdminRestaurantQrPreparationProjection>
    preparationProjections,
    required Set<String> resolvedCatalogRestaurantIds,
    required Set<String> unresolvedCatalogRestaurantIds,
    required Set<String> problemCatalogRestaurantIds,
  }) : preparationProjections = Map.unmodifiable(preparationProjections),
       resolvedCatalogRestaurantIds = Set.unmodifiable(
         resolvedCatalogRestaurantIds,
       ),
       unresolvedCatalogRestaurantIds = Set.unmodifiable(
         unresolvedCatalogRestaurantIds,
       ),
       problemCatalogRestaurantIds = Set.unmodifiable(
         problemCatalogRestaurantIds,
       );

  final Map<String, AdminRestaurantQrPreparationProjection>
  preparationProjections;
  final Set<String> resolvedCatalogRestaurantIds;
  final Set<String> unresolvedCatalogRestaurantIds;
  final Set<String> problemCatalogRestaurantIds;
}

Future<void> showAdminRestaurantQrBatchDialog({
  required BuildContext context,
  required Iterable<String> frozenCatalogRestaurantIds,
  AdminRestaurantQrBatchDialogDependencies? dependencies,
  AdminRestaurantQrBatchReconciledCallback? onReconciled,
}) {
  final frozenIds = List<String>.unmodifiable(frozenCatalogRestaurantIds);
  return showDialog<void>(
    context: context,
    barrierDismissible: false,
    builder: (_) => AdminRestaurantQrBatchDialog(
      frozenCatalogRestaurantIds: frozenIds,
      dependencies:
          dependencies ??
          AdminRestaurantQrBatchDialogDependencies.fromServices(),
      onReconciled: onReconciled,
    ),
  );
}

class AdminRestaurantQrBatchDialog extends StatefulWidget {
  const AdminRestaurantQrBatchDialog({
    super.key,
    required this.frozenCatalogRestaurantIds,
    required this.dependencies,
    this.onReconciled,
  });

  final List<String> frozenCatalogRestaurantIds;
  final AdminRestaurantQrBatchDialogDependencies dependencies;
  final AdminRestaurantQrBatchReconciledCallback? onReconciled;

  @override
  State<AdminRestaurantQrBatchDialog> createState() =>
      _AdminRestaurantQrBatchDialogState();
}

enum _BatchDialogStage {
  preparing,
  preparationFailed,
  checkingFit,
  checkingFitFailed,
  reviewingProblems,
  building,
  buildFailed,
  ready,
  downloading,
  marking,
  statusIncomplete,
  completed,
}

enum _MailingDialogStage {
  preparing,
  preparationInterrupted,
  awaitingQrApproval,
  checkingFit,
  checkingFitFailed,
  reviewingProblems,
  building,
  buildFailed,
  ready,
  downloading,
  downloadFailed,
  noValidLabels,
}

typedef _MarkingLabelIdentity = ({
  String catalogRestaurantId,
  AdminRestaurantQrLabelType type,
  String? invitationId,
});

class _AdminRestaurantQrBatchDialogState
    extends State<AdminRestaurantQrBatchDialog> {
  late final List<String> _frozenCatalogRestaurantIds;
  _BatchDialogStage _stage = _BatchDialogStage.preparing;
  int _preparedRestaurantCount = 0;
  int _markProcessedRestaurantCount = 0;
  int _markTotalRestaurantCount = 0;
  int _markProcessedLabelCount = 0;
  int _markTotalLabelCount = 0;
  bool _operationLocked = false;
  bool _mailingOperationLocked = false;
  bool _closeRequestActive = false;
  String? _errorMessage;
  String? _downloadMessage;
  AdminRestaurantQrPreparationRunResult? _preparation;
  RestaurantQrPdfPreflightResult? _preflight;
  RestaurantQrPdfArtifact? _artifact;
  AdminRestaurantQrMarkingWorklist? _unresolvedWorklist;
  final Map<_MarkingLabelIdentity, AdminRestaurantQrMarkingLabelResult>
  _latestMarkingResults = {};
  final Map<String, AdminRestaurantQrPreparationProjection> _projections = {};
  _MailingDialogStage _mailingStage = _MailingDialogStage.preparing;
  int _mailingPreparedRestaurantCount = 0;
  String? _mailingErrorMessage;
  String? _mailingDownloadMessage;
  AdminRestaurantMailingBatchRunResult? _mailingPreparation;
  AdminRestaurantMailingPdfPreflightResult? _mailingPreflight;
  AdminRestaurantMailingPdfArtifact? _mailingArtifact;
  bool _mailingValidOnlyApproved = false;
  bool _qrValidSetApproved = false;

  @override
  void initState() {
    super.initState();
    _frozenCatalogRestaurantIds = List<String>.unmodifiable(
      widget.frozenCatalogRestaurantIds,
    );
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      unawaited(_prepare());
      if (widget.dependencies.hasMailingWorkflow) {
        unawaited(_prepareMailing());
      }
    });
  }

  @override
  void dispose() {
    _preparation = null;
    _preflight = null;
    _artifact = null;
    _unresolvedWorklist = null;
    _latestMarkingResults.clear();
    _projections.clear();
    _mailingPreparation = null;
    _mailingPreflight = null;
    _mailingArtifact = null;
    _mailingErrorMessage = null;
    _mailingDownloadMessage = null;
    super.dispose();
  }

  bool get _isBusy =>
      _operationLocked ||
      _stage == _BatchDialogStage.preparing ||
      _stage == _BatchDialogStage.checkingFit ||
      _stage == _BatchDialogStage.building ||
      _stage == _BatchDialogStage.downloading ||
      _stage == _BatchDialogStage.marking ||
      _mailingOperationLocked;

  List<AdminRestaurantQrProblemItem> get _preparationProblems =>
      _preparation?.problems ?? const <AdminRestaurantQrProblemItem>[];

  List<AdminRestaurantQrPdfProblem> get _pdfProblems =>
      _preflight?.problems ?? const <AdminRestaurantQrPdfProblem>[];

  List<AdminRestaurantMailingPdfProblem> get _mailingVisibleProblems {
    final preflight = _mailingPreflight;
    if (preflight != null) return preflight.problems;
    final preparation = _mailingPreparation;
    if (preparation == null) {
      return const <AdminRestaurantMailingPdfProblem>[];
    }
    return List<AdminRestaurantMailingPdfProblem>.unmodifiable(
      <AdminRestaurantMailingPdfProblem>[
        for (final problem in preparation.problems)
          AdminRestaurantMailingPdfProblem(
            catalogRestaurantId: problem.catalogRestaurantId,
            restaurantName: problem.restaurantName,
            code: AdminRestaurantMailingPdfProblemCode.authoritativeMailingData,
            message: problem.message,
          ),
        if (preparation.interruption case final interruption?)
          for (final id in interruption.catalogRestaurantIds)
            AdminRestaurantMailingPdfProblem(
              catalogRestaurantId: id,
              restaurantName: null,
              code: AdminRestaurantMailingPdfProblemCode.unconfirmedTransport,
              message: interruption.message,
            ),
      ],
    );
  }

  int get _problemCount => _preparationProblems.length + _pdfProblems.length;

  Set<String> get _problemCatalogRestaurantIds => <String>{
    ..._preparationProblems.map((problem) => problem.catalogRestaurantId),
    ..._pdfProblems.map((problem) => problem.catalogRestaurantId),
  };

  bool get _hasPreparationInterruption =>
      _preparation?.canRetryPreparation ?? false;

  bool get _hasUnresolvedStatus => _unresolvedWorklist?.isNotEmpty ?? false;

  Future<void> _prepare() async {
    if (_operationLocked) return;
    _operationLocked = true;
    if (mounted) {
      setState(() {
        _stage = _BatchDialogStage.preparing;
        _preparedRestaurantCount = 0;
        _errorMessage = null;
        _downloadMessage = null;
        _preparation = null;
        _preflight = null;
        _artifact = null;
        _unresolvedWorklist = null;
        _latestMarkingResults.clear();
        _projections.clear();
        _qrValidSetApproved = false;
        _resetMailingCorrelation();
      });
    }
    try {
      if (_frozenCatalogRestaurantIds.isEmpty) {
        throw const AdminRestaurantQrBatchServiceException(
          AdminRestaurantQrBatchFailureKind.invalidRequest,
          'Select at least one canonical restaurant.',
        );
      }
      final preparation = await widget.dependencies.prepare(
        _frozenCatalogRestaurantIds,
        _onPreparationProgress,
      );
      if (!mounted) return;
      _preparation = preparation;
      _preparedRestaurantCount = preparation.results.length;
      _operationLocked = false;
      await _checkLabelFit();
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _operationLocked = false;
        _stage = _BatchDialogStage.preparationFailed;
        _errorMessage =
            'Label preparation could not be confirmed. No PDF was created.';
      });
    }
  }

  Future<void> _retryPreparation() async {
    if (_operationLocked || !mounted) return;
    final previous = _preparation;
    if (previous == null || !previous.canRetryPreparation) {
      await _prepare();
      return;
    }
    _operationLocked = true;
    setState(() {
      _stage = _BatchDialogStage.preparing;
      _preparedRestaurantCount =
          previous.requestedCatalogRestaurantIds.length -
          previous.retryCatalogRestaurantIds.length;
      _errorMessage = null;
      _preflight = null;
      _artifact = null;
      _unresolvedWorklist = null;
      _latestMarkingResults.clear();
      _projections.clear();
      _qrValidSetApproved = false;
      _resetMailingCorrelation();
    });
    try {
      final preparation = await widget.dependencies.retryPreparation(
        previous,
        _onPreparationProgress,
      );
      if (!mounted) return;
      _preparation = preparation;
      _preparedRestaurantCount = preparation.results.length;
      _operationLocked = false;
      await _checkLabelFit();
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _operationLocked = false;
        _stage = _BatchDialogStage.reviewingProblems;
        _errorMessage =
            'The explicit preparation retry could not be confirmed.';
      });
    }
  }

  void _onPreparationProgress(AdminRestaurantQrPreparationProgress progress) {
    if (!mounted || _stage != _BatchDialogStage.preparing) return;
    setState(() {
      _preparedRestaurantCount = progress.confirmedRestaurantCount.clamp(
        0,
        _frozenCatalogRestaurantIds.length,
      );
    });
  }

  void _resetMailingCorrelation() {
    _mailingPreflight = null;
    _mailingArtifact = null;
    _mailingValidOnlyApproved = false;
    _mailingDownloadMessage = null;
    if (_mailingPreparation?.isFullyConfirmed == true) {
      _mailingStage = _MailingDialogStage.awaitingQrApproval;
    }
  }

  Future<void> _prepareMailing() async {
    if (_mailingOperationLocked || !mounted) return;
    final prepareMailing = widget.dependencies.prepareMailing;
    if (prepareMailing == null) return;
    _mailingOperationLocked = true;
    setState(() {
      _mailingStage = _MailingDialogStage.preparing;
      _mailingPreparedRestaurantCount = 0;
      _mailingErrorMessage = null;
      _mailingDownloadMessage = null;
      _mailingPreparation = null;
      _mailingPreflight = null;
      _mailingArtifact = null;
      _mailingValidOnlyApproved = false;
    });
    try {
      final preparation = await prepareMailing(
        _frozenCatalogRestaurantIds,
        _onMailingProgress,
      );
      if (!mounted) return;
      setState(() {
        _mailingOperationLocked = false;
        _mailingPreparation = preparation;
        _mailingPreparedRestaurantCount = preparation.confirmedResults.length;
        _mailingStage = preparation.canRetry
            ? _MailingDialogStage.preparationInterrupted
            : _MailingDialogStage.awaitingQrApproval;
      });
      if (preparation.isFullyConfirmed) {
        await _checkMailingFitWhenReady();
      }
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _mailingOperationLocked = false;
        _mailingStage = _MailingDialogStage.preparationInterrupted;
        _mailingErrorMessage =
            'Mailing addresses could not be confirmed. No mailing PDF was created.';
      });
    }
  }

  Future<void> _retryMailingPreparation() async {
    if (_mailingOperationLocked || !mounted) return;
    final previous = _mailingPreparation;
    final retryMailing = widget.dependencies.retryMailing;
    if (previous == null || !previous.canRetry || retryMailing == null) {
      await _prepareMailing();
      return;
    }
    _mailingOperationLocked = true;
    setState(() {
      _mailingStage = _MailingDialogStage.preparing;
      _mailingPreparedRestaurantCount = previous.confirmedResults.length;
      _mailingErrorMessage = null;
    });
    try {
      final preparation = await retryMailing(previous, _onMailingProgress);
      if (!mounted) return;
      setState(() {
        _mailingOperationLocked = false;
        _mailingPreparation = preparation;
        _mailingPreparedRestaurantCount = preparation.confirmedResults.length;
        _mailingStage = preparation.canRetry
            ? _MailingDialogStage.preparationInterrupted
            : _MailingDialogStage.awaitingQrApproval;
      });
      if (preparation.isFullyConfirmed) {
        await _checkMailingFitWhenReady();
      }
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _mailingOperationLocked = false;
        _mailingStage = _MailingDialogStage.preparationInterrupted;
        _mailingErrorMessage =
            'The explicit mailing-address retry could not be confirmed.';
      });
    }
  }

  void _onMailingProgress(AdminRestaurantMailingProgress progress) {
    if (!mounted || _mailingStage != _MailingDialogStage.preparing) return;
    setState(() {
      _mailingPreparedRestaurantCount = progress.confirmedRestaurantCount.clamp(
        0,
        _frozenCatalogRestaurantIds.length,
      );
    });
  }

  Future<void> _checkMailingFitWhenReady() async {
    if (_mailingOperationLocked || !mounted) return;
    final preparation = _mailingPreparation;
    final preflightMailing = widget.dependencies.preflightMailing;
    if (preparation == null ||
        !preparation.isFullyConfirmed ||
        preflightMailing == null) {
      return;
    }
    if (!_qrValidSetApproved) {
      setState(() {
        _mailingStage = _MailingDialogStage.awaitingQrApproval;
      });
      return;
    }

    final qrValidIds = <String>{
      ...?_preflight?.validManifest.restaurants.map(
        (restaurant) => restaurant.catalogRestaurantId,
      ),
    };
    final qrNamesById = <String, String>{
      for (final restaurant
          in _preparation?.readyRestaurants ??
              const <AdminRestaurantQrReadyRestaurant>[])
        restaurant.catalogRestaurantId: restaurant.restaurantName,
    };
    final mailingById = <String, AdminRestaurantMailingResult>{
      for (final result in preparation.confirmedResults)
        result.catalogRestaurantId: result,
    };
    final entries = <AdminRestaurantMailingManifestEntry>[];
    final problems = <AdminRestaurantMailingPdfProblem>[];
    for (final id in _frozenCatalogRestaurantIds) {
      final result = mailingById[id]!;
      final restaurantName = switch (result) {
        AdminRestaurantMailingReady() => result.restaurantName,
        AdminRestaurantMailingProblem() => result.restaurantName,
      };
      if (!qrValidIds.contains(id)) {
        problems.add(
          AdminRestaurantMailingPdfProblem(
            catalogRestaurantId: id,
            restaurantName: restaurantName ?? qrNamesById[id],
            code:
                AdminRestaurantMailingPdfProblemCode.excludedNoQrValidArtifact,
            message:
                'Excluded because no approved QR-valid artifact remains for this restaurant.',
          ),
        );
      } else if (result is AdminRestaurantMailingReady) {
        entries.add(AdminRestaurantMailingManifestEntry.fromReady(result));
      } else {
        problems.add(
          AdminRestaurantMailingPdfProblem(
            catalogRestaurantId: id,
            restaurantName: restaurantName,
            code: AdminRestaurantMailingPdfProblemCode.authoritativeMailingData,
            message: (result as AdminRestaurantMailingProblem).message,
          ),
        );
      }
    }

    if (entries.isEmpty) {
      setState(() {
        _mailingPreflight = AdminRestaurantMailingPdfPreflightResult(
          validLayouts: const <AdminRestaurantMailingLayoutEntry>[],
          problems: problems,
        );
        _mailingStage = _MailingDialogStage.noValidLabels;
        _mailingErrorMessage = null;
      });
      return;
    }

    setState(() {
      _mailingOperationLocked = true;
      _mailingStage = _MailingDialogStage.checkingFit;
      _mailingErrorMessage = null;
      _mailingPreflight = null;
      _mailingArtifact = null;
      _mailingValidOnlyApproved = false;
    });
    try {
      final preflight = await preflightMailing(
        AdminRestaurantMailingManifest(entries),
        problems,
      );
      if (!mounted) return;
      setState(() {
        _mailingOperationLocked = false;
        _mailingPreflight = preflight;
        _mailingStage = preflight.hasValidLabels
            ? preflight.hasProblems
                  ? _MailingDialogStage.reviewingProblems
                  : _MailingDialogStage.building
            : _MailingDialogStage.noValidLabels;
      });
      if (preflight.hasValidLabels && !preflight.hasProblems) {
        await _buildMailingPdf();
      }
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _mailingOperationLocked = false;
        _mailingStage = _MailingDialogStage.checkingFitFailed;
        _mailingErrorMessage =
            'Mailing-label fit could not be checked. No mailing PDF was created.';
      });
    }
  }

  Future<void> _approveValidMailingLabels() async {
    if (_mailingOperationLocked || !mounted) return;
    final preflight = _mailingPreflight;
    if (preflight == null || !preflight.hasValidLabels) return;
    _mailingValidOnlyApproved = true;
    await _buildMailingPdf();
  }

  Future<void> _buildMailingPdf() async {
    if (_mailingOperationLocked || _mailingArtifact != null || !mounted) {
      return;
    }
    final preflight = _mailingPreflight;
    final buildMailingPdf = widget.dependencies.buildMailingPdf;
    if (preflight == null ||
        !preflight.hasValidLabels ||
        buildMailingPdf == null) {
      return;
    }
    setState(() {
      _mailingOperationLocked = true;
      _mailingStage = _MailingDialogStage.building;
      _mailingErrorMessage = null;
    });
    try {
      final artifact = await buildMailingPdf(
        preflight,
        _mailingValidOnlyApproved,
      );
      if (!mounted) return;
      setState(() {
        _mailingArtifact = artifact;
        _mailingOperationLocked = false;
        _mailingStage = _MailingDialogStage.ready;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _mailingOperationLocked = false;
        _mailingStage = _MailingDialogStage.buildFailed;
        _mailingErrorMessage =
            'The mailing-label PDF could not be built. Try again.';
      });
    }
  }

  Future<void> _downloadMailingPdf() async {
    if (_mailingOperationLocked || !mounted) return;
    final artifact = _mailingArtifact;
    final downloadMailingPdf = widget.dependencies.downloadMailingPdf;
    if (artifact == null || downloadMailingPdf == null) return;
    setState(() {
      _mailingOperationLocked = true;
      _mailingStage = _MailingDialogStage.downloading;
      _mailingErrorMessage = null;
      _mailingDownloadMessage = null;
    });
    RestaurantMailingLabelPdfExportResult result;
    try {
      result = await downloadMailingPdf(
        artifact.bytes,
        artifact.summary.filename,
      );
    } catch (_) {
      result = const RestaurantMailingLabelPdfExportResult.failed(
        failure: RestaurantMailingLabelPdfExportFailure.initiationFailed,
        message: 'Could not initiate the mailing-label PDF download.',
      );
    }
    if (!mounted) return;
    setState(() {
      _mailingOperationLocked = false;
      if (result.initiated) {
        _mailingStage = _MailingDialogStage.ready;
        _mailingDownloadMessage = result.message;
      } else {
        _mailingStage = _MailingDialogStage.downloadFailed;
        _mailingErrorMessage = result.message;
      }
    });
  }

  Future<void> _checkLabelFit() async {
    if (_operationLocked || !mounted) return;
    final preparation = _preparation;
    if (preparation == null) return;
    final manifest = preparation.toArtifactManifest();
    if (manifest.isEmpty) {
      setState(() {
        _stage = _BatchDialogStage.reviewingProblems;
        _errorMessage = null;
        _qrValidSetApproved = true;
      });
      await _checkMailingFitWhenReady();
      return;
    }
    setState(() {
      _operationLocked = true;
      _stage = _BatchDialogStage.checkingFit;
      _errorMessage = null;
    });
    try {
      final preflight = await widget.dependencies.preflight(manifest);
      if (!mounted) return;
      setState(() {
        _operationLocked = false;
        _preflight = preflight;
        _qrValidSetApproved = _problemCount == 0 || !preflight.hasValidLabels;
        _stage = _problemCount > 0
            ? _BatchDialogStage.reviewingProblems
            : _BatchDialogStage.building;
      });
      if (_qrValidSetApproved) {
        unawaited(_checkMailingFitWhenReady());
      }
      if (_problemCount == 0) {
        await _buildPdf();
      }
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _operationLocked = false;
        _stage = _BatchDialogStage.checkingFitFailed;
        _errorMessage = 'Label fit could not be checked. No PDF was created.';
      });
    }
  }

  Future<void> _approveValidLabels() async {
    if (_operationLocked || _stage != _BatchDialogStage.reviewingProblems) {
      return;
    }
    final preflight = _preflight;
    if (preflight == null || !preflight.hasValidLabels) return;
    setState(() {
      _qrValidSetApproved = true;
    });
    unawaited(_checkMailingFitWhenReady());
    await _buildPdf();
  }

  Future<void> _buildPdf() async {
    if (_operationLocked || _artifact != null || !mounted) return;
    final preflight = _preflight;
    if (preflight == null || !preflight.hasValidLabels) return;
    setState(() {
      _operationLocked = true;
      _stage = _BatchDialogStage.building;
      _errorMessage = null;
    });
    try {
      final artifact = await widget.dependencies.buildPdf(preflight);
      if (!mounted) return;
      if (artifact.summary.includedManifest.isEmpty) {
        throw StateError('The PDF artifact cannot be empty.');
      }
      setState(() {
        _artifact = artifact;
        _operationLocked = false;
        _stage = _BatchDialogStage.ready;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _operationLocked = false;
        _stage = _BatchDialogStage.buildFailed;
        _errorMessage = 'The QR label PDF could not be built. Try again.';
      });
    }
  }

  Future<void> _downloadPdf() async {
    if (_operationLocked || !mounted) return;
    final artifact = _artifact;
    if (artifact == null) return;
    setState(() {
      _operationLocked = true;
      _stage = _BatchDialogStage.downloading;
      _errorMessage = null;
      _downloadMessage = null;
    });
    RestaurantQrPdfExportResult exportResult;
    try {
      exportResult = await widget.dependencies.downloadPdf(
        artifact.bytes,
        artifact.summary.filename,
      );
    } catch (_) {
      exportResult = const RestaurantQrPdfExportResult.failed(
        failure: RestaurantQrPdfExportFailure.initiationFailed,
        message: 'Could not initiate the PDF download.',
      );
    }
    if (!mounted) return;
    if (!exportResult.initiated) {
      setState(() {
        _operationLocked = false;
        _stage = _BatchDialogStage.ready;
        _errorMessage = exportResult.message;
      });
      return;
    }
    setState(() {
      _downloadMessage = 'PDF download initiated.';
      _operationLocked = false;
    });

    final unresolved = _unresolvedWorklist;
    final worklist = unresolved != null && unresolved.isNotEmpty
        ? unresolved
        : AdminRestaurantQrMarkingWorklist.fromManifest(
            artifact.summary.includedManifest,
          );
    await _mark(worklist);
  }

  Future<void> _retrySavingStatus() async {
    if (_operationLocked) return;
    final unresolved = _unresolvedWorklist;
    if (unresolved == null || unresolved.isEmpty) return;
    await _mark(unresolved);
  }

  Future<void> _mark(AdminRestaurantQrMarkingWorklist worklist) async {
    if (_operationLocked || !mounted) return;
    setState(() {
      _operationLocked = true;
      _stage = _BatchDialogStage.marking;
      _errorMessage = null;
      _markProcessedRestaurantCount = 0;
      _markTotalRestaurantCount = worklist.restaurantCount;
      _markProcessedLabelCount = 0;
      _markTotalLabelCount = worklist.labelCount;
    });
    try {
      final attempt = await widget.dependencies.markPrepared(
        worklist,
        _onMarkingProgress,
      );
      if (!mounted) return;
      _recordMarkingAttempt(attempt);
      _unresolvedWorklist = attempt.unresolvedWorklist;
      _projections.addAll(attempt.preparationProjections);
      _operationLocked = false;
      _emitReconciliation();
      setState(() {
        _stage = _hasUnresolvedStatus
            ? _BatchDialogStage.statusIncomplete
            : _BatchDialogStage.completed;
      });
    } catch (_) {
      if (!mounted) return;
      _unresolvedWorklist = worklist;
      _recordUnresolvedWorklist(worklist);
      _operationLocked = false;
      _emitReconciliation();
      setState(() {
        _stage = _BatchDialogStage.statusIncomplete;
        _errorMessage =
            'Preparation status could not be confirmed. Retry saving status.';
      });
    }
  }

  void _recordMarkingAttempt(AdminRestaurantQrMarkingRunResult attempt) {
    for (final restaurant in attempt.results) {
      for (final label in restaurant.labels) {
        _latestMarkingResults[(
              catalogRestaurantId: restaurant.catalogRestaurantId,
              type: label.type,
              invitationId: label.invitationId,
            )] =
            label;
      }
    }
  }

  void _recordUnresolvedWorklist(AdminRestaurantQrMarkingWorklist worklist) {
    for (final restaurant in worklist.restaurants) {
      for (final label in restaurant.labels) {
        final result = AdminRestaurantQrMarkingLabelResult.unresolved(
          request: label,
          code: 'marking_unavailable',
          message: 'Preparation status could not be confirmed.',
        );
        _latestMarkingResults[(
              catalogRestaurantId: restaurant.catalogRestaurantId,
              type: label.type,
              invitationId: label.invitationId,
            )] =
            result;
      }
    }
  }

  void _onMarkingProgress(AdminRestaurantQrMarkingProgress progress) {
    if (!mounted || _stage != _BatchDialogStage.marking) return;
    setState(() {
      _markProcessedRestaurantCount = progress.processedRestaurantCount;
      _markTotalRestaurantCount = progress.totalRestaurantCount;
      _markProcessedLabelCount = progress.processedLabelCount;
      _markTotalLabelCount = progress.totalLabelCount;
    });
  }

  void _emitReconciliation() {
    final artifact = _artifact;
    if (artifact == null) return;
    final unresolvedIds = <String>{
      ...?_unresolvedWorklist?.restaurants.map(
        (restaurant) => restaurant.catalogRestaurantId,
      ),
    };
    final problemIds = _problemCatalogRestaurantIds;
    final resolvedIds = artifact.summary.includedManifest.restaurants
        .map((restaurant) => restaurant.catalogRestaurantId)
        .where((id) => !unresolvedIds.contains(id) && !problemIds.contains(id))
        .toSet();
    try {
      widget.onReconciled?.call(
        AdminRestaurantQrBatchReconciliation(
          preparationProjections: _projections,
          resolvedCatalogRestaurantIds: resolvedIds,
          unresolvedCatalogRestaurantIds: unresolvedIds,
          problemCatalogRestaurantIds: problemIds,
        ),
      );
    } catch (_) {
      // Reconciliation updates local screen projections only. A caller-side
      // exception must never turn a completed server marking attempt back into
      // an unresolved status result.
    }
  }

  Future<void> _requestClose() async {
    if (_isBusy || _closeRequestActive || !mounted) return;
    _closeRequestActive = true;
    var batchPopRequested = false;
    try {
      if (_hasUnresolvedStatus) {
        final shouldClose = await _showUnresolvedCloseDecision();
        if (!mounted) return;
        if (!shouldClose) return;
      }
      Navigator.of(context).pop();
      batchPopRequested = true;
    } catch (_) {
      // A navigation failure leaves the batch open and eligible for a later
      // explicit close request.
    } finally {
      if (mounted && !batchPopRequested) {
        _closeRequestActive = false;
      }
    }
  }

  Future<bool> _showUnresolvedCloseDecision() async {
    var decisionSubmitted = false;

    void submitDecision(BuildContext dialogContext, bool shouldClose) {
      if (decisionSubmitted || !dialogContext.mounted) return;
      decisionSubmitted = true;
      Navigator.of(dialogContext).pop(shouldClose);
    }

    try {
      final result = await showDialog<bool>(
        context: context,
        barrierDismissible: false,
        builder: (dialogContext) => PopScope<bool>(
          canPop: false,
          onPopInvokedWithResult: (didPop, _) {
            if (!didPop) submitDecision(dialogContext, false);
          },
          child: AlertDialog(
            key: const ValueKey('admin-qr-batch-close-warning'),
            title: const Text('Close without retrying?'),
            content: const Text(
              'Some preparation checkmarks are still unresolved. They will '
              'not be retried automatically if you close.',
            ),
            actions: [
              TextButton(
                key: const ValueKey('admin-qr-batch-keep-working'),
                onPressed: () => submitDecision(dialogContext, false),
                child: const Text('Keep working'),
              ),
              FilledButton(
                key: const ValueKey('admin-qr-batch-close-anyway'),
                onPressed: () => submitDecision(dialogContext, true),
                child: const Text('Close anyway'),
              ),
            ],
          ),
        ),
      );
      return result == true;
    } finally {
      // Also invalidates callbacks retained from a route removed externally.
      decisionSubmitted = true;
    }
  }

  @override
  Widget build(BuildContext context) {
    return PopScope<void>(
      canPop: !_isBusy && !_hasUnresolvedStatus,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop && !_isBusy) unawaited(_requestClose());
      },
      child: AlertDialog(
        key: const ValueKey('admin-qr-batch-dialog'),
        insetPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
        title: const Text('Generate QR & Mailing Label PDFs'),
        content: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 680),
          child: SingleChildScrollView(
            child: Semantics(
              container: true,
              liveRegion: true,
              child: _buildContent(context),
            ),
          ),
        ),
        actions: _buildActions(),
      ),
    );
  }

  Widget _buildContent(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text(
          'Create QR label sheets and mailing-address label sheets from the same frozen restaurant selection.',
        ),
        const SizedBox(height: 16),
        Text('QR Labels', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 4),
        Text(_stageMessage, key: const ValueKey('admin-qr-batch-stage')),
        if (_operationLocked) ...[
          const SizedBox(height: 12),
          const LinearProgressIndicator(
            key: ValueKey('admin-qr-batch-progress'),
          ),
        ],
        if (_stage == _BatchDialogStage.reviewingProblems)
          ..._buildProblemReview(context),
        if (_artifact != null) ..._buildArtifactSummary(context),
        if (_downloadMessage != null) ...[
          const SizedBox(height: 12),
          Text(
            _downloadMessage!,
            key: const ValueKey('admin-qr-batch-download-status'),
          ),
        ],
        if (_latestMarkingResults.isNotEmpty) ..._buildMarkingSummary(),
        if (_hasUnresolvedStatus) ..._buildUnresolvedStatusList(context),
        if (_errorMessage != null) ...[
          const SizedBox(height: 12),
          Text(
            _errorMessage!,
            key: const ValueKey('admin-qr-batch-error'),
            style: TextStyle(
              color: Theme.of(context).colorScheme.error,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
        if (_stage == _BatchDialogStage.preparationFailed ||
            _hasPreparationInterruption) ...[
          const SizedBox(height: 12),
          const Text(
            'Retry preparation is explicit because it may create new valid '
            'invitations if an earlier response was interrupted.',
            key: ValueKey('admin-qr-batch-preparation-retry-warning'),
          ),
        ],
        if (widget.dependencies.hasMailingWorkflow) ...[
          const SizedBox(height: 20),
          const Divider(),
          const SizedBox(height: 12),
          ..._buildMailingContent(context),
        ],
      ],
    );
  }

  List<Widget> _buildMailingContent(BuildContext context) {
    final problems = _mailingVisibleProblems;
    return <Widget>[
      Text('Mailing Labels', style: Theme.of(context).textTheme.titleMedium),
      const SizedBox(height: 4),
      Text(
        _mailingStageMessage,
        key: const ValueKey('admin-mailing-batch-stage'),
      ),
      if (_mailingOperationLocked) ...[
        const SizedBox(height: 12),
        const LinearProgressIndicator(
          key: ValueKey('admin-mailing-batch-progress'),
        ),
      ],
      if (problems.isNotEmpty) ...[
        const SizedBox(height: 12),
        Container(
          key: const ValueKey('admin-mailing-batch-problem-list'),
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.errorContainer,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final problem in problems)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Text(
                    '${problem.restaurantName ?? 'Restaurant'} '
                    '(${problem.catalogRestaurantId}) — ${problem.message}',
                    key: ValueKey(
                      'admin-mailing-batch-problem-'
                      '${problem.catalogRestaurantId}-'
                      '${problem.code.wireName}',
                    ),
                  ),
                ),
            ],
          ),
        ),
      ],
      if (_mailingPreparation?.canRetry == true) ...[
        const SizedBox(height: 12),
        Text(
          '${_mailingPreparation!.unconfirmedCatalogRestaurantIds.length} '
          '${_mailingPreparation!.unconfirmedCatalogRestaurantIds.length == 1 ? 'restaurant remains' : 'restaurants remain'} '
          'unconfirmed. Retry sends only that exact suffix.',
          key: const ValueKey('admin-mailing-batch-unconfirmed-suffix'),
        ),
      ],
      if (_mailingArtifact != null) ...[
        const SizedBox(height: 12),
        Container(
          key: const ValueKey('admin-mailing-batch-artifact-summary'),
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.secondaryContainer,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Included restaurants: '
                '${_mailingArtifact!.summary.restaurantCount}',
              ),
              Text(
                'Included mailing labels: '
                '${_mailingArtifact!.summary.labelCount}',
              ),
              Text('Mailing pages: ${_mailingArtifact!.summary.pageCount}'),
              Text('Mailing problems: ${problems.length}'),
              const SizedBox(height: 8),
              const Text(
                'Print at Actual Size / 100%',
                style: TextStyle(fontWeight: FontWeight.w700),
              ),
            ],
          ),
        ),
      ],
      if (_mailingDownloadMessage != null) ...[
        const SizedBox(height: 12),
        Text(
          _mailingDownloadMessage!,
          key: const ValueKey('admin-mailing-batch-download-status'),
        ),
      ],
      if (_mailingErrorMessage != null) ...[
        const SizedBox(height: 12),
        Text(
          _mailingErrorMessage!,
          key: const ValueKey('admin-mailing-batch-error'),
          style: TextStyle(
            color: Theme.of(context).colorScheme.error,
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
      if (_mailingStage == _MailingDialogStage.noValidLabels) ...[
        const SizedBox(height: 12),
        const Text(
          'No valid mailing labels are available, so no empty mailing PDF was created.',
          key: ValueKey('admin-mailing-batch-no-valid-labels'),
        ),
      ],
      const SizedBox(height: 12),
      Wrap(spacing: 8, runSpacing: 8, children: _buildMailingActions()),
    ];
  }

  String get _mailingStageMessage => switch (_mailingStage) {
    _MailingDialogStage.preparing =>
      _mailingPreparedRestaurantCount == 0
          ? 'Preparing mailing addresses…'
          : 'Prepared $_mailingPreparedRestaurantCount of '
                '${_frozenCatalogRestaurantIds.length} mailing addresses',
    _MailingDialogStage.preparationInterrupted =>
      'Mailing-address preparation interrupted',
    _MailingDialogStage.awaitingQrApproval =>
      'Waiting for the QR-valid restaurant set…',
    _MailingDialogStage.checkingFit => 'Checking mailing-label fit…',
    _MailingDialogStage.checkingFitFailed =>
      'Mailing-label fit check interrupted',
    _MailingDialogStage.reviewingProblems =>
      'Review mailing-label problems separately.',
    _MailingDialogStage.building => 'Building mailing-label PDF…',
    _MailingDialogStage.buildFailed => 'Mailing-label PDF build interrupted',
    _MailingDialogStage.ready => 'Mailing-label PDF ready',
    _MailingDialogStage.downloading => 'Downloading mailing-label PDF…',
    _MailingDialogStage.downloadFailed => 'Mailing-label download failed',
    _MailingDialogStage.noValidLabels =>
      'No valid mailing labels are available.',
  };

  List<Widget> _buildMailingActions() {
    final actions = <Widget>[];
    if (_mailingStage == _MailingDialogStage.preparationInterrupted) {
      actions.add(
        OutlinedButton.icon(
          key: const ValueKey('admin-mailing-batch-retry-preparation'),
          onPressed: _mailingOperationLocked ? null : _retryMailingPreparation,
          icon: const Icon(Icons.refresh),
          label: const Text('Retry mailing addresses'),
        ),
      );
    }
    if (_mailingStage == _MailingDialogStage.checkingFitFailed) {
      actions.add(
        OutlinedButton.icon(
          key: const ValueKey('admin-mailing-batch-retry-fit'),
          onPressed: _mailingOperationLocked ? null : _checkMailingFitWhenReady,
          icon: const Icon(Icons.refresh),
          label: const Text('Retry mailing-label fit'),
        ),
      );
    }
    if (_mailingStage == _MailingDialogStage.buildFailed) {
      actions.add(
        OutlinedButton.icon(
          key: const ValueKey('admin-mailing-batch-retry-build'),
          onPressed: _mailingOperationLocked ? null : _buildMailingPdf,
          icon: const Icon(Icons.refresh),
          label: const Text('Retry mailing PDF'),
        ),
      );
    }
    if (_mailingStage == _MailingDialogStage.reviewingProblems &&
        _mailingPreflight?.hasValidLabels == true) {
      actions.add(
        FilledButton(
          key: const ValueKey('admin-mailing-batch-export-valid'),
          onPressed: _mailingOperationLocked
              ? null
              : _approveValidMailingLabels,
          child: const Text('Export valid mailing labels only'),
        ),
      );
    }
    if (_mailingArtifact != null &&
        _mailingStage != _MailingDialogStage.downloading) {
      actions.add(
        FilledButton.icon(
          key: const ValueKey('admin-mailing-batch-download'),
          onPressed: _mailingOperationLocked ? null : _downloadMailingPdf,
          icon: const Icon(Icons.download),
          label: const Text('Download Mailing PDF'),
        ),
      );
    }
    return actions;
  }

  String get _stageMessage => switch (_stage) {
    _BatchDialogStage.preparing =>
      _preparedRestaurantCount == 0
          ? 'Preparing selected restaurants…'
          : 'Prepared $_preparedRestaurantCount of '
                '${_frozenCatalogRestaurantIds.length} restaurants',
    _BatchDialogStage.preparationFailed => 'Preparation interrupted',
    _BatchDialogStage.checkingFit => 'Checking label fit…',
    _BatchDialogStage.checkingFitFailed => 'Label fit check interrupted',
    _BatchDialogStage.reviewingProblems =>
      _problemCount == 0
          ? 'No valid labels are available to export.'
          : 'Review all $_problemCount label preparation '
                '${_problemCount == 1 ? 'problem' : 'problems'}.',
    _BatchDialogStage.building => 'Building PDF…',
    _BatchDialogStage.buildFailed => 'PDF build interrupted',
    _BatchDialogStage.ready => 'PDF ready',
    _BatchDialogStage.downloading => 'Downloading PDF…',
    _BatchDialogStage.marking =>
      'Saving preparation status… '
          '$_markProcessedRestaurantCount of $_markTotalRestaurantCount '
          'restaurants, $_markProcessedLabelCount of $_markTotalLabelCount labels',
    _BatchDialogStage.statusIncomplete => 'Status saving incomplete',
    _BatchDialogStage.completed => 'Completed',
  };

  List<Widget> _buildProblemReview(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return [
      const SizedBox(height: 12),
      Container(
        key: const ValueKey('admin-qr-batch-problem-list'),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: colorScheme.errorContainer,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (final problem in _preparationProblems)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(
                  '${problem.catalogRestaurantId} — ${problem.message}',
                  key: ValueKey(
                    'admin-qr-batch-preparation-problem-'
                    '${problem.catalogRestaurantId}',
                  ),
                ),
              ),
            for (final problem in _pdfProblems)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(
                  '${problem.restaurantName} '
                  '(${problem.catalogRestaurantId}) · '
                  '${problem.labelType.wireName} — ${problem.message}',
                  key: ValueKey(
                    'admin-qr-batch-pdf-problem-'
                    '${problem.catalogRestaurantId}-'
                    '${problem.labelType.wireName}',
                  ),
                ),
              ),
          ],
        ),
      ),
      if (_preflight?.hasValidLabels != true) ...[
        const SizedBox(height: 12),
        const Text(
          'Every label has a problem, so no empty PDF will be created.',
          key: ValueKey('admin-qr-batch-no-valid-labels'),
        ),
      ],
    ];
  }

  List<Widget> _buildArtifactSummary(BuildContext context) {
    final summary = _artifact!.summary;
    return [
      const SizedBox(height: 16),
      Container(
        key: const ValueKey('admin-qr-batch-artifact-summary'),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.secondaryContainer,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Selected restaurants: ${summary.selectedRestaurantCount}'),
            Text(
              'Ready restaurants: '
              '${_preparation?.readyRestaurants.length ?? 0}',
            ),
            Text('Included labels: ${summary.labelCount}'),
            Text('Pages: ${summary.pageCount}'),
            Text('Problems: $_problemCount'),
            const SizedBox(height: 8),
            const Text(
              'Print at Actual Size / 100%',
              key: ValueKey('admin-qr-batch-actual-size-reminder'),
              style: TextStyle(fontWeight: FontWeight.w700),
            ),
          ],
        ),
      ),
    ];
  }

  List<Widget> _buildMarkingSummary() {
    final results = _latestMarkingResults.values;
    final savedCount = results
        .where(
          (label) =>
              label.status == AdminRestaurantQrLabelMarkingStatus.saved &&
              label.alreadySaved == false,
        )
        .length;
    final alreadySavedCount = results
        .where(
          (label) =>
              label.status == AdminRestaurantQrLabelMarkingStatus.saved &&
              label.alreadySaved == true,
        )
        .length;
    final notRequiredCount = results
        .where(
          (label) =>
              label.status == AdminRestaurantQrLabelMarkingStatus.notRequired,
        )
        .length;
    final unresolvedCount = results.where((label) => label.isUnresolved).length;
    return [
      const SizedBox(height: 12),
      Text(
        'Status results: $savedCount saved, '
        '$alreadySavedCount already saved, '
        '$notRequiredCount not required, '
        '$unresolvedCount unresolved.',
        key: const ValueKey('admin-qr-batch-marking-summary'),
      ),
    ];
  }

  List<Widget> _buildUnresolvedStatusList(BuildContext context) {
    final unresolved = _unresolvedWorklist;
    if (unresolved == null || unresolved.isEmpty) return const <Widget>[];
    final namesById = <String, String>{
      for (final restaurant
          in _artifact?.summary.includedManifest.restaurants ??
              const <AdminRestaurantQrArtifactRestaurant>[])
        restaurant.catalogRestaurantId: restaurant.restaurantName,
    };
    return <Widget>[
      const SizedBox(height: 12),
      Container(
        key: const ValueKey('admin-qr-batch-unresolved-status-list'),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.errorContainer,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            const Text(
              'Unresolved preparation statuses',
              style: TextStyle(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            for (final restaurant in unresolved.restaurants)
              for (final label in restaurant.labels)
                Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Text(
                    '${namesById[restaurant.catalogRestaurantId] ?? 'Restaurant'} '
                    '(${restaurant.catalogRestaurantId}) · '
                    '${label.type.wireName} — '
                    '${_unresolvedMessage(restaurant.catalogRestaurantId, label.type)}',
                    key: ValueKey<String>(
                      'admin-qr-batch-unresolved-'
                      '${restaurant.catalogRestaurantId}-'
                      '${label.type.wireName}',
                    ),
                  ),
                ),
          ],
        ),
      ),
    ];
  }

  String _unresolvedMessage(
    String catalogRestaurantId,
    AdminRestaurantQrLabelType type,
  ) {
    for (final entry in _latestMarkingResults.entries) {
      if (entry.key.catalogRestaurantId == catalogRestaurantId &&
          entry.key.type == type &&
          entry.value.isUnresolved) {
        return entry.value.message ??
            'Preparation status could not be confirmed.';
      }
    }
    return _errorMessage ?? 'Preparation status could not be confirmed.';
  }

  List<Widget> _buildActions() {
    final actions = <Widget>[];
    if (_stage == _BatchDialogStage.reviewingProblems) {
      if (_hasPreparationInterruption) {
        actions.add(
          OutlinedButton.icon(
            key: const ValueKey('admin-qr-batch-retry-preparation'),
            onPressed: _operationLocked ? null : _retryPreparation,
            icon: const Icon(Icons.refresh),
            label: const Text('Retry preparation'),
          ),
        );
      }
      actions.add(
        TextButton(
          key: const ValueKey('admin-qr-batch-cancel'),
          onPressed: _isBusy ? null : _requestClose,
          child: const Text('Cancel'),
        ),
      );
      if (_preflight?.hasValidLabels == true) {
        actions.add(
          FilledButton(
            key: const ValueKey('admin-qr-batch-export-valid'),
            onPressed: _operationLocked ? null : _approveValidLabels,
            child: const Text('Export valid labels only'),
          ),
        );
      }
      return actions;
    }
    if (_stage == _BatchDialogStage.preparationFailed) {
      actions.addAll([
        TextButton(
          key: const ValueKey('admin-qr-batch-cancel'),
          onPressed: _isBusy ? null : _requestClose,
          child: const Text('Cancel'),
        ),
        FilledButton.icon(
          key: const ValueKey('admin-qr-batch-retry-preparation'),
          onPressed: _operationLocked ? null : _retryPreparation,
          icon: const Icon(Icons.refresh),
          label: const Text('Retry preparation'),
        ),
      ]);
      return actions;
    }
    if (_stage == _BatchDialogStage.checkingFitFailed) {
      actions.add(
        FilledButton.icon(
          key: const ValueKey('admin-qr-batch-retry-fit'),
          onPressed: _operationLocked ? null : _checkLabelFit,
          icon: const Icon(Icons.refresh),
          label: const Text('Retry checking label fit'),
        ),
      );
    }
    if (_stage == _BatchDialogStage.buildFailed) {
      actions.add(
        FilledButton.icon(
          key: const ValueKey('admin-qr-batch-retry-build'),
          onPressed: _operationLocked ? null : _buildPdf,
          icon: const Icon(Icons.refresh),
          label: const Text('Retry building PDF'),
        ),
      );
    }
    if (_stage == _BatchDialogStage.statusIncomplete) {
      actions.add(
        FilledButton.icon(
          key: const ValueKey('admin-qr-batch-retry-status'),
          onPressed: _operationLocked ? null : _retrySavingStatus,
          icon: const Icon(Icons.refresh),
          label: const Text('Retry saving status'),
        ),
      );
    }
    actions.add(
      TextButton(
        key: const ValueKey('admin-qr-batch-close'),
        onPressed: _isBusy ? null : _requestClose,
        child: const Text('Close'),
      ),
    );
    if (_artifact != null &&
        _stage != _BatchDialogStage.downloading &&
        _stage != _BatchDialogStage.marking) {
      actions.add(
        FilledButton.icon(
          key: const ValueKey('admin-qr-batch-download'),
          onPressed: _operationLocked ? null : _downloadPdf,
          icon: const Icon(Icons.download),
          label: const Text('Download PDF'),
        ),
      );
    }
    return actions;
  }
}
