import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../services/app_error_text.dart';

Future<bool?> showPhoneAuthSheet({
  required BuildContext context,
  required Future<void> Function(PhoneAuthCredential credential)
  onVerifiedCredential,
  String? initialPhoneNumber,
  bool sendCodeImmediately = false,
}) {
  return showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (context) => _PhoneAuthSheet(
      onVerifiedCredential: onVerifiedCredential,
      initialPhoneNumber: initialPhoneNumber,
      sendCodeImmediately: sendCodeImmediately,
    ),
  );
}

String? normalizePhoneNumber(String rawInput) {
  final trimmed = rawInput.trim();
  if (trimmed.isEmpty) {
    return null;
  }

  if (trimmed.startsWith('+')) {
    final digits = trimmed.substring(1).replaceAll(RegExp(r'\D'), '');
    if (digits.length < 8 || digits.length > 15) {
      return null;
    }
    return '+$digits';
  }

  final digits = trimmed.replaceAll(RegExp(r'\D'), '');
  if (digits.length == 10) {
    return '+1$digits';
  }
  if (digits.length == 11 && digits.startsWith('1')) {
    return '+$digits';
  }
  return null;
}

class _PhoneAuthSheet extends StatefulWidget {
  const _PhoneAuthSheet({
    required this.onVerifiedCredential,
    this.initialPhoneNumber,
    this.sendCodeImmediately = false,
  });

  final Future<void> Function(PhoneAuthCredential credential)
  onVerifiedCredential;
  final String? initialPhoneNumber;
  final bool sendCodeImmediately;

  @override
  State<_PhoneAuthSheet> createState() => _PhoneAuthSheetState();
}

class _PhoneAuthSheetState extends State<_PhoneAuthSheet> {
  static const int _codeCooldownSeconds = 60;

  final TextEditingController _phoneController = TextEditingController();
  final TextEditingController _codeController = TextEditingController();

  bool _isSendingCode = false;
  bool _isVerifyingCode = false;
  String? _verificationId;
  int? _resendToken;
  String? _message;
  Timer? _cooldownTimer;
  int _cooldownSecondsRemaining = 0;

  @override
  void initState() {
    super.initState();
    if (widget.initialPhoneNumber != null &&
        widget.initialPhoneNumber!.trim().isNotEmpty) {
      _phoneController.text = widget.initialPhoneNumber!.trim();
    }
    if (widget.sendCodeImmediately) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          _sendCode();
        }
      });
    }
  }

  void _showLocalSnackBar(String message) {
    if (!mounted) {
      return;
    }

    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(content: Text(message), duration: const Duration(seconds: 3)),
      );
  }

  @override
  void dispose() {
    _cooldownTimer?.cancel();
    _phoneController.dispose();
    _codeController.dispose();
    super.dispose();
  }

  void _startCodeCooldown() {
    _cooldownTimer?.cancel();
    setState(() {
      _cooldownSecondsRemaining = _codeCooldownSeconds;
    });
    _cooldownTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) {
        timer.cancel();
        return;
      }
      if (_cooldownSecondsRemaining <= 1) {
        timer.cancel();
        setState(() {
          _cooldownSecondsRemaining = 0;
        });
        return;
      }
      setState(() {
        _cooldownSecondsRemaining -= 1;
      });
    });
  }

  String _friendlyPhoneError(Object error, String fallback) {
    if (error is FirebaseAuthException) {
      final code = error.code.toLowerCase();
      final message = (error.message ?? '').toLowerCase();
      if (code == 'too-many-requests' ||
          code == 'quota-exceeded' ||
          code == 'captcha-check-failed' ||
          message.contains('unusual activity') ||
          message.contains('too many')) {
        return 'Too many attempts. Please wait a few minutes before trying again.';
      }
    }
    return AppErrorText.friendly(error, fallback: fallback);
  }

  Future<void> _sendCode({bool isResend = false}) async {
    if (_cooldownSecondsRemaining > 0) {
      return;
    }

    final normalizedPhoneNumber = normalizePhoneNumber(_phoneController.text);
    if (normalizedPhoneNumber == null) {
      setState(() {
        _message = 'Enter a valid phone number';
      });
      _showLocalSnackBar('Enter a valid phone number');
      return;
    }

    _phoneController.value = TextEditingValue(
      text: normalizedPhoneNumber,
      selection: TextSelection.collapsed(offset: normalizedPhoneNumber.length),
    );

    setState(() {
      _isSendingCode = true;
      _message = null;
    });
    _startCodeCooldown();

    try {
      await FirebaseAuth.instance.verifyPhoneNumber(
        phoneNumber: normalizedPhoneNumber,
        forceResendingToken: isResend ? _resendToken : null,
        verificationCompleted: (credential) async {
          try {
            await widget.onVerifiedCredential(credential);
            if (!mounted) {
              return;
            }
            Navigator.of(context).pop(true);
          } catch (error) {
            if (!mounted) {
              return;
            }
            setState(() {
              _message = AppErrorText.friendly(
                error,
                fallback: 'Could not complete phone sign-in right now.',
              );
              _isSendingCode = false;
              _isVerifyingCode = false;
            });
          }
        },
        verificationFailed: (error) {
          if (!mounted) {
            return;
          }
          final message = _friendlyPhoneError(
            error,
            'Could not send the verification code right now.',
          );
          setState(() {
            _message = message;
            _isSendingCode = false;
          });
          _showLocalSnackBar(message);
        },
        codeSent: (verificationId, resendToken) {
          if (!mounted) {
            return;
          }
          setState(() {
            _verificationId = verificationId;
            _resendToken = resendToken;
            _isSendingCode = false;
            _message = 'Verification code sent.';
          });
        },
        codeAutoRetrievalTimeout: (verificationId) {
          if (!mounted) {
            return;
          }
          setState(() {
            _verificationId = verificationId;
          });
        },
      );
    } catch (error) {
      if (!mounted) {
        return;
      }
      final message = _friendlyPhoneError(
        error,
        'Could not start phone sign-in right now.',
      );
      setState(() {
        _message = message;
        _isSendingCode = false;
      });
      _showLocalSnackBar(message);
    }
  }

  Future<void> _verifyCode() async {
    final verificationId = _verificationId;
    final smsCode = _codeController.text.trim();

    if (verificationId == null || verificationId.isEmpty) {
      setState(() {
        _message = 'Send a verification code first.';
      });
      return;
    }

    if (smsCode.isEmpty) {
      setState(() {
        _message = 'Enter the 6-digit verification code.';
      });
      return;
    }

    setState(() {
      _isVerifyingCode = true;
      _message = null;
    });

    try {
      final credential = PhoneAuthProvider.credential(
        verificationId: verificationId,
        smsCode: smsCode,
      );

      await widget.onVerifiedCredential(credential);

      if (!mounted) {
        return;
      }
      Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _message = AppErrorText.friendly(
          error,
          fallback: 'Could not verify that code right now.',
        );
        _isVerifyingCode = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final mediaQuery = MediaQuery.of(context);
    final bottomInset = mediaQuery.viewInsets.bottom > 0
        ? mediaQuery.viewInsets.bottom
        : mediaQuery.viewPadding.bottom;
    final hasCodeStep = _verificationId != null;
    final isCodeCooldownActive = _cooldownSecondsRemaining > 0;
    final sendCodeLabel = isCodeCooldownActive
        ? 'Resend in ${_cooldownSecondsRemaining}s'
        : 'Send code';
    final resendCodeLabel = isCodeCooldownActive
        ? 'Resend in ${_cooldownSecondsRemaining}s'
        : 'Resend code';

    return SafeArea(
      top: false,
      child: SingleChildScrollView(
        padding: EdgeInsets.fromLTRB(20, 20, 20, bottomInset + 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(
                width: 36,
                height: 4,
                decoration: BoxDecoration(
                  color: Colors.black12,
                  borderRadius: BorderRadius.circular(999),
                ),
              ),
            ),
            const SizedBox(height: 18),
            Text(
              hasCodeStep ? 'Enter verification code' : 'Sign in with phone',
              style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            Text(
              hasCodeStep
                  ? 'Enter the SMS code we sent to your phone.'
                  : 'Enter your mobile number to get a one-time verification code.',
              style: const TextStyle(color: Colors.black54, height: 1.35),
            ),
            const SizedBox(height: 18),
            TextField(
              controller: _phoneController,
              keyboardType: TextInputType.phone,
              enabled: !hasCodeStep,
              autofillHints: const [AutofillHints.telephoneNumber],
              decoration: const InputDecoration(
                labelText: 'Phone number',
                hintText: '555-123-4567',
                border: OutlineInputBorder(),
              ),
            ),
            if (hasCodeStep) ...[
              const SizedBox(height: 12),
              TextField(
                controller: _codeController,
                keyboardType: TextInputType.number,
                autofillHints: const [AutofillHints.oneTimeCode],
                decoration: const InputDecoration(
                  labelText: 'Verification code',
                  border: OutlineInputBorder(),
                ),
              ),
            ],
            if (_message != null) ...[
              const SizedBox(height: 12),
              Text(
                _message!,
                style: TextStyle(
                  fontSize: 13,
                  color: _message == 'Verification code sent.'
                      ? Colors.green[700]
                      : Colors.black54,
                ),
              ),
            ],
            const SizedBox(height: 18),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed:
                    _isSendingCode ||
                        _isVerifyingCode ||
                        (!hasCodeStep && isCodeCooldownActive)
                    ? null
                    : hasCodeStep
                    ? _verifyCode
                    : _sendCode,
                child: Text(
                  _isSendingCode
                      ? 'Sending code...'
                      : _isVerifyingCode
                      ? 'Verifying...'
                      : hasCodeStep
                      ? 'Verify code'
                      : sendCodeLabel,
                ),
              ),
            ),
            if (hasCodeStep) ...[
              const SizedBox(height: 8),
              Row(
                children: [
                  TextButton(
                    onPressed:
                        _isSendingCode ||
                            _isVerifyingCode ||
                            isCodeCooldownActive
                        ? null
                        : () => _sendCode(isResend: true),
                    child: Text(resendCodeLabel),
                  ),
                  TextButton(
                    onPressed: _isSendingCode || _isVerifyingCode
                        ? null
                        : () {
                            setState(() {
                              _verificationId = null;
                              _codeController.clear();
                              _message = null;
                            });
                          },
                    child: const Text('Use a different number'),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}
