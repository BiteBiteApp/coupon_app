import 'package:firebase_auth/firebase_auth.dart';

class AdminAccessService {
  static const List<String> allowedAdminEmails = [
    'schuyler.cole@gmail.com',
  ];

  static Set<String> get normalizedAllowedAdminEmails {
    return allowedAdminEmails
        .map((email) => email.toLowerCase().trim())
        .where((email) => email.isNotEmpty)
        .toSet();
  }

  static bool isAdminEmail(String? email) {
    if (email == null) return false;

    final normalized = email.toLowerCase().trim();

    return normalizedAllowedAdminEmails.contains(normalized);
  }

  static bool isAdminUser(User? user) {
    if (user == null || user.isAnonymous) {
      return false;
    }

    return isAdminEmail(user.email);
  }
}
