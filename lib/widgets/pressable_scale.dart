import 'package:flutter/material.dart';

class PressableScale extends StatefulWidget {
  final Widget child;
  final bool enabled;
  final double pressedScale;
  final double pressedOpacity;
  final Duration duration;
  final Curve curve;

  const PressableScale({
    super.key,
    required this.child,
    this.enabled = true,
    this.pressedScale = 0.978,
    this.pressedOpacity = 0.98,
    this.duration = const Duration(milliseconds: 100),
    this.curve = Curves.easeOut,
  });

  @override
  State<PressableScale> createState() => _PressableScaleState();
}

class _PressableScaleState extends State<PressableScale> {
  bool _pressed = false;

  void _setPressed(bool value) {
    if (!widget.enabled || _pressed == value) return;
    setState(() {
      _pressed = value;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Listener(
      behavior: HitTestBehavior.translucent,
      onPointerDown: (_) => _setPressed(true),
      onPointerUp: (_) => _setPressed(false),
      onPointerCancel: (_) => _setPressed(false),
      child: AnimatedScale(
        scale: _pressed ? widget.pressedScale : 1,
        duration: widget.duration,
        curve: widget.curve,
        child: AnimatedOpacity(
          opacity: _pressed ? widget.pressedOpacity : 1,
          duration: widget.duration,
          curve: widget.curve,
          child: widget.child,
        ),
      ),
    );
  }
}
