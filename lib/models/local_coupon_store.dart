import 'package:flutter/material.dart';
import 'coupon.dart';

class LocalCouponStore {
  static final ValueNotifier<List<Coupon>> createdCoupons =
      ValueNotifier<List<Coupon>>([]);

  static void addCoupon(Coupon coupon) {
    createdCoupons.value = [...createdCoupons.value, coupon];
  }

  static void upsertCoupon(Coupon coupon) {
    final currentCoupons = [...createdCoupons.value];
    final existingIndex = currentCoupons.indexWhere(
      (existingCoupon) => existingCoupon.id == coupon.id,
    );

    if (existingIndex == -1) {
      currentCoupons.add(coupon);
    } else {
      currentCoupons[existingIndex] = coupon;
    }

    createdCoupons.value = currentCoupons;
  }

  static void removeCoupon(String couponId) {
    createdCoupons.value = createdCoupons.value
        .where((coupon) => coupon.id != couponId)
        .toList();
  }

  static void clearCoupons() {
    createdCoupons.value = [];
  }
}
