import 'package:flutter/foundation.dart';

enum AppMode {
  biteSaver,
  biteScore,
}

class AppModeStateService {
  static final ValueNotifier<AppMode> selectedMode =
      ValueNotifier<AppMode>(AppMode.biteSaver);

  static void setMode(AppMode mode) {
    selectedMode.value = mode;
  }
}
