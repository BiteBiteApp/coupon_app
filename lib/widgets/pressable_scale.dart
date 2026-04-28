import 'package:flutter/material.dart';

class PressableScale extends StatefulWidget {
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
  State<PressableScale> createState() => _PressableScaleState();
}

class _PressableScaleState extends State<PressableScale> {
  bool _pressed = false;

  Duration get _duration =>
      _pressed ? widget.pressInDuration : widget.pressOutDuration;

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
        duration: _duration,
        curve: widget.curve,
        child: AnimatedOpacity(
          opacity: _pressed ? widget.pressedOpacity : 1,
          duration: _duration,
          curve: widget.curve,
          child: widget.child,
        ),
      ),
    );
  }
}
