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
  AppMode? _pressedMode;

  Color _accentColor() {
    return widget.selectedMode == AppMode.biteScore
        ? const Color(0xFF3D67BE)
        : const Color(0xFFD06C3B);
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
    setState(() {
      _dragProgress = 0;
      _pressedMode = null;
    });
    widget.onModeSelected(
      targetPosition == 0 ? AppMode.biteSaver : AppMode.biteScore,
    );
  }

  void _setPressedMode(AppMode? mode) {
    if (_pressedMode == mode) return;
    setState(() {
      _pressedMode = mode;
    });
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final accent = _accentColor();

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      decoration: BoxDecoration(
        color: widget.selectedMode == AppMode.biteScore
            ? const Color(0xFFEFF4FA)
            : const Color(0xFFFFFEFC),
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final width = constraints.maxWidth;
          final thumbWidth = (width - 4) / 2;
          final visualPosition = (_selectedPosition + _dragProgress)
              .clamp(0, 1)
              .toDouble();
          final left = 2 + (visualPosition * thumbWidth);

          return GestureDetector(
            onHorizontalDragUpdate: (details) {
              _handleDragUpdate(details, constraints);
            },
            onHorizontalDragEnd: (_) {
              _handleDragEnd();
            },
            child: Container(
              width: double.infinity,
              height: 51,
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  begin: Alignment.centerLeft,
                  end: Alignment.centerRight,
                  colors: [
                    Color(0xFFD68A52),
                    Color(0xFFC66E59),
                    Color(0xFFB56678),
                    Color(0xFF7A689E),
                    Color(0xFF3364BB),
                  ],
                  stops: [0.0, 0.24, 0.50, 0.74, 1.0],
                ),
                borderRadius: BorderRadius.circular(26),
                border: Border.all(
                  color: const Color(0xFFF9EEE4).withValues(alpha: 0.46),
                ),
                boxShadow: [
                  BoxShadow(
                    color: accent.withValues(alpha: 0.10),
                    blurRadius: 8,
                    offset: const Offset(0, 2),
                  ),
                ],
              ),
              child: Stack(
                children: [
                  AnimatedPositioned(
                    duration: const Duration(milliseconds: 300),
                    curve: Curves.easeOutCubic,
                    left: left,
                    top: 1,
                    bottom: 1,
                    width: thumbWidth,
                    child: AnimatedScale(
                      scale: _pressedMode == widget.selectedMode ? 0.978 : 1.0,
                      duration: const Duration(milliseconds: 100),
                      curve: Curves.easeOut,
                      child: AnimatedOpacity(
                        opacity: _pressedMode == widget.selectedMode
                            ? 0.98
                            : 1.0,
                        duration: const Duration(milliseconds: 100),
                        curve: Curves.easeOut,
                        child: ClipRRect(
                          clipBehavior: Clip.antiAlias,
                          borderRadius: const BorderRadius.all(
                            Radius.elliptical(20.5, 17.5),
                          ),
                          child: DecoratedBox(
                            decoration: BoxDecoration(
                              gradient: widget.selectedMode == AppMode.biteSaver
                                  ? const LinearGradient(
                                      begin: Alignment.topLeft,
                                      end: Alignment.bottomRight,
                                      colors: [
                                        Color(0xFFEDA364),
                                        Color(0xFFD36F3A),
                                        Color(0xFFB54D24),
                                      ],
                                    )
                                  : const LinearGradient(
                                      begin: Alignment.topLeft,
                                      end: Alignment.bottomRight,
                                      colors: [
                                        Color(0xFF936AB3),
                                        Color(0xFF5668BE),
                                        Color(0xFF285CC3),
                                      ],
                                    ),
                              borderRadius: const BorderRadius.all(
                                Radius.elliptical(20.5, 17.5),
                              ),
                              border: Border.all(
                                color: const Color(
                                  0xFFFFF6EE,
                                ).withValues(alpha: 0.62),
                                width: 0.8,
                              ),
                            ),
                            child: Center(
                              child: Text(
                                widget.selectedMode == AppMode.biteSaver
                                    ? 'BiteSaver'
                                    : 'BiteScore',
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontWeight: FontWeight.w800,
                                  fontSize: 14,
                                ),
                              ),
                            ),
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
                          onHighlightChanged: (pressed) {
                            _setPressedMode(pressed ? AppMode.biteSaver : null);
                          },
                          onTap: () => widget.onModeSelected(AppMode.biteSaver),
                          child: AnimatedScale(
                            scale: _pressedMode == AppMode.biteSaver
                                ? 0.985
                                : 1.0,
                            duration: const Duration(milliseconds: 100),
                            curve: Curves.easeOut,
                            child: AnimatedOpacity(
                              opacity: _pressedMode == AppMode.biteSaver
                                  ? 0.98
                                  : 1.0,
                              duration: const Duration(milliseconds: 100),
                              curve: Curves.easeOut,
                              child: Padding(
                                padding: const EdgeInsets.symmetric(
                                  vertical: 12,
                                ),
                                child: Center(
                                  child: Text(
                                    'BiteSaver',
                                    style: TextStyle(
                                      color:
                                          widget.selectedMode ==
                                              AppMode.biteSaver
                                          ? Colors.transparent
                                          : colorScheme.onSurfaceVariant
                                                .withValues(alpha: 0.9),
                                      fontWeight: FontWeight.w700,
                                      fontSize: 14,
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                      Expanded(
                        child: InkWell(
                          borderRadius: BorderRadius.circular(24),
                          onHighlightChanged: (pressed) {
                            _setPressedMode(pressed ? AppMode.biteScore : null);
                          },
                          onTap: () => widget.onModeSelected(AppMode.biteScore),
                          child: AnimatedScale(
                            scale: _pressedMode == AppMode.biteScore
                                ? 0.985
                                : 1.0,
                            duration: const Duration(milliseconds: 100),
                            curve: Curves.easeOut,
                            child: AnimatedOpacity(
                              opacity: _pressedMode == AppMode.biteScore
                                  ? 0.98
                                  : 1.0,
                              duration: const Duration(milliseconds: 100),
                              curve: Curves.easeOut,
                              child: Padding(
                                padding: const EdgeInsets.symmetric(
                                  vertical: 12,
                                ),
                                child: Center(
                                  child: Text(
                                    'BiteScore',
                                    style: TextStyle(
                                      color:
                                          widget.selectedMode ==
                                              AppMode.biteScore
                                          ? Colors.transparent
                                          : colorScheme.onSurfaceVariant
                                                .withValues(alpha: 0.9),
                                      fontWeight: FontWeight.w700,
                                      fontSize: 14,
                                    ),
                                  ),
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
