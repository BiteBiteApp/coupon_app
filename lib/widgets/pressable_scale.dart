import 'package:flutter/material.dart';

class PressableScale extends StatelessWidget {
  final Widget child;
  final bool enabled;
  final double pressedScale;
  final double pressedOpacity;
  final Duration pressInDuration;
  final Duration pressOutDuration;
  final Curve curve;

  const PressableScale({
    super.key,
    required this.child,
    this.enabled = true,
    this.pressedScale = 0.965,
    this.pressedOpacity = 0.955,
    this.pressInDuration = const Duration(milliseconds: 80),
    this.pressOutDuration = const Duration(milliseconds: 125),
    this.curve = Curves.easeOut,
  });

  @override
  Widget build(BuildContext context) {
    return child;
  }
}
