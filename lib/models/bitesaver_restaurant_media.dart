import 'daily_special.dart';

class BiteSaverRestaurantMedia {
  final String restaurantId;
  final List<String> gallery;
  final bool photoBoard;
  final String? boardOfferId;
  final DailySpecial? board;
  final Map<String, String> specialImages;
  const BiteSaverRestaurantMedia({
    required this.restaurantId,
    required this.gallery,
    required this.photoBoard,
    this.boardOfferId,
    this.board,
    this.specialImages = const {},
  });
  factory BiteSaverRestaurantMedia.fromJson(Object? raw) {
    if (raw is! Map ||
        raw['schemaVersion'] != 1 ||
        raw['kind'] != 'restaurantMedia' ||
        raw['restaurantId'] is! String ||
        raw['gallery'] is! List ||
        (raw['gallery'] as List).length > 12 ||
        !['manual', 'photo'].contains(raw['mode']) ||
        raw['specialImages'] is! Map ||
        (raw['specialImages'] as Map).length > 50) {
      throw const FormatException('Invalid restaurant media.');
    }
    String url(Object? value) {
      if (value is! String ||
          value.length > 2000 ||
          !['https', 'http'].contains(Uri.tryParse(value)?.scheme)) {
        throw const FormatException('Invalid photo.');
      }
      return value;
    }

    final id = raw['restaurantId'] as String;
    final data = raw['board'];
    if (data != null) {
      if (data is! Map || raw['mode'] != 'photo') {
        throw const FormatException('Invalid board.');
      }
      url(data['imageUrl']);
    }
    final boardOfferId = raw['boardOfferId'];
    if (boardOfferId != null &&
        (boardOfferId is! String ||
            !RegExp(r'^bso_[A-Za-z0-9_-]{43}$').hasMatch(boardOfferId))) {
      throw const FormatException('Invalid board identity.');
    }
    return BiteSaverRestaurantMedia(
      restaurantId: id,
      gallery: List.unmodifiable((raw['gallery'] as List).map(url)),
      photoBoard: raw['mode'] == 'photo',
      boardOfferId: boardOfferId as String?,
      board: data == null
          ? null
          : DailySpecial.tryFromFirestore(
              Map<String, dynamic>.from(data as Map),
              fallbackId: 'board',
              fallbackRestaurantId: id,
            ),
      specialImages: Map.unmodifiable(
        (raw['specialImages'] as Map).map(
          (key, value) => MapEntry(key as String, url(value)),
        ),
      ),
    );
  }
}
