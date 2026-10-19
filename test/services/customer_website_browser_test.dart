@TestOn('browser')
library;

import 'package:coupon_app/services/customer_session_service.dart';
import 'package:coupon_app/services/customer_bitesaver_device_proof_service.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  test(
    'browser calendar is passive and native proof remains unavailable',
    () async {
      final service = CustomerBiteSaverDeviceProofService();
      final calendar = await service.getTimeContext();
      expect(calendar.timeZone, isNotEmpty);
      expect(calendar.utcOffsetMinutes, inInclusiveRange(-840, 840));
      expect(
        () => service.platform,
        throwsA(isA<CustomerBiteSaverDeviceProofException>()),
      );
    },
  );
  test('browser creates existing-format local guest identifier', () async {
    TestWidgetsFlutterBinding.ensureInitialized();
    SharedPreferences.setMockInitialValues({});
    final id = await CustomerSessionService.getOrCreateGuestDeviceId();
    expect(id, matches(r'^guest_[0-9]+_[0-9]+$'));
  });
}
