import 'package:flutter/material.dart';

import '../services/app_mode_state_service.dart';

class AppModeSwitcherBar extends StatefulWidget {
  final AppMode selectedMode;
  final ValueChanged<AppMode> onModeSelected;

  const AppModeSwitcherBar({
    super.key,
    required this.selectedMode,
    required this.onModeSelected,
  });

  @override
  State<AppModeSwitcherBar> createState() => _AppModeSwitcherBarState();
}

class _AppModeSwitcherBarState extends State<AppModeSwitcherBar> {
  double _dragProgress = 0;

  Color _accentColor() {
    return widget.selectedMode == AppMode.biteScore
        ? const Color(0xFFC62828)
        : const Color(0xFFE86A17);
  }

  Color _shadowColor() {
    return widget.selectedMode == AppMode.biteScore
        ? const Color(0xFF7F1D1D)
        : const Color(0xFFB45309);
  }

  double get _selectedPosition =>
      widget.selectedMode == AppMode.biteSaver ? 0 : 1;

  void _handleDragUpdate(
    DragUpdateDetails details,
    BoxConstraints constraints,
  ) {
    final width = constraints.maxWidth;
    if (width <= 0) return;

    setState(() {
      _dragProgress = (_dragProgress + (details.delta.dx / width)).clamp(-1, 1);
    });
  }

  void _handleDragEnd() {
    final targetPosition = (_selectedPosition + _dragProgress) >= 0.5 ? 1 : 0;
    _dragProgress = 0;
    widget.onModeSelected(
      targetPosition == 0 ? AppMode.biteSaver : AppMode.biteScore,
    );
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final accent = _accentColor();
    final thumbShadow = _shadowColor();

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      decoration: BoxDecoration(
        color: colorScheme.surfaceContainerLowest,
        border: Border(
          bottom: BorderSide(
            color: colorScheme.outlineVariant,
          ),
        ),
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final width = constraints.maxWidth;
          final thumbWidth = (width - 12) / 2;
          final visualPosition =
              (_selectedPosition + _dragProgress).clamp(0, 1).toDouble();
          final left = 6 + (visualPosition * thumbWidth);

          return GestureDetector(
            onHorizontalDragUpdate: (details) {
              _handleDragUpdate(details, constraints);
            },
            onHorizontalDragEnd: (_) {
              _handleDragEnd();
            },
            child: Container(
              width: double.infinity,
              height: 62,
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  begin: Alignment.centerLeft,
                  end: Alignment.centerRight,
                  colors: [
                    Color(0xFFFFC94E),
                    Color(0xFFFFA84B),
                    Color(0xFFFF7B56),
                    Color(0xFFE25571),
                    Color(0xFFC14B95),
                    Color(0xFF9160C9),
                    Color(0xFF5F74E2),
                    Color(0xFF3F8EE4),
                  ],
                ),
                borderRadius: BorderRadius.circular(26),
                border: Border.all(
                  color: Colors.white.withOpacity(0.34),
                ),
                boxShadow: [
                  BoxShadow(
                    color: accent.withOpacity(0.12),
                    blurRadius: 14,
                    offset: const Offset(0, 8),
                  ),
                ],
              ),
              child: Stack(
                children: [
                  AnimatedPositioned(
                    duration: const Duration(milliseconds: 300),
                    curve: Curves.easeOutCubic,
                    left: left,
                    top: 6,
                    width: thumbWidth,
                    height: 50,
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        gradient: widget.selectedMode == AppMode.biteSaver
                            ? const LinearGradient(
                                begin: Alignment.topLeft,
                                end: Alignment.bottomRight,
                                colors: [
                                  Color(0xFFFF9830),
                                  Color(0xFFFF7121),
                                  Color(0xFFFF5A1F),
                                ],
                              )
                            : const LinearGradient(
                                begin: Alignment.topLeft,
                                end: Alignment.bottomRight,
                                colors: [
                                  Color(0xFFD95A8C),
                                  Color(0xFF9E49C3),
                                  Color(0xFF3E67D6),
                                ],
                              ),
                        borderRadius: BorderRadius.circular(21),
                        border: Border.all(
                          color: Colors.white.withOpacity(0.68),
                        ),
                        boxShadow: [
                          BoxShadow(
                            color: thumbShadow.withOpacity(0.34),
                            blurRadius: 10,
                            offset: const Offset(0, 4),
                          ),
                        ],
                      ),
                      child: Center(
                        child: Text(
                          widget.selectedMode == AppMode.biteSaver
                              ? 'BiteSaver'
                              : 'BiteScore',
                          style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.w800,
                            fontSize: 15,
                          ),
                        ),
                      ),
                    ),
                  ),
                  Row(
                    children: [
                      Expanded(
                        child: InkWell(
                          borderRadius: BorderRadius.circular(24),
                          onTap: () => widget.onModeSelected(AppMode.biteSaver),
                          child: Padding(
                            padding: const EdgeInsets.symmetric(vertical: 18),
                            child: Center(
                              child: Text(
                                'BiteSaver',
                                style: TextStyle(
                                  color: widget.selectedMode == AppMode.biteSaver
                                      ? Colors.transparent
                                      : colorScheme.onSurfaceVariant.withOpacity(
                                          0.9,
                                        ),
                                  fontWeight: FontWeight.w700,
                                  fontSize: 15,
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                      Expanded(
                        child: InkWell(
                          borderRadius: BorderRadius.circular(24),
                          onTap: () => widget.onModeSelected(AppMode.biteScore),
                          child: Padding(
                            padding: const EdgeInsets.symmetric(vertical: 18),
                            child: Center(
                              child: Text(
                                'BiteScore',
                                style: TextStyle(
                                  color: widget.selectedMode == AppMode.biteScore
                                      ? Colors.transparent
                                      : colorScheme.onSurfaceVariant.withOpacity(
                                          0.9,
                                        ),
                                  fontWeight: FontWeight.w700,
                                  fontSize: 15,
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}

Widget buildPersistentAppModeSwitcher(BuildContext context) {
  return ValueListenableBuilder<AppMode>(
    valueListenable: AppModeStateService.selectedMode,
    builder: (context, selectedMode, _) {
      return AppModeSwitcherBar(
        selectedMode: selectedMode,
        onModeSelected: (mode) {
          if (mode == selectedMode) {
            return;
          }
          Navigator.of(context).popUntil((route) => route.isFirst);
          AppModeStateService.setMode(mode);
        },
      );
    },
  );
}
