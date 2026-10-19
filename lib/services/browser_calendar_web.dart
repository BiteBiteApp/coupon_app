import 'dart:js_interop';

@JS('Intl.DateTimeFormat')
external _DateTimeFormat _dateTimeFormat();
extension type _DateTimeFormat(JSObject _) implements JSObject {
  external _CalendarOptions resolvedOptions();
}
extension type _CalendarOptions(JSObject _) implements JSObject {
  external String get timeZone;
}

/// Passive calendar context for offer schedules. No credential or device proof.
({String timeZone, int utcOffsetMinutes}) browserCalendarContext() => (
  timeZone: _dateTimeFormat().resolvedOptions().timeZone,
  utcOffsetMinutes: DateTime.now().timeZoneOffset.inMinutes,
);
