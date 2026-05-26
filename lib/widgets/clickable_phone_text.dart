import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../utils/phone_number_formatter.dart';

class ClickablePhoneText extends StatelessWidget {
  static const Color linkColor = Color(0xFF4A78B5);

  final String? phone;
  final String prefix;
  final TextStyle? style;
  final TextAlign? textAlign;
  final int? maxLines;
  final TextOverflow? overflow;

  const ClickablePhoneText({
    super.key,
    required this.phone,
    this.prefix = '',
    this.style,
    this.textAlign,
    this.maxLines,
    this.overflow,
  });

  String? get _dialPath {
    final raw = phone?.trim() ?? '';
    if (raw.isEmpty) {
      return null;
    }

    final cleaned = raw.replaceAll(RegExp(r'[^0-9+]'), '');
    final digits = cleaned.replaceAll(RegExp(r'\D'), '');
    if (digits.length < 7) {
      return null;
    }

    return cleaned;
  }

  Future<void> _call() async {
    final dialPath = _dialPath;
    if (dialPath == null) {
      return;
    }

    await launchUrl(Uri(scheme: 'tel', path: dialPath));
  }

  @override
  Widget build(BuildContext context) {
    final displayPhone = formatPhoneNumberForDisplay(phone);
    final isClickable = _dialPath != null;
    final effectiveStyle = (style ?? DefaultTextStyle.of(context).style)
        .copyWith(
          color: isClickable ? linkColor : style?.color,
          decoration: isClickable ? TextDecoration.underline : null,
          decorationColor: isClickable ? linkColor : null,
        );

    return InkWell(
      onTap: isClickable ? _call : null,
      borderRadius: BorderRadius.circular(6),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 1),
        child: Text(
          '$prefix$displayPhone',
          textAlign: textAlign,
          maxLines: maxLines,
          overflow: overflow,
          style: effectiveStyle,
        ),
      ),
    );
  }
}
