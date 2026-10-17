import 'package:cloud_functions/cloud_functions.dart';

/// Dormant until approved Terms and the coordinated public-contribution cutover ship.
/// This client switch is UX only; the trusted save independently checks receipts.
class BiteScoreTermsService {
  static const bool enabled = false;

  /// Recheck immediately before sending photo bytes. A changed mandatory version
  /// returns the user to the existing entry-point prompt without uploading.
  static Future<void> requireAccepted({
    required String expectedUserId,
    required bool Function() isCurrent,
    bool active = enabled,
    Future<Object?> Function(String, Map<String, Object?>)? transport,
  }) async {
    if (!await ensureAccepted(
      expectedUserId: expectedUserId,
      isCurrent: isCurrent,
      confirm: (_, _) async => false,
      active: active,
      transport: transport,
    )) {
      throw StateError(
        'Review and accept the current Terms before uploading a photograph.',
      );
    }
  }

  static Future<bool> ensureAccepted({
    required String expectedUserId,
    required bool Function() isCurrent,
    required Future<bool> Function(String version, String text) confirm,
    bool active = enabled,
    Future<Object?> Function(String, Map<String, Object?>)? transport,
  }) async {
    if (!active) return true;
    if (expectedUserId.isEmpty || !isCurrent()) return false;
    Future<Map> call(String name, [String? version]) async {
      if (!isCurrent()) throw StateError('Your account changed.');
      final request = <String, Object?>{
        'expectedUserId': expectedUserId,
        'version': ?version,
      };
      final response = transport == null
          ? (await FirebaseFunctions.instance.httpsCallable(name).call(request))
                .data
          : await transport(name, request);
      if (!isCurrent() ||
          response is! Map ||
          response['schemaVersion'] != 1 ||
          response['userId'] != expectedUserId) {
        throw StateError('Your account or Terms changed. Please try again.');
      }
      return response;
    }

    final status = await call('getCustomerBiteScoreTerms');
    // An active client must never present unpublished drafts or proceed on an
    // unavailable/malformed active policy. Browsing remains accessible.
    final version = status['version'];
    final text = status['text'];
    if (status['enabled'] != true ||
        version is! String ||
        version.trim().isEmpty ||
        text is! String ||
        text.trim().isEmpty ||
        status['accepted'] is! bool) {
      throw StateError(
        'Approved Terms are unavailable. Please try again later.',
      );
    }
    if (status['accepted'] == true) return isCurrent();
    if (!await confirm(version, text) || !isCurrent()) return false;
    final receipt = await call('acceptCustomerBiteScoreTerms', version);
    if (receipt['enabled'] != true ||
        receipt['version'] != version ||
        receipt['accepted'] != true) {
      throw StateError('The Terms changed. Please review them again.');
    }
    return isCurrent();
  }
}
