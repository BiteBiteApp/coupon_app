import 'package:flutter/material.dart';

class AdminContentInsets {
  static const double bottomNavigationHeight = 48;
  static const double bottomNavigationOuterPadding = 3;
  static const double bottomBreathingRoom = 16;

  const AdminContentInsets._();

  static double bottomNavigationObstruction(BuildContext context) {
    return bottomNavigationHeight +
        bottomNavigationOuterPadding +
        MediaQuery.viewPaddingOf(context).bottom +
        bottomBreathingRoom;
  }

  static EdgeInsets scrollPadding(
    BuildContext context, {
    double left = 16,
    double top = 16,
    double right = 16,
    double bottom = 16,
  }) {
    return EdgeInsets.fromLTRB(
      left,
      top,
      right,
      bottom + bottomNavigationObstruction(context),
    );
  }
}
