import 'package:flutter/material.dart';

import '../services/bitesaver_restaurant_lifecycle_service.dart';
import '../services/coupon_admin_paging_service.dart';
import '../services/restaurant_invite_service.dart';
import '../widgets/coupon_admin_paged_dashboard.dart';

typedef AdminCouponAccountLoader =
    Future<Map<String, dynamic>?> Function(String documentId);
typedef AdminCouponApplicationReviewAction =
    Future<BiteSaverApplicationReviewResult> Function({
      required String documentId,
      required BiteSaverApplicationDecision decision,
      required int expectedProfileVersion,
    });
typedef AdminCouponDeleteAction =
    Future<void> Function({
      required String documentId,
      required String couponId,
    });
typedef AdminCouponEditAction =
    Future<bool?> Function({
      required BuildContext context,
      required String documentId,
      required Map<String, dynamic> data,
    });
typedef AdminCouponInviteAction =
    Future<RestaurantInviteCreationResult> Function({
      required String restaurantId,
      required String restaurantName,
      required String streetAddress,
      required String city,
      required String state,
      required String zipCode,
      required String phone,
      required String website,
      required double? latitude,
      required double? longitude,
    });

/// Coupon-side Admin entry point.
/// All displayed directories and queues use [CouponAdminPagingService].
class AdminReviewScreen extends StatelessWidget {
  const AdminReviewScreen({
    super.key,
    @visibleForTesting this.pagingService,
    @visibleForTesting this.loadAccount,
    @visibleForTesting this.reviewApplication,
    @visibleForTesting this.deleteCoupon,
    @visibleForTesting this.editAccount,
    @visibleForTesting this.createCouponInvite,
    @visibleForTesting this.lifecycleService,
  });

  final CouponAdminPagingService? pagingService;
  final AdminCouponAccountLoader? loadAccount;
  final AdminCouponApplicationReviewAction? reviewApplication;

  final AdminCouponDeleteAction? deleteCoupon;
  final AdminCouponEditAction? editAccount;
  final AdminCouponInviteAction? createCouponInvite;
  final BiteSaverRestaurantLifecycleService? lifecycleService;

  @override
  Widget build(BuildContext context) {
    return CouponAdminPagedDashboard(
      pagingService: pagingService,
      lifecycleService: lifecycleService,
      loadAccount: loadAccount,
      reviewApplication: reviewApplication,
      deleteCoupon: deleteCoupon,
      editAccount: editAccount,
      createCouponInvite: createCouponInvite,
    );
  }
}
