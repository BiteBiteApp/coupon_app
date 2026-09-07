import 'package:flutter/material.dart';

class AdminContentInsets {
  static const double bottomNavigationHeight = 48;
  static const double bottomNavigationOuterPadding = 3;
  static const double bottomBreathingRoom = 16;
  static const double maxAdminWorkspaceWidth = 1120;

  const AdminContentInsets._();

  static double bottomNavigationObstruction(BuildContext context) {
    return bottomNavigationHeight +
        bottomNavigationOuterPadding +
        systemBottomObstruction(context);
  }

  static double systemBottomObstruction(BuildContext context) {
    return MediaQuery.viewPaddingOf(context).bottom + bottomBreathingRoom;
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

  static EdgeInsets systemScrollPadding(
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
      bottom + systemBottomObstruction(context),
    );
  }
}
